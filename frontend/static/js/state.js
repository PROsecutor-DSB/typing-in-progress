// Single source of truth for everything the views render from.

export const CATEGORIES = [
    'General', 'Tech', 'Random', 'Blockchain',
    'Startups', 'Economics', 'Science', 'Music', 'Movies'
];

// Must match messagePageSize on the server
export const CHAT_PAGE_SIZE = 10;

export const WS_MAX_RETRIES = 6;

export const state = {
    isLoggedIn: false, // Confirmed by /api/me, never guessed from the cookie
    user: null, // { id, nickname }
    users: [], // Chat contacts, ordered by last message
    onlineUsers: new Set(), // Ids of users currently connected
    unread: new Set(), // Ids of users with unread messages
    activeChatUser: null,
    socket: null,
    wsRetries: 0,
    chatOffset: 0,
    chatLoading: false,
    chatHasMore: true,
    allPosts: [],
    activeCategory: 'All',
    route: { name: 'feed', params: [] }
};

// clearSession drops everything tied to the logged in user.
export function clearSession() {
    state.isLoggedIn = false;
    state.user = null;
    state.users = [];
    state.allPosts = [];
    state.onlineUsers.clear();
    state.unread.clear();
    state.activeChatUser = null;
    state.wsRetries = 0;
}
