// Utility to prevent XSS
function escapeHTML(str) {
    if (typeof str !== 'string') return str;
    return str.replace(/&/g, '&amp;')
              .replace(/</g, '&lt;')
              .replace(/>/g, '&gt;')
              .replace(/"/g, '&quot;')
              .replace(/'/g, '&#39;');
}

// State
const state = {
    isLoggedIn: false, // Confirmed by /api/me, never guessed from the cookie
    user: null, // Current logged in user
    users: [], // Chat contacts, ordered by last message
    onlineUsers: new Set(), // Ids of users currently connected
    unread: new Set(), // Ids of users with unread messages
    activeChatUser: null, // ID of user we are chatting with
    socket: null,
    wsRetries: 0,
    chatOffset: 0,
    chatLoading: false,
    chatHasMore: true,
    allPosts: [], // Store all posts locally
    activeCategory: 'All', // Default category
    view: 'feed' // 'feed' or 'post' — what the middle column shows
};

const WS_MAX_RETRIES = 6;

// Typing indicator state
let typingDebounceTimer = null;
let typingSafetyTimer = null;
let isCurrentlyTyping = false;

// DOM Elements
const app = document.getElementById('app');
const logoutBtn = document.getElementById('logout-btn');

const CATEGORIES = ["General", "Tech", "Random", "Blockchain", "Startups", "Economics", "Science", "Music", "Movies"];

// Must match messagePageSize on the server
const CHAT_PAGE_SIZE = 10;

// apiFetch centralises the "session is gone" case: the cookie is HttpOnly, so
// the server's 401 is the only reliable signal that we are logged out.
async function apiFetch(url, options) {
    const response = await fetch(url, options);
    if (response.status === 401 && state.isLoggedIn) {
        handleUnauthorized();
    }
    return response;
}

function handleUnauthorized() {
    state.isLoggedIn = false;
    state.user = null;
    state.users = [];
    state.onlineUsers.clear();
    state.unread.clear();
    state.activeChatUser = null;
    logoutBtn.style.display = 'none';
    if (state.socket) {
        state.socket.onclose = null;
        state.socket.close();
        state.socket = null;
    }
    renderLogin('Your session has expired, please log in again.');
}

// fetchUserInfo doubles as the session check: it tells us both who we are and
// whether we are still logged in.
async function fetchUserInfo() {
    try {
        const res = await fetch('/api/me');
        if (res.ok) {
            state.user = await res.json(); // { id, nickname }
            return true;
        }
    } catch (_) {}
    state.user = null;
    return false;
}

async function initApp() {
    state.isLoggedIn = await fetchUserInfo();
    if (state.isLoggedIn) {
        logoutBtn.style.display = 'block';
        initWebSocket();
        renderHome();
    } else {
        logoutBtn.style.display = 'none';
        renderLogin();
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}

function initWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    state.socket = new WebSocket(`${protocol}//${window.location.host}/ws`);

    state.socket.onopen = () => { state.wsRetries = 0; };
    state.socket.onmessage = (event) => { handleWsMessage(JSON.parse(event.data)); };
    state.socket.onclose = () => {
        // Nobody is online as far as we know while the socket is down.
        state.onlineUsers.clear();
        refreshUserStatuses();
        scheduleReconnect();
    };
}

// scheduleReconnect backs off exponentially and re-validates the session first,
// so an expired login ends on the login screen instead of in a retry loop.
function scheduleReconnect() {
    if (!state.isLoggedIn || state.wsRetries >= WS_MAX_RETRIES) return;

    const delay = Math.min(30000, 1000 * Math.pow(2, state.wsRetries));
    state.wsRetries++;

    setTimeout(async () => {
        if (!state.isLoggedIn) return;
        const stillLoggedIn = await fetchUserInfo();
        if (!stillLoggedIn) {
            handleUnauthorized();
            return;
        }
        initWebSocket();
    }, delay);
}

function handleWsMessage(msg) {
    if (msg.type === 'status') {
        setUserOnline(msg.user_id, msg.online);
    } else if (msg.type === 'message') {
        // Keep the sidebar ordered like a chat app: newest conversation on top
        const partnerId = msg.sender_id === state.user?.id ? msg.receiver_id : msg.sender_id;
        moveContactToTop(partnerId);
        // When we receive a message from the user who was typing, hide their indicator
        if (msg.sender_id === state.activeChatUser) {
            hideTypingIndicator();
        }
        if (state.activeChatUser === msg.sender_id || state.activeChatUser === msg.receiver_id) {
            appendMessage(msg);
        } else {
            markUserUnread(msg.sender_id);
        }
    } else if (msg.type === 'typing') {
        handleTypingEvent(msg);
    } else if (msg.type === 'post_reaction' || msg.type === 'comment_reaction') {
        handleReactionUpdate(msg);
    }
}

// ============================================
// TYPING INDICATOR ENGINE
// ============================================

function handleTypingEvent(msg) {
    // Only show the indicator if we have this user's chat open
    if (msg.sender_id !== state.activeChatUser) return;

    if (msg.typing) {
        showTypingIndicator(msg.nickname || 'User');
        // Safety timeout: auto-hide after 3s if no new typing event
        clearTimeout(typingSafetyTimer);
        typingSafetyTimer = setTimeout(() => hideTypingIndicator(), 3000);
    } else {
        hideTypingIndicator();
    }
}

function showTypingIndicator(nickname) {
    const indicator = document.getElementById('typing-indicator');
    if (!indicator) return;
    indicator.querySelector('.typing-name').textContent = nickname;
    indicator.classList.add('visible');
}

function hideTypingIndicator() {
    clearTimeout(typingSafetyTimer);
    const indicator = document.getElementById('typing-indicator');
    if (!indicator) return;
    indicator.classList.remove('visible');
}

function sendTypingEvent(receiverId, isTyping) {
    if (!state.socket || state.socket.readyState !== WebSocket.OPEN) return;
    state.socket.send(JSON.stringify({
        type: 'typing',
        receiver_id: receiverId,
        typing: isTyping
    }));
}

function setupTypingDetection(inputElement, receiverId) {
    // On any input (keyboard, paste, etc.), send typing = true with debounce
    inputElement.addEventListener('input', () => {
        if (!isCurrentlyTyping) {
            isCurrentlyTyping = true;
            sendTypingEvent(receiverId, true);
        }
        // Reset the debounce timer on every keystroke
        clearTimeout(typingDebounceTimer);
        typingDebounceTimer = setTimeout(() => {
            isCurrentlyTyping = false;
            sendTypingEvent(receiverId, false);
        }, 1500); // 1.5s after last keystroke → stop typing
    });

    // On blur (focus lost), immediately stop typing
    inputElement.addEventListener('blur', () => {
        if (isCurrentlyTyping) {
            isCurrentlyTyping = false;
            clearTimeout(typingDebounceTimer);
            sendTypingEvent(receiverId, false);
        }
    });
}

function handleReactionUpdate(msg) {
    let selector = '';
    if (msg.type === 'post_reaction') {
        selector = `.reaction-buttons[data-post-id="${msg.content_id}"]`;
    } else if (msg.type === 'comment_reaction') {
        selector = `.reaction-buttons[data-comment-id="${msg.content_id}"]`;
    }

    const container = document.querySelector(selector);
    if (container) {
        const likeCount = container.querySelector('.like-count');
        const dislikeCount = container.querySelector('.dislike-count');
        if (likeCount) likeCount.textContent = msg.like_count;
        if (dislikeCount) dislikeCount.textContent = msg.dislike_count;
    }
}

// Online state lives in state.onlineUsers, so it survives any re-render and
// status events that arrive before the user list exists are not lost.
function setUserOnline(userId, online) {
    if (online) {
        state.onlineUsers.add(userId);
    } else {
        state.onlineUsers.delete(userId);
    }
    paintUserStatus(userId);
}

function paintUserStatus(userId) {
    const el = document.getElementById(`user-status-${userId}`);
    if (!el) return;
    const online = state.onlineUsers.has(userId);
    el.style.color = online ? '#00ff00' : '#888';
    el.textContent = online ? '● Online' : '○ Offline';
}

function refreshUserStatuses() {
    state.users.forEach(u => paintUserStatus(u.id));
}

function moveContactToTop(userId) {
    const index = state.users.findIndex(u => u.id === userId);
    if (index <= 0) return; // unknown contact or already first
    const [contact] = state.users.splice(index, 1);
    state.users.unshift(contact);
    renderUserList();
}

function markUserUnread(userId) {
    state.unread.add(userId);
    const el = document.getElementById(`user-name-${userId}`);
    if (el) { el.style.fontWeight = 'bold'; el.style.color = '#bb86fc'; }
}

// Throttling function
function throttle(func, limit) {
    let inThrottle;
    return function () {
        const args = arguments;
        const context = this;
        if (!inThrottle) {
            func.apply(context, args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    }
}

async function renderChat(targetUserId, nickname) {
    state.activeChatUser = targetUserId;
    state.chatOffset = 0;
    state.chatHasMore = true;

    // Opening a chat clears its unread marker; the sidebar renders from state
    state.unread.delete(targetUserId);
    renderUserList();

    const chatContainer = document.getElementById('chat-view');
    if (!chatContainer) return;

    const headerTitle = `💬 Chat with <span style="color:#bb86fc">${escapeHTML(nickname)}</span>`;

    chatContainer.innerHTML = `
        <div class="card" style="height: 100%; display: flex; flex-direction: column; padding: 0;">
            <div style="padding: 1rem; border-bottom: 1px solid #444; font-weight: bold; background: #2d2d2d; display: flex; justify-content: space-between; align-items: center;">
                <span>${headerTitle}</span>
                <button onclick="closeChat()" class="btn-link" style="color: #ff5555; padding: 0;">Close</button>
            </div>
            <div id="chat-messages" style="flex: 1; overflow-y: auto; padding: 1rem; display: flex; flex-direction: column-reverse; background: #1e1e1e;">
                <!-- Messages go here -->
            </div>
            <div id="typing-indicator" class="typing-indicator">
                <span class="typing-name"></span> is typing<span class="typing-dots"><span>.</span><span>.</span><span>.</span></span>
            </div>
            <form id="chat-form" style="padding: 1rem; border-top: 1px solid #444; background: #222;">
                <div style="display: flex; gap: 0.5rem;">
                    <input type="text" id="chat-input" name="content" autocomplete="off" placeholder="Type a message..." style="flex: 1; padding: 0.8rem; background: #000; border: 1px solid #444; color: #e0e0e0;">
                    <button type="submit" class="btn" style="width: auto; margin: 0; padding: 0.8rem 1.5rem;">Send</button>
                </div>
            </form>
        </div>
    `;

    setupTypingDetection(document.getElementById('chat-input'), targetUserId);

    document.getElementById('chat-form').addEventListener('submit', (e) => {
        e.preventDefault();
        const input = e.target.elements.content;
        const text = input.value;
        if (!text) return;

        // Stop typing indicator immediately on send
        if (isCurrentlyTyping) {
            isCurrentlyTyping = false;
            clearTimeout(typingDebounceTimer);
            sendTypingEvent(targetUserId, false);
        }

        const payload = { type: "message", receiver_id: targetUserId, content: text };
        state.socket.send(JSON.stringify(payload));
        input.value = '';
    });

    const msgList = document.getElementById('chat-messages');
    msgList.addEventListener('scroll', throttle(handleScroll, 300));

    await loadChatHistory(targetUserId);
}

async function handleScroll() {
    const list = document.getElementById('chat-messages');
    if (Math.abs(list.scrollTop) > (list.scrollHeight - list.clientHeight - 50)) {
        if (!state.chatLoading && state.chatHasMore) {
            loadChatHistory(state.activeChatUser);
        }
    }
}

async function loadChatHistory(targetUserId) {
    if (state.chatLoading) return;
    state.chatLoading = true;

    const list = document.getElementById('chat-messages');
    try {
        const response = await apiFetch(`/api/messages?user_id=${targetUserId}&offset=${state.chatOffset}`);
        if (!response.ok) return;

        const messages = await response.json();
        const received = messages ? messages.length : 0;

        if (received > 0) {
            state.chatOffset += received;
            const html = messages.map(msg => formatMessage(msg)).join('');
            list.insertAdjacentHTML('beforeend', html);
        }

        // A short page means the conversation is fully loaded
        if (received < CHAT_PAGE_SIZE) state.chatHasMore = false;
    } catch (e) {
        console.error(e);
    } finally {
        state.chatLoading = false;
    }
}

function appendMessage(msg) {
    const list = document.getElementById('chat-messages');
    if (list) {
        list.insertAdjacentHTML('afterbegin', formatMessage(msg));
    }
}

// Messages must show the date they were sent, not just the time.
function formatMessageDate(value) {
    const date = new Date(value);
    if (isNaN(date)) return '';
    return date.toLocaleString([], {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
    });
}

function formatMessage(msg) {
    const isThem = msg.sender_id === state.activeChatUser;
    const align = isThem ? 'flex-start' : 'flex-end';
    const bg = isThem ? '#444' : '#bb86fc';
    const color = isThem ? '#e0e0e0' : '#000';

    let nickname = isThem ? escapeHTML(msg.sender_nickname || "User") : "You";
    if (isThem && state.users) {
        const u = state.users.find(u => u.id === msg.sender_id);
        if (u) nickname = escapeHTML(u.nickname);
    }

    return `
        <div style="display: flex; justify-content: ${align}; margin-bottom: 0.5rem; width: 100%;">
            <div style="background: ${bg}; color: ${color}; padding: 0.5rem 1rem; border-radius: 4px; max-width: 70%; word-break: break-word;">
                <div style="font-size: 0.7rem; font-weight: bold; margin-bottom: 0.2rem; opacity: 0.8;">${nickname}</div>
                ${escapeHTML(msg.content)}
                <div style="font-size: 0.6rem; opacity: 0.7; text-align: right; margin-top: 0.2rem;">
                    ${formatMessageDate(msg.created_at || msg.timestamp)}
                </div>
            </div>
        </div>
    `;
}

function closeChat() {
    // Stop any active typing indicator when closing chat
    if (isCurrentlyTyping && state.activeChatUser) {
        isCurrentlyTyping = false;
        clearTimeout(typingDebounceTimer);
        sendTypingEvent(state.activeChatUser, false);
    }
    hideTypingIndicator();
    state.activeChatUser = null;
    renderUserList();
    document.getElementById('chat-view').innerHTML = '<div style="height:100%; display:flex; align-items:center; justify-content:center; color:#666;">Select a user to chat</div>';
}

async function renderHome() {
    state.view = 'feed';

    // Check if the dashboard grid already exists
    if (!document.querySelector('.dashboard-grid')) {
        app.innerHTML = `
            <div class="dashboard-grid">
                <!-- Left Column: Categories & Users -->
                <div class="col-users card" style="display: flex; flex-direction: column; gap: 1rem; overflow: hidden; padding: 1rem;">
                    
                    <!-- Categories Section -->
                    <div class="sidebar-section" style="flex: 0 0 auto; max-height: 50%; overflow-y: auto; border-bottom: 1px solid #444; padding-bottom: 1rem;">
                        <h3 style="margin-bottom: 1rem; color: #bb86fc;">Categories</h3>
                        <div id="category-list"></div>
                    </div>

                    <!-- Users Section -->
                    <div class="sidebar-section" style="flex: 1; overflow-y: auto;">
                        <h3 style="margin-bottom: 1rem; color: #bb86fc;">Online Users</h3>
                        <div id="user-list">Loading users...</div>
                    </div>
                </div>

                <!-- Middle Column: Feed (Chat + Posts) -->
                <div class="col-feed">
                    <div id="chat-view" class="card" style="margin-bottom: 2rem; min-height: 300px;">
                        <div style="height:100%; display:flex; align-items:center; justify-content:center; color:#666; border: 1px dashed #444;">Select a user to chat</div>
                    </div>

                    <div id="posts-container" class="post-list">
                        <p>Loading posts...</p>
                    </div>
                </div>

                <!-- Right Column: Create Post -->
                <div class="col-create card">
                    <h2>Create Post</h2>
                    <div id="home-error" class="error-msg"></div>
                    <form id="create-post-form">
                        <div class="input-group">
                            <label>Title</label>
                            <input type="text" name="title" required>
                        </div>
                        <div class="input-group">
                            <label>Category</label>
                            <select name="category" style="width: 100%; padding: 0.8rem; background: #000; border: 1px solid #e0e0e0; color: #e0e0e0;">
                                ${CATEGORIES.map(c => `<option value="${c}">${c}</option>`).join('')}
                            </select>
                        </div>
                        <div class="input-group">
                            <label>Content</label>
                            <textarea name="content" rows="4" style="width: 100%; padding: 0.8rem; background: #000; border: 1px solid #e0e0e0; color: #e0e0e0;" required></textarea>
                        </div>
                        <button type="submit" class="btn">Post</button>
                    </form>
                </div>
            </div>
        `;
        document.getElementById('create-post-form').addEventListener('submit', handleCreatePost);
    }

    renderCategoryMenu();
    loadPosts();
    await loadUsers();
}

function renderCategoryMenu() {
    const list = document.getElementById('category-list');
    if (!list) return;

    const allCats = ["All", ...CATEGORIES];
    list.innerHTML = allCats.map(cat => {
        const isActive = state.activeCategory === cat;
        return `
            <div onclick="setCategory('${cat}')" class="category-btn ${isActive ? 'active' : ''}">
                ${cat}
            </div>
        `;
    }).join('');
}

function setCategory(cat) {
    state.activeCategory = cat;
    state.view = 'feed';
    renderCategoryMenu(); // Re-render to update active state
    renderFeed(); // Filter and render posts
}

async function loadUsers() {
    try {
        const response = await apiFetch('/api/users');
        if (!response.ok) return;
        // The server already orders contacts by last message, then alphabetically
        state.users = await response.json() || [];
        renderUserList();
    } catch (e) {
        console.error(e);
    }
}

function renderUserList() {
    const list = document.getElementById('user-list');
    if (!list) return;

    if (state.users.length === 0) {
        list.innerHTML = '<p style="color:#666; font-style: italic;">No other users yet.</p>';
        return;
    }

    list.innerHTML = state.users.map(u => {
        const highlighted = state.activeChatUser === u.id || state.unread.has(u.id);
        const style = highlighted ? 'font-weight: bold; color: #bb86fc;' : 'color: inherit;';
        const online = state.onlineUsers.has(u.id);
        const badge = `<span id="user-status-${u.id}" style="color:${online ? '#00ff00' : '#888'}; font-size:12px;">${online ? '● Online' : '○ Offline'}</span>`;

        return `
            <div class="user-item" data-user-id="${u.id}" style="cursor: pointer; padding: 0.8rem 0.5rem; border-bottom: 1px solid #333; display: flex; justify-content: space-between; align-items: center; transition: background 0.2s;" onmouseover="this.style.background='#2a2a2a'" onmouseout="this.style.background='transparent'">
                <span id="user-name-${u.id}" style="${style}">${escapeHTML(u.nickname)}</span>
                ${badge}
            </div>
        `;
    }).join('');
}

// Event delegation avoids building the nickname into an inline onclick handler.
document.addEventListener('click', (e) => {
    const item = e.target.closest('.user-item');
    if (!item) return;
    const userId = parseInt(item.dataset.userId, 10);
    const contact = state.users.find(u => u.id === userId);
    if (contact) renderChat(contact.id, contact.nickname);
});

async function loadPosts() {
    const container = document.getElementById('posts-container');
    try {
        const response = await apiFetch('/api/posts/');
        if (!response.ok) throw new Error('Failed to load posts');

        const posts = await response.json();
        state.allPosts = posts || []; // Save to state
        renderFeed();

    } catch (e) {
        if (container) container.innerHTML = `<p class="error-msg" style="display:block;">Error loading posts: ${e.message}</p>`;
    }
}

function renderFeed() {
    if (state.view !== 'feed') return; // a post detail is open in this column
    const container = document.getElementById('posts-container');
    if (!container) return;

    let displayPosts = state.allPosts;
    if (state.activeCategory !== 'All') {
        displayPosts = state.allPosts.filter(p => p.category === state.activeCategory);
    }

    if (displayPosts.length === 0) {
        container.innerHTML = `<p style="text-align: center; color: #888;">No posts found for ${state.activeCategory}.</p>`;
        return;
    }

    container.innerHTML = displayPosts.map(post => `
        <div class="post">
            <div class="post-header">
                <span>${escapeHTML(post.nickname)}</span>
                <span>${new Date(post.created_at).toLocaleString()}</span>
            </div>
            <h3 style="margin: 0.5rem 0; color: #bb86fc;">${escapeHTML(post.title)} <span style="font-size: 0.8em; color: #e0e0e0; border: 1px solid #666; padding: 2px 6px; border-radius: 4px; margin-left: 10px;">${escapeHTML(post.category)}</span></h3>
            <p>${escapeHTML(post.content)}</p>
            <div class="reaction-buttons" data-post-id="${post.id}" style="margin-top: 10px; display: flex; gap: 10px;">
                <button class="like-btn" data-action="like">
                    👍 <span class="like-count">${post.likes || 0}</span>
                </button>
                <button class="dislike-btn" data-action="dislike">
                    👎 <span class="dislike-count">${post.dislikes || 0}</span>
                </button>
                <button class="btn-link view-comments-btn" data-post='${JSON.stringify(post).replace(/'/g, "&#39;")}' style="text-align: left; margin: 0; padding: 0; width: auto; margin-left: auto;">View Comments</button>
            </div>
        </div>
    `).join('');
}
// (duplicate renderFeed removed — only one definition above is used)

document.addEventListener('click', (e) => {
    if (e.target.classList.contains('view-comments-btn')) {
        e.preventDefault();
        const postData = JSON.parse(e.target.dataset.post);
        renderPostDetail(postData);
    }
});

// ... (renderPostDetail and other functions) ...

// The post detail is rendered inside the feed column so that the chat/users
// sidebar stays visible at all times, as required.
async function renderPostDetail(post) {
    if (!document.getElementById('posts-container')) {
        await renderHome();
    }

    const container = document.getElementById('posts-container');
    if (!container) return;

    state.view = 'post';
    container.innerHTML = `
         <div>
            <button class="btn-link" style="text-align: left; margin-bottom: 1rem;" onclick="backToFeed()">← Back to Feed</button>
            <div class="card" style="margin-bottom: 2rem; border-color: #bb86fc;">
                <div class="post-header">
                    <span>${escapeHTML(post.nickname)}</span>
                    <span>${new Date(post.created_at).toLocaleString()}</span>
                </div>
                <h2 style="margin: 0.5rem 0; border: none;">${escapeHTML(post.title)} <span style="font-size: 0.6em; color: #e0e0e0; border: 1px solid #666; padding: 2px 6px; border-radius: 4px; vertical-align: middle;">${escapeHTML(post.category)}</span></h2>
                <p style="font-size: 1.1rem; line-height: 1.5;">${escapeHTML(post.content)}</p>
                <div class="reaction-buttons" data-post-id="${post.id}" style="margin-top: 10px; display: flex; gap: 10px;">
                    <button class="like-btn" data-action="like">
                        👍 <span class="like-count">${post.likes || 0}</span>
                    </button>
                    <button class="dislike-btn" data-action="dislike">
                        👎 <span class="dislike-count">${post.dislikes || 0}</span>
                    </button>
                </div>
            </div>
            <div class="card">
                <h3>Comments</h3>
                 <div id="comments-list" style="margin-bottom: 1rem;">
                    <p>Loading comments...</p>
                </div>
                <div id="comment-error" class="error-msg"></div>
                <form id="comment-form">
                    <input type="hidden" name="post_id" value="${post.id}">
                    <div class="input-group">
                        <textarea name="content" rows="2" placeholder="Write a comment..." style="width: 100%; padding: 0.8rem; background: #000; border: 1px solid #e0e0e0; color: #e0e0e0;" required></textarea>
                    </div>
                    <button type="submit" class="btn" style="padding: 0.5rem;">Add Comment</button>
                </form>
            </div>
        </div>
    `;
    document.getElementById('comment-form').addEventListener('submit', (e) => handleCreateComment(e, post.id));
    loadComments(post.id);
}

function backToFeed() {
    state.view = 'feed';
    renderFeed();
}

async function loadComments(postId) {
    const list = document.getElementById('comments-list');
    try {
        const response = await apiFetch(`/api/comments?post_id=${postId}`);
        const comments = await response.json();
        if (!comments || comments.length === 0) {
            list.innerHTML = '<p style="color: #666; font-style: italic;">No comments yet.</p>';
            return;
        }
        list.innerHTML = comments.map(c => `
            <div style="border-bottom: 1px solid #444; padding: 0.5rem 0; margin-bottom: 0.5rem;">
                <div style="font-size: 0.8rem; color: #888; margin-bottom: 0.2rem;">
                    <span style="color: #bb86fc;">${escapeHTML(c.nickname)}</span> • ${new Date(c.created_at).toLocaleString()}
                </div>
                <p>${escapeHTML(c.content)}</p>
                 <div class="reaction-buttons" data-comment-id="${c.id}" style="margin-top: 5px; display: flex; gap: 10px;">
                    <button class="like-btn" data-action="like" style="font-size: 0.8rem; padding: 2px 6px;">
                        👍 <span class="like-count">${c.likes || 0}</span>
                    </button>
                    <button class="dislike-btn" data-action="dislike" style="font-size: 0.8rem; padding: 2px 6px;">
                        👎 <span class="dislike-count">${c.dislikes || 0}</span>
                    </button>
                </div>
            </div>
         `).join('');
    } catch (e) {
        list.innerHTML = `<p class="error-msg">Error loading comments</p>`;
    }
}

function renderLogin(notice) {
    app.innerHTML = `
        <div class="auth-box">
            <h2>Login</h2>
            <div id="error-box" class="error-msg" ${notice ? 'style="display:block;"' : ''}>${notice ? escapeHTML(notice) : ''}</div>
            <form id="login-form">
                <div class="input-group">
                    <label>Email or Nickname</label>
                    <input type="text" name="identifier" required>
                </div>
                <div class="input-group">
                    <label>Password</label>
                    <input type="password" name="password" required>
                </div>
                <button type="submit" class="btn">Login</button>
            </form>
            <p>Don't have an account? <button class="btn-link" onclick="renderRegister()">Register</button></p>
        </div>
    `;
    document.getElementById('login-form').addEventListener('submit', handleLogin);
}

function renderRegister() {
    app.innerHTML = `
        <div class="auth-box">
            <h2>Register</h2>
            <div id="error-box" class="error-msg"></div>
            <form id="register-form">
                <div class="input-group">
                    <label>Nickname</label>
                    <input type="text" name="nickname" required>
                </div>
                <div class="input-group">
                    <label>Age</label>
                    <input type="number" name="age" required>
                </div>
                <div class="input-group">
                    <label>Gender</label>
                    <select name="gender" style="width: 100%; padding: 0.8rem; background: #000; border: 1px solid #e0e0e0; color: #e0e0e0;">
                        <option value="male">Male</option>
                        <option value="female">Female</option>
                        <option value="other">Other</option>
                    </select>
                </div>
                <div class="input-group">
                    <label>First Name</label>
                    <input type="text" name="first_name" required>
                </div>
                <div class="input-group">
                    <label>Last Name</label>
                    <input type="text" name="last_name" required>
                </div>
                <div class="input-group">
                    <label>Email</label>
                    <input type="email" name="email" required>
                </div>
                <div class="input-group">
                    <label>Password</label>
                    <input type="password" name="password" required>
                </div>
                <button type="submit" class="btn">Register</button>
            </form>
            <p>Already have an account? <button class="btn-link" onclick="renderLogin()">Login</button></p>
        </div>
    `;
    document.getElementById('register-form').addEventListener('submit', handleRegister);
}

// Handlers
async function handleLogin(e) { e.preventDefault(); submitAuthForm(e, '/api/login', async () => { state.isLoggedIn = true; logoutBtn.style.display = 'block'; await fetchUserInfo(); initWebSocket(); renderHome(); }); }
async function handleRegister(e) { e.preventDefault(); submitAuthForm(e, '/api/register', () => { renderLogin('Registration successful, you can log in now.'); }); }
async function handleCreateComment(e, postId) { e.preventDefault(); /* ... */ const formData = new FormData(e.target); const data = Object.fromEntries(formData.entries()); const errorBox = document.getElementById('comment-error'); data.post_id = parseInt(data.post_id); try { const response = await apiFetch('/api/comments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }); if (response.ok) { e.target.reset(); loadComments(postId); } else { errorBox.textContent = await response.text(); errorBox.style.display = 'block'; } } catch (error) { errorBox.textContent = 'Network error'; errorBox.style.display = 'block'; } }
async function handleCreatePost(e) { e.preventDefault(); const formData = new FormData(e.target); const data = Object.fromEntries(formData.entries()); const errorBox = document.getElementById('home-error'); try { const response = await apiFetch('/api/posts/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }); if (response.ok) { e.target.reset(); loadPosts(); } else { errorBox.textContent = await response.text(); errorBox.style.display = 'block'; } } catch (error) { errorBox.textContent = 'Network error'; errorBox.style.display = 'block'; } }

async function submitAuthForm(e, url, onSuccess) {
    const formData = new FormData(e.target);
    const data = Object.fromEntries(formData.entries());
    if (data.age) data.age = parseInt(data.age);
    const errorBox = document.getElementById('error-box');
    try {
        const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
        if (response.ok) { onSuccess(); }
        else { errorBox.textContent = await response.text(); errorBox.style.display = 'block'; }
    } catch (error) { errorBox.textContent = 'Network error'; errorBox.style.display = 'block'; }
}

logoutBtn.addEventListener('click', async () => {
    try {
        await fetch('/api/logout', { method: 'POST' });
    } catch (_) {}

    // The session cookie is HttpOnly, only the server can clear it.
    state.isLoggedIn = false;
    state.user = null;
    state.users = [];
    state.onlineUsers.clear();
    state.unread.clear();
    state.activeChatUser = null;
    logoutBtn.style.display = 'none';

    if (state.socket) {
        state.socket.onclose = null; // no reconnect attempts after an explicit logout
        state.socket.close();
        state.socket = null;
    }

    renderLogin();
});

// Expose globals
window.renderLogin = renderLogin;
window.renderRegister = renderRegister;
window.renderHome = renderHome;
window.renderPostDetail = renderPostDetail;
window.renderChat = renderChat;
window.closeChat = closeChat;
window.setCategory = setCategory;
window.backToFeed = backToFeed;


// ============================================
// ОБРАБОТЧИК ЛАЙКОВ И ДИЗЛАЙКОВ
// ============================================


document.addEventListener('click', async (e) => {
    const button = e.target.closest('.like-btn, .dislike-btn');
    if (!button) return;

    e.preventDefault();


    const container = button.closest('.reaction-buttons');
    const postId = container?.dataset.postId;
    const commentId = container?.dataset.commentId;
    const action = button.dataset.action;



    if (!postId && !commentId) {
        return;
    }

    const endpoint = '/api/reactions';

    const payload = {
        type: action
    };

    if (postId) payload.post_id = parseInt(postId);
    if (commentId) payload.comment_id = parseInt(commentId);



    try {
        const response = await apiFetch(endpoint, {
            method: 'POST',
            credentials: 'include',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });



        if (!response.ok) {
            return;
        }

        const data = await response.json();

        if (data.success) {
            const likeCount = container.querySelector('.like-count');
            const dislikeCount = container.querySelector('.dislike-count');

            if (likeCount && dislikeCount) {
                likeCount.textContent = data.likes || 0;
                dislikeCount.textContent = data.dislikes || 0;
                console.log('✅ Счетчики обновлены:', data.likes, '/', data.dislikes);
            }

            container.querySelector('.like-btn')?.classList.remove('active');
            container.querySelector('.dislike-btn')?.classList.remove('active');

            const userReaction = data.reaction || data.user_reaction;

            if (userReaction === 'like') {
                container.querySelector('.like-btn')?.classList.add('active');
            } else if (userReaction === 'dislike') {
                container.querySelector('.dislike-btn')?.classList.add('active');
            }
        }
    } catch (error) {

    }
});


