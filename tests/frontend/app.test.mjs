// Frontend regression tests. Run with: node tests/frontend/app.test.mjs
//
// They cover the behaviour the audit checks: escaping, message format, online
// status, contact ordering, chat pagination, session handling and routing.

import { installDOM, response } from './dom-stub.js';

const dom = installDOM({
    routes: {
        '/api/me': response(200, { id: 1, nickname: 'alice' }),
        '/api/users': response(200, [{ id: 2, nickname: 'bob' }, { id: 3, nickname: 'carol' }]),
        '/api/posts/': response(200, [{
            id: 7, user_id: 2, nickname: '<img src=x onerror=alert(1)>', title: 'Hello',
            content: 'Body', category: 'Tech', created_at: '2026-09-18T05:31:39Z', likes: 1, dislikes: 0
        }]),
        '/api/comments': response(200, [{
            id: 1, post_id: 7, user_id: 3, nickname: '<b>carol</b>',
            content: 'Nice', created_at: '2026-09-18T05:31:39Z', likes: 0, dislikes: 0
        }]),
        '/api/messages': response(200, []),
        '/api/expired': response(401, 'Unauthorized')
    }
});

const base = new URL('../../frontend/static/js/', import.meta.url);
const load = name => import(new URL(name, base).href);

const { state, CHAT_PAGE_SIZE } = await load('state.js');
const utils = await load('utils.js');
const api = await load('api.js');
const ws = await load('ws.js');
const router = await load('router.js');
const chat = await load('views/chat.js');
const feed = await load('views/feed.js');

// Importing the entry point resolves the whole module graph: a renamed or
// missing export fails here instead of in the browser.
let graphError = null;
try {
    await load('app.js');
} catch (e) {
    graphError = e;
}

let failures = 0;
function check(name, condition, detail) {
    console.log(`${condition ? 'PASS  ' : 'FAIL  '}${name}${condition ? '' : `  -> ${detail}`}`);
    if (!condition) failures++;
}

check('the module graph resolves', graphError === null, graphError?.message);

// ------------------------------------------------------------------- utils
check('escapeHTML neutralises markup',
    utils.escapeHTML('<img src=x onerror=alert(1)>') === '&lt;img src=x onerror=alert(1)&gt;',
    utils.escapeHTML('<img>'));

const stamp = utils.formatDateTime('2026-09-18T05:31:39Z');
check('messages carry a date, not only a time',
    /\d{2}[./-]\d{2}[./-]\d{4}/.test(stamp) && /\d{2}:\d{2}/.test(stamp), stamp);
check('a broken timestamp renders as empty', utils.formatDateTime('nonsense') === '', 'threw or printed junk');

let throttled = 0;
const bump = utils.throttle(() => throttled++, 50);
bump(); bump(); bump();
check('throttle collapses a burst into one call', throttled === 1, throttled);

check('chat pages match the server page size', CHAT_PAGE_SIZE === 10, CHAT_PAGE_SIZE);

// -------------------------------------------------------------------- chat
state.user = { id: 1, nickname: 'alice' };
state.users = [{ id: 2, nickname: 'bob' }, { id: 3, nickname: '<b>carol</b>' }];

chat.setUserOnline(2, true); // status arrives before the list is rendered
chat.renderUserList();
const userList = dom.document.getElementById('user-list');
check('status received before render survives', userList.innerHTML.includes('● Online'), userList.innerHTML.slice(0, 120));
check('contact nicknames are escaped', userList.innerHTML.includes('&lt;b&gt;carol'), userList.innerHTML.slice(0, 200));

chat.renderUserList(); // navigating away and back re-renders from state
check('online status survives a re-render', dom.document.getElementById('user-list').innerHTML.includes('● Online'), 'lost');

chat.setUserOnline(2, false);
chat.renderUserList();
check('offline is applied', !dom.document.getElementById('user-list').innerHTML.includes('● Online'), 'still online');

chat.markUserUnread(3);
chat.renderUserList();
check('unread highlight survives a re-render',
    dom.document.getElementById('user-list').innerHTML.includes('user-name--active'), 'unread lost');

chat.moveContactToTop(3);
check('a new message moves the contact to the top', state.users[0].id === 3, JSON.stringify(state.users));
chat.moveContactToTop(999);
check('an unknown contact is ignored', state.users.length === 2, state.users.length);

state.activeChatUser = 2;
chat.handleIncomingMessage({ type: 'message', sender_id: 2, receiver_id: 1, content: '<script>x</script>', timestamp: '2026-09-18T05:31:39Z' });
const messages = dom.document.getElementById('chat-messages');
check('incoming message content is escaped', messages.innerHTML.includes('&lt;script&gt;'), messages.innerHTML.slice(0, 160));
check('incoming message is attributed to the sender', messages.innerHTML.includes('bob'), messages.innerHTML.slice(0, 200));
check('incoming message shows a date', /\d{2}[./-]\d{2}[./-]\d{4}/.test(messages.innerHTML), messages.innerHTML.slice(0, 260));

// -------------------------------------------------------------------- feed
state.route = { name: 'feed', params: [] };
await feed.loadPosts();
const posts = dom.document.getElementById('posts-container');
const header = posts.innerHTML.slice(posts.innerHTML.indexOf('post-header'), posts.innerHTML.indexOf('</h3>'));
check('the feed escapes the author nickname', header.includes('&lt;img') && !header.includes('<img'), header.slice(0, 160));
check('posts link to their own route', posts.innerHTML.includes('href="/posts/7"'), posts.innerHTML.slice(0, 200));

state.route = { name: 'post', params: ['7'] };
const openPost = posts.innerHTML;
feed.renderFeed(); // a late loadPosts() must not clobber an open post
check('the feed cannot overwrite another view', posts.innerHTML === openPost, 'post view was overwritten');
state.route = { name: 'feed', params: [] };

// ------------------------------------------------------------------ router
const visited = [];
const routes = [
    { pattern: /^\/$/, handler: (_p, query) => visited.push(['feed', query.get('chat')]) },
    { pattern: /^\/posts\/(\d+)\/?$/, handler: ([id]) => visited.push(['post', id]) }
];
await router.initRouter(routes, path => visited.push(['notfound', path]));
check('the router resolves the initial path', visited.at(-1)[0] === 'feed', JSON.stringify(visited));

await router.navigate('/posts/12');
check('the router matches a parameterised route', JSON.stringify(visited.at(-1)) === '["post","12"]', JSON.stringify(visited.at(-1)));
check('navigation pushes a history entry', dom.history.entries.at(-1) === '/posts/12', dom.history.entries.at(-1));

await router.navigate('/?chat=3');
check('the open conversation is read from the query string',
    JSON.stringify(visited.at(-1)) === '["feed","3"]', JSON.stringify(visited.at(-1)));

await router.navigate('/nowhere');
check('an unknown path falls back to not found',
    JSON.stringify(visited.at(-1)) === '["notfound","/nowhere"]', JSON.stringify(visited.at(-1)));

dom.window.dispatch('popstate', {});
check('the back button re-resolves the current route', visited.length > 4, visited.length);

// ------------------------------------------------------------ session / ws
let expiredCalls = 0;
api.setUnauthorizedHandler(() => expiredCalls++);

state.isLoggedIn = false;
await api.apiFetch('/api/expired');
check('a 401 while logged out is not treated as an expiry', expiredCalls === 0, expiredCalls);

state.isLoggedIn = true;
await api.apiFetch('/api/expired');
check('a 401 while logged in reports an expired session', expiredCalls === 1, expiredCalls);

state.wsRetries = 0;
ws.scheduleReconnect();
check('reconnect backs off while logged in', state.wsRetries === 1, state.wsRetries);
state.wsRetries = 6;
ws.scheduleReconnect();
check('reconnect gives up after the retry budget', state.wsRetries === 6, state.wsRetries);
state.isLoggedIn = false;
state.wsRetries = 0;
ws.scheduleReconnect();
check('reconnect stops once logged out', state.wsRetries === 0, state.wsRetries);

state.isLoggedIn = true;
ws.connect();
check('connect keeps a socket on the state', state.socket !== null, 'no socket');
ws.send({ type: 'typing', receiver_id: 2, typing: true });
check('typing events go over the socket', WebSocket.last.sent.length === 1, WebSocket.last.sent);
ws.closeSocket();
check('closeSocket drops the socket without reconnecting', state.socket === null, 'socket kept');

console.log(failures === 0 ? '\nALL FRONTEND TESTS PASSED' : `\n${failures} FRONTEND TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
