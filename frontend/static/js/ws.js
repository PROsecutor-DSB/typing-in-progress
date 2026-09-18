// Websocket lifecycle: one connection per session, with a bounded
// exponential backoff instead of an endless retry loop.

import { state, WS_MAX_RETRIES } from './state.js';
import { fetchCurrentUser } from './api.js';

let handlers = {
    onMessage: () => {},
    onDisconnect: () => {},
    onSessionExpired: () => {}
};

export function configureSocket(overrides) {
    handlers = { ...handlers, ...overrides };
}

export function connect() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(`${protocol}//${window.location.host}/ws`);
    state.socket = socket;

    socket.onopen = () => { state.wsRetries = 0; };

    socket.onmessage = event => {
        try {
            handlers.onMessage(JSON.parse(event.data));
        } catch (_) { /* ignore malformed frames */ }
    };

    socket.onclose = () => {
        state.socket = null;
        handlers.onDisconnect();
        scheduleReconnect();
    };
}

export function send(payload) {
    if (!state.socket || state.socket.readyState !== WebSocket.OPEN) return false;
    state.socket.send(JSON.stringify(payload));
    return true;
}

// closeSocket disconnects without scheduling a reconnect, for logout and for
// an expired session.
export function closeSocket() {
    if (!state.socket) return;
    state.socket.onclose = null;
    state.socket.close();
    state.socket = null;
}

export function scheduleReconnect() {
    if (!state.isLoggedIn || state.wsRetries >= WS_MAX_RETRIES) return;

    const delay = Math.min(30000, 1000 * Math.pow(2, state.wsRetries));
    state.wsRetries++;

    setTimeout(async () => {
        if (!state.isLoggedIn) return;
        // Re-check the session first: an expired login must end on the login
        // screen, not in a retry loop.
        if (!await fetchCurrentUser()) {
            handlers.onSessionExpired();
            return;
        }
        connect();
    }, delay);
}
