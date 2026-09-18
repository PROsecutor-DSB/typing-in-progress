// Every call to the backend goes through here.

import { state } from './state.js';

let unauthorizedHandler = () => {};

// The session cookie is HttpOnly, so a 401 is the only reliable signal that
// the session is gone. Registering the handler here keeps api.js free of any
// dependency on the views.
export function setUnauthorizedHandler(handler) {
    unauthorizedHandler = handler;
}

export async function apiFetch(url, options) {
    const response = await fetch(url, options);
    if (response.status === 401 && state.isLoggedIn) {
        unauthorizedHandler();
    }
    return response;
}

function postJSON(url, body, { guarded = true } = {}) {
    const options = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    };
    return guarded ? apiFetch(url, options) : fetch(url, options);
}

export const api = {
    // Auth calls use a plain fetch: a 401 here means "wrong credentials" or
    // "not logged in yet", not a session that just expired.
    me: () => fetch('/api/me'),
    login: data => postJSON('/api/login', data, { guarded: false }),
    register: data => postJSON('/api/register', data, { guarded: false }),
    logout: () => fetch('/api/logout', { method: 'POST' }),

    posts: () => apiFetch('/api/posts/'),
    createPost: data => postJSON('/api/posts/', data),
    comments: postId => apiFetch(`/api/comments?post_id=${postId}`),
    createComment: data => postJSON('/api/comments', data),
    react: payload => postJSON('/api/reactions', payload),
    users: () => apiFetch('/api/users'),
    messages: (userId, offset) => apiFetch(`/api/messages?user_id=${userId}&offset=${offset}`)
};

// fetchCurrentUser doubles as the session check: it tells us both who we are
// and whether we are still logged in.
export async function fetchCurrentUser() {
    try {
        const res = await api.me();
        if (res.ok) {
            state.user = await res.json();
            return true;
        }
    } catch (_) { /* offline */ }
    state.user = null;
    return false;
}
