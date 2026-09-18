// A DOM small enough to exercise the application's rendering logic in Node,
// without pulling in a browser engine.

function makeClassList() {
    const classes = new Set();
    return {
        add: (...names) => names.forEach(n => classes.add(n)),
        remove: (...names) => names.forEach(n => classes.delete(n)),
        contains: name => classes.has(name),
        toggle: (name, force) => {
            const on = force === undefined ? !classes.has(name) : force;
            if (on) classes.add(name); else classes.delete(name);
            return on;
        },
        list: () => [...classes]
    };
}

function makeElement(id = '', tag = 'div') {
    const node = {
        id,
        tag,
        innerHTML: '',
        textContent: '',
        value: '',
        dataset: {},
        classList: makeClassList(),
        listeners: {},
        elements: {},
        children: [],
        addEventListener(type, handler) {
            (this.listeners[type] = this.listeners[type] || []).push(handler);
        },
        dispatch(type, event = {}) {
            (this.listeners[type] || []).forEach(handler => handler({
                preventDefault() {}, target: this, ...event
            }));
        },
        insertAdjacentHTML(position, html) {
            this.innerHTML = position === 'afterbegin' ? html + this.innerHTML : this.innerHTML + html;
        },
        querySelector() { return makeElement('', 'span'); },
        querySelectorAll() { return []; },
        closest() { return null; },
        reset() {},
        scrollTop: 0,
        scrollHeight: 0,
        clientHeight: 0
    };
    return node;
}

export function installDOM({ routes = {} } = {}) {
    const elements = new Map();
    const documentListeners = {};
    const windowListeners = {};

    const location = {
        protocol: 'http:',
        host: 'localhost:8080',
        origin: 'http://localhost:8080',
        pathname: '/',
        search: ''
    };

    const history = {
        entries: [],
        pushState(_state, _title, url) { this.entries.push(url); apply(url); },
        replaceState(_state, _title, url) { this.entries.push(url); apply(url); }
    };

    function apply(url) {
        const parsed = new URL(url, location.origin);
        location.pathname = parsed.pathname;
        location.search = parsed.search;
    }

    const document = {
        readyState: 'loading', // keeps app.js from auto-starting on import
        getElementById(id) {
            if (!elements.has(id)) elements.set(id, makeElement(id));
            return elements.get(id);
        },
        querySelector(selector) {
            return elements.get(`selector:${selector}`) || null;
        },
        querySelectorAll() { return []; },
        addEventListener(type, handler) {
            (documentListeners[type] = documentListeners[type] || []).push(handler);
        },
        dispatch(type, event) {
            (documentListeners[type] || []).forEach(handler => handler(event));
        }
    };

    const window = {
        location,
        history,
        addEventListener(type, handler) {
            (windowListeners[type] = windowListeners[type] || []).push(handler);
        },
        dispatch(type, event) {
            (windowListeners[type] || []).forEach(handler => handler(event));
        }
    };

    globalThis.document = document;
    globalThis.window = window;
    globalThis.WebSocket = function WebSocketStub() {
        this.readyState = 1;
        this.sent = [];
        this.send = payload => this.sent.push(payload);
        this.close = () => { this.closed = true; };
        WebSocketStub.last = this;
    };
    globalThis.WebSocket.OPEN = 1;

    const calls = [];
    globalThis.fetch = async (url, options) => {
        calls.push({ url, options });
        const route = routes[url] || routes[String(url).split('?')[0]];
        if (!route) return response(404, '');
        return typeof route === 'function' ? route(url, options) : route;
    };

    return {
        document, window, location, history, elements, calls,
        setSelector(selector, element) { elements.set(`selector:${selector}`, element); },
        makeElement
    };
}

export function response(status, body) {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => body,
        text: async () => (typeof body === 'string' ? body : JSON.stringify(body))
    };
}
