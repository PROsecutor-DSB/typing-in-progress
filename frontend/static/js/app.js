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
    isLoggedIn: document.cookie.includes('session_token'),
    user: null, // Current logged in user
    users: [], // List of all users
    activeChatUser: null, // ID of user we are chatting with
    socket: null,
    chatOffset: 0,
    chatLoading: false,
    allPosts: [], // Store all posts locally
    activeCategory: 'All' // Default category
};

// Typing indicator state
let typingDebounceTimer = null;
let typingSafetyTimer = null;
let isCurrentlyTyping = false;

// DOM Elements
const app = document.getElementById('app');
const logoutBtn = document.getElementById('logout-btn');

const CATEGORIES = ["General", "Tech", "Random", "Blockchain", "Startups", "Economics", "Science", "Music", "Movies"];

async function fetchUserInfo() {
    try {
        const res = await fetch('/api/me');
        if (res.ok) {
            state.user = await res.json(); // { id, nickname }
        }
    } catch (_) {}
}

async function initApp() {
    if (state.isLoggedIn) {
        logoutBtn.style.display = 'block';
        await fetchUserInfo();   // know who we are BEFORE rendering users
        initWebSocket();
        renderHome();
    } else {
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

    state.socket.onopen = () => { console.log("Connected to WebSocket"); };
    state.socket.onmessage = (event) => { handleWsMessage(JSON.parse(event.data)); };
    state.socket.onclose = () => { 
        console.log("Disconnected from WebSocket"); 
        if (state.isLoggedIn) {
            console.log("Attempting to reconnect in 3s...");
            setTimeout(initWebSocket, 3000);
        }
    };
}

function handleWsMessage(msg) {
    if (msg.type === 'status') {
        updateUserStatus(msg.user_id, msg.online);
    } else if (msg.type === 'message') {
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

function updateUserStatus(userId, online) {
    const el = document.getElementById(`user-status-${userId}`);
    if (el) { 
        el.style.color = online ? '#00ff00' : '#888'; 
        el.innerHTML = online ? '● Online' : '○ Offline'; 
    }
}

function markUserUnread(userId) {
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

    // Reset all user names to normal weight
    document.querySelectorAll('[id^="user-name-"]').forEach(el => {
        el.style.fontWeight = 'normal';
        el.style.color = 'inherit';
    });
    
    // Highlight active user
    const activeEl = document.getElementById(`user-name-${targetUserId}`);
    if (activeEl) { 
        activeEl.style.fontWeight = 'bold'; 
        activeEl.style.color = '#bb86fc'; 
    }

    const chatContainer = document.getElementById('chat-view');
    if (!chatContainer) return;

    const isSelfChat = state.user && targetUserId === state.user.id;

    // Build chat header: show special label when chatting with yourself
    const headerTitle = isSelfChat
        ? `💬 Chat with <span style="color:#bb86fc">${escapeHTML(nickname)} (Me)</span>`
        : `💬 Chat with <span style="color:#bb86fc">${escapeHTML(nickname)}</span>`;

    const selfBanner = isSelfChat
        ? `<div style="background:rgba(187,134,252,0.1);border-left:3px solid #bb86fc;padding:0.5rem 1rem;font-size:0.8rem;color:#bb86fc;">📝 Note: You are chatting with yourself</div>`
        : '';

    chatContainer.innerHTML = `
        <div class="card" style="height: 100%; display: flex; flex-direction: column; padding: 0;">
            <div style="padding: 1rem; border-bottom: 1px solid #444; font-weight: bold; background: #2d2d2d; display: flex; justify-content: space-between; align-items: center;">
                <span>${headerTitle}</span>
                <button onclick="closeChat()" class="btn-link" style="color: #ff5555; padding: 0;">Close</button>
            </div>
            ${selfBanner}
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

    // Set up typing detection (skip if self-chat)
    const chatInput = document.getElementById('chat-input');
    if (!isSelfChat) {
        setupTypingDetection(chatInput, targetUserId);
    }

    document.getElementById('chat-form').addEventListener('submit', (e) => {
        e.preventDefault();
        const input = e.target.elements.content;
        const text = input.value;
        if (!text) return;

        // Stop typing indicator immediately on send
        if (isCurrentlyTyping && !isSelfChat) {
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
        if (!state.chatLoading) {
            loadChatHistory(state.activeChatUser);
        }
    }
}

async function loadChatHistory(targetUserId) {
    if (state.chatLoading) return;
    state.chatLoading = true;

    const list = document.getElementById('chat-messages');
    try {
        const response = await fetch(`/api/messages?user_id=${targetUserId}&offset=${state.chatOffset}`);
        const messages = await response.json();

        if (messages && messages.length > 0) {
            state.chatOffset += messages.length;
            const html = messages.map(msg => formatMessage(msg)).join('');
            list.insertAdjacentHTML('beforeend', html);
        }
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
                    ${new Date(msg.created_at || msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
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
    document.getElementById('chat-view').innerHTML = '<div style="height:100%; display:flex; align-items:center; justify-content:center; color:#666;">Select a user to chat</div>';
}

async function renderHome() {
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
    renderCategoryMenu(); // Re-render to update active state
    renderFeed(); // Filter and render posts
}

async function loadUsers() {
    try {
        const response = await fetch('/api/users');
        const users = await response.json();
        state.users = users;

        const list = document.getElementById('user-list');
        
        list.innerHTML = users.map(u => {
            const isSelf = state.user && u.id === state.user.id;
            const safeNickname = escapeHTML(u.nickname);
            const label = isSelf ? `${safeNickname} <span style="font-size:0.75rem; color:#bb86fc; font-weight:normal;">(Me)</span>` : safeNickname;
            const safeQuoteNickname = u.nickname.replace(/'/g, "\\'").replace(/"/g, "&quot;");
            
            // Check if there are unread messages or this is the active user
            const isActive = state.activeChatUser === u.id;
            const style = isActive ? 'font-weight: bold; color: #bb86fc;' : 'color: inherit;';
            const badge = `<span id="user-status-${u.id}" style="color:#888; font-size:12px;">○ Offline</span>`;
            
            return `
            <div onclick="renderChat(${u.id}, '${safeQuoteNickname}')" style="cursor: pointer; padding: 0.8rem 0.5rem; border-bottom: 1px solid #333; display: flex; justify-content: space-between; align-items: center; transition: background 0.2s;" onmouseover="this.style.background='#2a2a2a'" onmouseout="this.style.background='transparent'">
                <span id="user-name-${u.id}" style="${style}">${label}</span>
                ${badge}
            </div>
        `;
        }).join('');
    } catch (e) {
        console.error(e);
    }
}

async function loadPosts() {
    const container = document.getElementById('posts-container');
    try {
        const response = await fetch('/api/posts/');
        if (!response.ok) throw new Error('Failed to load posts');

        const posts = await response.json();
        state.allPosts = posts || []; // Save to state
        renderFeed();

    } catch (e) {
        if (container) container.innerHTML = `<p class="error-msg" style="display:block;">Error loading posts: ${e.message}</p>`;
    }
}

function renderFeed() {
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
                <span>${post.nickname}</span>
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

// AFTER other window exposures
async function renderPostDetail(post) {
    app.innerHTML = `
         <div class="container" style="display: block;">
            <button class="btn-link" style="text-align: left; margin-bottom: 1rem;" onclick="renderHome()">← Back to Feed</button>
            <div class="card" style="margin-bottom: 2rem; border-color: #bb86fc;">
                <div class="post-header">
                    <span>${post.nickname}</span>
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

async function loadComments(postId) {
    const list = document.getElementById('comments-list');
    try {
        const response = await fetch(`/api/comments?post_id=${postId}`);
        const comments = await response.json();
        if (!comments || comments.length === 0) {
            list.innerHTML = '<p style="color: #666; font-style: italic;">No comments yet.</p>';
            return;
        }
        list.innerHTML = comments.map(c => `
            <div style="border-bottom: 1px solid #444; padding: 0.5rem 0; margin-bottom: 0.5rem;">
                <div style="font-size: 0.8rem; color: #888; margin-bottom: 0.2rem;">
                    <span style="color: #bb86fc;">${c.nickname}</span> • ${new Date(c.created_at).toLocaleString()}
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

function renderLogin() {
    app.innerHTML = `
        <div class="auth-box">
            <h2>Login</h2>
            <div id="error-box" class="error-msg"></div>
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
async function handleRegister(e) { e.preventDefault(); submitAuthForm(e, '/api/register', () => { alert('Success'); renderLogin(); }); }
async function handleCreateComment(e, postId) { e.preventDefault(); /* ... */ const formData = new FormData(e.target); const data = Object.fromEntries(formData.entries()); const errorBox = document.getElementById('comment-error'); data.post_id = parseInt(data.post_id); try { const response = await fetch('/api/comments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }); if (response.ok) { e.target.reset(); loadComments(postId); } else { errorBox.textContent = await response.text(); errorBox.style.display = 'block'; } } catch (error) { errorBox.textContent = 'Network error'; errorBox.style.display = 'block'; } }
async function handleCreatePost(e) { e.preventDefault(); const formData = new FormData(e.target); const data = Object.fromEntries(formData.entries()); const errorBox = document.getElementById('home-error'); try { const response = await fetch('/api/posts/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }); if (response.ok) { e.target.reset(); loadPosts(); } else { errorBox.textContent = await response.text(); errorBox.style.display = 'block'; } } catch (error) { errorBox.textContent = 'Network error'; errorBox.style.display = 'block'; } }

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
    await fetch('/api/logout', { method: 'POST' });
    document.cookie = 'session_token=; Max-Age=0; path=/;';
    state.isLoggedIn = false;
    logoutBtn.style.display = 'none';
    if (state.socket) state.socket.close();
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
        const response = await fetch(endpoint, {
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


