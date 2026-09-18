// Minimal History API router: no hash URLs, no page reloads, and a deep link
// such as /posts/12 survives a refresh because the server falls back to
// index.html for unknown paths.

let routes = [];
let fallback = () => {};

export function currentPath() {
    return window.location.pathname + window.location.search;
}

export function navigate(path, { replace = false } = {}) {
    if (path === currentPath()) {
        return resolve(path);
    }
    if (replace) {
        window.history.replaceState({}, '', path);
    } else {
        window.history.pushState({}, '', path);
    }
    return resolve(path);
}

export function initRouter(table, notFound) {
    routes = table;
    fallback = notFound;

    window.addEventListener('popstate', () => resolve(currentPath()));

    // Internal links navigate without reloading the page
    document.addEventListener('click', event => {
        const link = event.target.closest('a[data-link]');
        if (!link) return;
        event.preventDefault();
        navigate(link.getAttribute('href'));
    });

    return resolve(currentPath());
}

// The path selects the view, the query string carries view state such as the
// conversation that is open (?chat=3).
async function resolve(url) {
    const parsed = new URL(url, window.location.origin);

    for (const route of routes) {
        const match = route.pattern.exec(parsed.pathname);
        if (match) {
            return route.handler(match.slice(1), parsed.searchParams);
        }
    }
    return fallback(parsed.pathname);
}
