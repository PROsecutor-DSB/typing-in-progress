// Small helpers shared by the views.

export function escapeHTML(str) {
    if (typeof str !== 'string') return str;
    return str.replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// throttle keeps a handler from firing on every single scroll event.
export function throttle(func, limit) {
    let inThrottle = false;
    return function (...args) {
        if (inThrottle) return;
        func.apply(this, args);
        inThrottle = true;
        setTimeout(() => { inThrottle = false; }, limit);
    };
}

// Messages must show the date they were sent, not just the time.
export function formatDateTime(value) {
    const date = new Date(value);
    if (isNaN(date)) return '';
    return date.toLocaleString([], {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
    });
}

export function formatDate(value) {
    const date = new Date(value);
    return isNaN(date) ? '' : date.toLocaleString();
}

export function el(id) {
    return document.getElementById(id);
}

export function showError(element, message) {
    if (!element) return;
    element.textContent = message;
    element.classList.add('visible');
}

export function clearError(element) {
    if (!element) return;
    element.textContent = '';
    element.classList.remove('visible');
}
