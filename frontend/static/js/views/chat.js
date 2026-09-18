// Private chat: contact sidebar, message history and the typing indicator.

import { state, CHAT_PAGE_SIZE } from '../state.js';
import { api } from '../api.js';
import { escapeHTML, throttle, formatDateTime, el } from '../utils.js';
import { send } from '../ws.js';
import { navigate } from '../router.js';

const TYPING_IDLE_MS = 1500; // silence after the last keystroke means "stopped"
const TYPING_SAFETY_MS = 3000; // hide the indicator if updates stop arriving

let typingIdleTimer = null;
let typingSafetyTimer = null;
let isCurrentlyTyping = false;

// ---------------------------------------------------------------- contacts

export async function loadUsers() {
    try {
        const response = await api.users();
        if (!response.ok) return;
        // The server orders contacts by last message, then alphabetically
        state.users = await response.json() || [];
        renderUserList();
    } catch (e) {
        console.error(e);
    }
}

export function renderUserList() {
    const list = el('user-list');
    if (!list) return;

    if (state.users.length === 0) {
        list.innerHTML = '<p class="empty-state">No other users yet.</p>';
        return;
    }

    list.innerHTML = state.users.map(user => {
        const online = state.onlineUsers.has(user.id);
        const highlighted = state.activeChatUser === user.id || state.unread.has(user.id);

        return `
            <div class="user-item" data-user-id="${user.id}">
                <span class="user-name${highlighted ? ' user-name--active' : ''}" id="user-name-${user.id}">${escapeHTML(user.nickname)}</span>
                <span class="user-status${online ? ' user-status--online' : ''}" id="user-status-${user.id}">${online ? '● Online' : '○ Offline'}</span>
            </div>
        `;
    }).join('');
}

// Online state lives in state.onlineUsers, so it survives any re-render and
// status events that arrive before the list exists are not lost.
export function setUserOnline(userId, online) {
    if (online) {
        state.onlineUsers.add(userId);
    } else {
        state.onlineUsers.delete(userId);
    }
    paintUserStatus(userId);
}

function paintUserStatus(userId) {
    const badge = el(`user-status-${userId}`);
    if (!badge) return;
    const online = state.onlineUsers.has(userId);
    badge.classList.toggle('user-status--online', online);
    badge.textContent = online ? '● Online' : '○ Offline';
}

export function refreshUserStatuses() {
    state.users.forEach(user => paintUserStatus(user.id));
}

// Keep the sidebar ordered like a chat application: newest conversation first.
export function moveContactToTop(userId) {
    const index = state.users.findIndex(user => user.id === userId);
    if (index <= 0) return; // unknown contact, or already first
    const [contact] = state.users.splice(index, 1);
    state.users.unshift(contact);
    renderUserList();
}

export function markUserUnread(userId) {
    state.unread.add(userId);
    const name = el(`user-name-${userId}`);
    if (name) name.classList.add('user-name--active');
}

export function initChat() {
    // Event delegation: no nickname is ever interpolated into an onclick
    document.addEventListener('click', event => {
        const item = event.target.closest('.user-item');
        if (item) {
            navigate(`${window.location.pathname}?chat=${item.dataset.userId}`);
            return;
        }
        if (event.target.closest('#chat-close')) {
            closeChat();
        }
    });
}

// ------------------------------------------------------------------- chat

export function renderChatPlaceholder() {
    const view = el('chat-view');
    if (view) {
        view.innerHTML = '<div class="chat-placeholder">Select a user to chat</div>';
    }
}

export async function openChat(userId) {
    const view = el('chat-view');
    if (!view) return;

    if (state.users.length === 0) await loadUsers();

    const contact = state.users.find(user => user.id === userId);
    if (!contact) {
        view.innerHTML = '<div class="chat-placeholder">This user is not available</div>';
        return;
    }

    state.activeChatUser = userId;
    state.chatOffset = 0;
    state.chatHasMore = true;

    // Opening a chat clears its unread marker; the sidebar renders from state
    state.unread.delete(userId);
    renderUserList();

    view.innerHTML = `
        <div class="card chat-panel">
            <div class="chat-header">
                <span>💬 Chat with <span class="chat-partner">${escapeHTML(contact.nickname)}</span></span>
                <button type="button" id="chat-close" class="btn-link chat-close">Close</button>
            </div>
            <div id="chat-messages" class="chat-messages"></div>
            <div id="typing-indicator" class="typing-indicator">
                <span class="typing-name"></span> is typing<span class="typing-dots"><span>.</span><span>.</span><span>.</span></span>
            </div>
            <form id="chat-form" class="chat-form">
                <div class="chat-input-row">
                    <input type="text" id="chat-input" name="content" autocomplete="off" placeholder="Type a message..." class="chat-input">
                    <button type="submit" class="btn btn--inline">Send</button>
                </div>
            </form>
        </div>
    `;

    setupTypingDetection(el('chat-input'), userId);

    el('chat-form').addEventListener('submit', event => {
        event.preventDefault();
        const input = event.target.elements.content;
        const text = input.value.trim();
        if (!text) return;

        stopTyping(userId);
        send({ type: 'message', receiver_id: userId, content: text });
        input.value = '';
    });

    el('chat-messages').addEventListener('scroll', throttle(handleScroll, 300));

    await loadChatHistory(userId);
}

// closeChat only drops ?chat= from the URL; the router then clears the panel.
export function closeChat() {
    stopTyping(state.activeChatUser);
    navigate(window.location.pathname);
}

// clearChat tears the panel down, leaving the sidebar in place.
export function clearChat() {
    stopTyping(state.activeChatUser);
    hideTypingIndicator();
    state.activeChatUser = null;
    renderUserList();
    renderChatPlaceholder();
}

function handleScroll() {
    const list = el('chat-messages');
    if (!list) return;
    // The list is rendered bottom-up (column-reverse), so scrollTop is negative
    if (Math.abs(list.scrollTop) > (list.scrollHeight - list.clientHeight - 50)) {
        if (!state.chatLoading && state.chatHasMore) {
            loadChatHistory(state.activeChatUser);
        }
    }
}

async function loadChatHistory(targetUserId) {
    if (state.chatLoading) return;
    state.chatLoading = true;

    try {
        const response = await api.messages(targetUserId, state.chatOffset);
        if (!response.ok) return;

        const messages = await response.json();
        const received = messages ? messages.length : 0;
        const list = el('chat-messages');

        if (received > 0 && list) {
            state.chatOffset += received;
            list.insertAdjacentHTML('beforeend', messages.map(renderMessage).join(''));
        }

        // A short page means the conversation is fully loaded
        if (received < CHAT_PAGE_SIZE) state.chatHasMore = false;
    } catch (e) {
        console.error(e);
    } finally {
        state.chatLoading = false;
    }
}

export function handleIncomingMessage(msg) {
    const partnerId = msg.sender_id === state.user?.id ? msg.receiver_id : msg.sender_id;
    moveContactToTop(partnerId);

    // A message from the person who was typing means they are done
    if (msg.sender_id === state.activeChatUser) hideTypingIndicator();

    if (state.activeChatUser === msg.sender_id || state.activeChatUser === msg.receiver_id) {
        const list = el('chat-messages');
        if (list) list.insertAdjacentHTML('afterbegin', renderMessage(msg));
    } else {
        markUserUnread(msg.sender_id);
    }
}

function renderMessage(msg) {
    const mine = msg.sender_id === state.user?.id;
    let author = 'You';

    if (!mine) {
        const contact = state.users.find(user => user.id === msg.sender_id);
        author = escapeHTML(contact ? contact.nickname : (msg.sender_nickname || 'User'));
    }

    return `
        <div class="msg ${mine ? 'msg--out' : 'msg--in'}">
            <div class="msg-bubble">
                <div class="msg-author">${author}</div>
                ${escapeHTML(msg.content)}
                <div class="msg-time">${formatDateTime(msg.created_at || msg.timestamp)}</div>
            </div>
        </div>
    `;
}

// -------------------------------------------------------- typing indicator

export function handleTypingEvent(msg) {
    // Only show the indicator for the conversation that is open
    if (msg.sender_id !== state.activeChatUser) return;

    if (msg.typing) {
        showTypingIndicator(msg.nickname || 'User');
        clearTimeout(typingSafetyTimer);
        typingSafetyTimer = setTimeout(hideTypingIndicator, TYPING_SAFETY_MS);
    } else {
        hideTypingIndicator();
    }
}

function showTypingIndicator(nickname) {
    const indicator = el('typing-indicator');
    if (!indicator) return;
    indicator.querySelector('.typing-name').textContent = nickname;
    indicator.classList.add('visible');
}

export function hideTypingIndicator() {
    clearTimeout(typingSafetyTimer);
    const indicator = el('typing-indicator');
    if (indicator) indicator.classList.remove('visible');
}

function setupTypingDetection(input, receiverId) {
    if (!input) return;

    // Any input counts: typing, pasting, dictating
    input.addEventListener('input', () => {
        if (!isCurrentlyTyping) {
            isCurrentlyTyping = true;
            send({ type: 'typing', receiver_id: receiverId, typing: true });
        }
        clearTimeout(typingIdleTimer);
        typingIdleTimer = setTimeout(() => stopTyping(receiverId), TYPING_IDLE_MS);
    });

    // Leaving the field stops the indicator immediately
    input.addEventListener('blur', () => stopTyping(receiverId));
}

function stopTyping(receiverId) {
    if (!isCurrentlyTyping || !receiverId) return;
    isCurrentlyTyping = false;
    clearTimeout(typingIdleTimer);
    send({ type: 'typing', receiver_id: receiverId, typing: false });
}
