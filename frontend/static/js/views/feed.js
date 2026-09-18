// Dashboard scaffold, category menu and the post feed.

import { state, CATEGORIES } from '../state.js';
import { api } from '../api.js';
import { escapeHTML, formatDate, el, showError, clearError } from '../utils.js';
import { loadUsers, renderChatPlaceholder } from './chat.js';
import { navigate } from '../router.js';
import { reactionButtons } from './reactions.js';

// ensureDashboard builds the three column layout once. Every route renders
// into it, which is how the chat sidebar stays visible at all times.
export async function ensureDashboard() {
    if (document.querySelector('.dashboard-grid')) return;

    el('app').innerHTML = `
        <div class="dashboard-grid">
            <aside class="col-users card">
                <section class="sidebar-section sidebar-section--categories">
                    <h3 class="sidebar-title">Categories</h3>
                    <div id="category-list"></div>
                </section>
                <section class="sidebar-section sidebar-section--users">
                    <h3 class="sidebar-title">Users</h3>
                    <div id="user-list">Loading users...</div>
                </section>
            </aside>

            <main class="col-feed">
                <div id="chat-view" class="card chat-view"></div>
                <div id="posts-container" class="post-list"><p>Loading posts...</p></div>
            </main>

            <section class="col-create card">
                <h2>Create Post</h2>
                <div id="home-error" class="error-msg"></div>
                <form id="create-post-form">
                    <div class="input-group">
                        <label for="post-title">Title</label>
                        <input type="text" id="post-title" name="title" required>
                    </div>
                    <div class="input-group">
                        <label for="post-category">Category</label>
                        <select id="post-category" name="category">
                            ${CATEGORIES.map(c => `<option value="${c}">${c}</option>`).join('')}
                        </select>
                    </div>
                    <div class="input-group">
                        <label for="post-content">Content</label>
                        <textarea id="post-content" name="content" rows="4" required></textarea>
                    </div>
                    <button type="submit" class="btn">Post</button>
                </form>
            </section>
        </div>
    `;

    renderChatPlaceholder();
    renderCategoryMenu();
    el('create-post-form').addEventListener('submit', handleCreatePost);
    el('category-list').addEventListener('click', event => {
        const button = event.target.closest('.category-btn');
        if (button) setCategory(button.dataset.category);
    });

    await Promise.all([loadPosts(), loadUsers()]);
}

export function renderCategoryMenu() {
    const list = el('category-list');
    if (!list) return;

    list.innerHTML = ['All', ...CATEGORIES].map(category => `
        <div class="category-btn${state.activeCategory === category ? ' active' : ''}" data-category="${category}">
            ${category}
        </div>
    `).join('');
}

export function setCategory(category) {
    state.activeCategory = category;
    renderCategoryMenu();
    if (state.route.name === 'feed') {
        renderFeed();
    } else {
        navigate('/'); // picking a category from a post page returns to the list
    }
}

export async function loadPosts() {
    try {
        const response = await api.posts();
        if (!response.ok) throw new Error('Failed to load posts');
        state.allPosts = await response.json() || [];
        renderFeed();
    } catch (e) {
        const container = el('posts-container');
        if (container && state.route.name === 'feed') {
            container.innerHTML = `<p class="error-msg visible">Error loading posts: ${escapeHTML(e.message)}</p>`;
        }
    }
}

export function renderFeed() {
    if (state.route.name !== 'feed') return; // another view owns this column
    const container = el('posts-container');
    if (!container) return;

    const posts = state.activeCategory === 'All'
        ? state.allPosts
        : state.allPosts.filter(post => post.category === state.activeCategory);

    if (posts.length === 0) {
        container.innerHTML = `<p class="empty-state">No posts found for ${escapeHTML(state.activeCategory)}.</p>`;
        return;
    }

    container.innerHTML = posts.map(post => `
        <article class="post">
            <div class="post-header">
                <span>${escapeHTML(post.nickname)}</span>
                <span>${formatDate(post.created_at)}</span>
            </div>
            <h3 class="post-title">
                ${escapeHTML(post.title)}
                <span class="post-category">${escapeHTML(post.category)}</span>
            </h3>
            <p class="post-body">${escapeHTML(post.content)}</p>
            <div class="post-actions">
                ${reactionButtons('post', post.id, post.likes, post.dislikes)}
                <a class="btn-link post-comments-link" href="/posts/${post.id}" data-link>View Comments</a>
            </div>
        </article>
    `).join('');
}

export function renderNotFound(path) {
    const container = el('posts-container');
    if (!container) return;
    container.innerHTML = `
        <div class="empty-state">
            <p>Nothing lives at ${escapeHTML(path)}.</p>
            <a class="btn-link" href="/" data-link>Back to the feed</a>
        </div>
    `;
}

async function handleCreatePost(event) {
    event.preventDefault();
    const errorBox = el('home-error');
    clearError(errorBox);

    const data = Object.fromEntries(new FormData(event.target).entries());

    try {
        const response = await api.createPost(data);
        if (response.ok) {
            event.target.reset();
            await loadPosts();
        } else {
            showError(errorBox, await response.text());
        }
    } catch (_) {
        showError(errorBox, 'Network error');
    }
}
