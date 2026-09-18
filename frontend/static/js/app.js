// Application bootstrap: wires the router, the socket and the views together.

import { state, clearSession } from './state.js';
import { fetchCurrentUser, setUnauthorizedHandler, api } from './api.js';
import { initRouter, navigate } from './router.js';
import { configureSocket, connect, closeSocket } from './ws.js';
import { el } from './utils.js';
import { renderLogin, renderRegister, configureAuth, setLoginNotice } from './views/auth.js';
import { ensureDashboard, renderFeed, renderNotFound } from './views/feed.js';
import { renderPost } from './views/post.js';
import {
    initChat, openChat, clearChat, refreshUserStatuses,
    setUserOnline, handleIncomingMessage, handleTypingEvent
} from './views/chat.js';
import { initReactions, applyReactionUpdate } from './views/reactions.js';

// ------------------------------------------------------------------ routes

const routes = [
    { pattern: /^\/login\/?$/, handler: guestOnly(renderLogin) },
    { pattern: /^\/register\/?$/, handler: guestOnly(renderRegister) },
    {
        pattern: /^\/$/,
        handler: authenticated(async (_params, query) => {
            state.route = { name: 'feed', params: [] };
            await ensureDashboard();
            renderFeed();
            await syncChat(query);
        })
    },
    {
        // The open conversation lives in the query string; keep the older
        // /chat/3 shape working as a redirect.
        pattern: /^\/chat\/(\d+)\/?$/,
        handler: authenticated(([id]) => navigate(`/?chat=${id}`, { replace: true }))
    },
    {
        pattern: /^\/posts\/(\d+)\/?$/,
        handler: authenticated(async ([id], query) => {
            state.route = { name: 'post', params: [id] };
            await ensureDashboard();
            await renderPost(parseInt(id, 10));
            await syncChat(query);
        })
    }
];

async function notFound(path) {
    if (!state.isLoggedIn) {
        navigate('/login', { replace: true });
        return;
    }
    state.route = { name: 'notfound', params: [] };
    await ensureDashboard();
    renderNotFound(path);
}

// The open conversation lives in the query string (?chat=3), so it survives a
// reload and can be combined with any page.
async function syncChat(query) {
    const requested = parseInt(query?.get('chat'), 10);

    if (requested) {
        if (state.activeChatUser !== requested) await openChat(requested);
        return;
    }

    if (state.activeChatUser !== null) clearChat();
}

function authenticated(handler) {
    return async (params, query) => {
        if (!state.isLoggedIn) {
            navigate('/login', { replace: true });
            return;
        }
        await handler(params, query);
    };
}

function guestOnly(handler) {
    return async (params, query) => {
        if (state.isLoggedIn) {
            navigate('/', { replace: true });
            return;
        }
        await handler(params, query);
    };
}

// ------------------------------------------------------------- session flow

function showLogoutButton(visible) {
    el('logout-btn')?.classList.toggle('hidden', !visible);
}

async function afterLogin() {
    state.isLoggedIn = await fetchCurrentUser();
    if (!state.isLoggedIn) return;
    showLogoutButton(true);
    connect();
    navigate('/', { replace: true });
}

function handleSessionExpired() {
    closeSocket();
    clearSession();
    showLogoutButton(false);
    setLoginNotice('Your session has expired, please log in again.');
    navigate('/login', { replace: true });
}

async function handleLogout() {
    try {
        await api.logout();
    } catch (_) { /* the session is dropped locally either way */ }

    closeSocket();
    clearSession();
    showLogoutButton(false);
    setLoginNotice('');
    navigate('/login', { replace: true });
}

function dispatchSocketMessage(msg) {
    switch (msg.type) {
        case 'status':
            setUserOnline(msg.user_id, msg.online);
            break;
        case 'message':
            handleIncomingMessage(msg);
            break;
        case 'typing':
            handleTypingEvent(msg);
            break;
        case 'post_reaction':
        case 'comment_reaction':
            applyReactionUpdate(msg);
            break;
    }
}

// --------------------------------------------------------------- bootstrap

export async function start() {
    setUnauthorizedHandler(handleSessionExpired);
    configureAuth({ afterLogin });
    configureSocket({
        onMessage: dispatchSocketMessage,
        onDisconnect: () => {
            // Nobody is known to be online while the socket is down
            state.onlineUsers.clear();
            refreshUserStatuses();
        },
        onSessionExpired: handleSessionExpired
    });

    initChat();
    initReactions();
    el('logout-btn')?.addEventListener('click', handleLogout);

    state.isLoggedIn = await fetchCurrentUser();
    showLogoutButton(state.isLoggedIn);
    if (state.isLoggedIn) connect();

    await initRouter(routes, notFound);
}

if (typeof document !== 'undefined' && document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
} else if (typeof document !== 'undefined') {
    start();
}
