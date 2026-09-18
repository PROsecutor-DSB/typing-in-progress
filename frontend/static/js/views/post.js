// A single post with its comments, rendered inside the feed column.

import { state } from '../state.js';
import { api } from '../api.js';
import { escapeHTML, formatDate, el, showError, clearError } from '../utils.js';
import { loadPosts, renderNotFound } from './feed.js';
import { reactionButtons } from './reactions.js';

export async function renderPost(postId) {
    const container = el('posts-container');
    if (!container) return;

    // A deep link such as /posts/12 can arrive before the feed was loaded
    if (state.allPosts.length === 0) await loadPosts();

    const post = state.allPosts.find(item => item.id === postId);
    if (!post) {
        renderNotFound(`/posts/${postId}`);
        return;
    }

    container.innerHTML = `
        <a class="btn-link btn-back" href="/" data-link>← Back to Feed</a>

        <article class="card post-detail">
            <div class="post-header">
                <span>${escapeHTML(post.nickname)}</span>
                <span>${formatDate(post.created_at)}</span>
            </div>
            <h2 class="post-detail-title">
                ${escapeHTML(post.title)}
                <span class="post-category">${escapeHTML(post.category)}</span>
            </h2>
            <p class="post-detail-body">${escapeHTML(post.content)}</p>
            ${reactionButtons('post', post.id, post.likes, post.dislikes)}
        </article>

        <section class="card">
            <h3>Comments</h3>
            <div id="comments-list" class="comments-list"><p>Loading comments...</p></div>
            <div id="comment-error" class="error-msg"></div>
            <form id="comment-form">
                <div class="input-group">
                    <label class="sr-only" for="comment-content">Comment</label>
                    <textarea id="comment-content" name="content" rows="2" placeholder="Write a comment..." required></textarea>
                </div>
                <button type="submit" class="btn btn--compact">Add Comment</button>
            </form>
        </section>
    `;

    el('comment-form').addEventListener('submit', event => handleCreateComment(event, post.id));
    await loadComments(post.id);
}

async function loadComments(postId) {
    const list = el('comments-list');
    if (!list) return;

    try {
        const response = await api.comments(postId);
        if (!response.ok) return;

        const comments = await response.json();
        if (!comments || comments.length === 0) {
            list.innerHTML = '<p class="empty-state empty-state--muted">No comments yet.</p>';
            return;
        }

        list.innerHTML = comments.map(comment => `
            <div class="comment">
                <div class="comment-meta">
                    <span class="comment-author">${escapeHTML(comment.nickname)}</span> • ${formatDate(comment.created_at)}
                </div>
                <p>${escapeHTML(comment.content)}</p>
                ${reactionButtons('comment', comment.id, comment.likes, comment.dislikes, true)}
            </div>
        `).join('');
    } catch (_) {
        list.innerHTML = '<p class="error-msg visible">Error loading comments</p>';
    }
}

async function handleCreateComment(event, postId) {
    event.preventDefault();
    const errorBox = el('comment-error');
    clearError(errorBox);

    const data = Object.fromEntries(new FormData(event.target).entries());
    data.post_id = postId;

    try {
        const response = await api.createComment(data);
        if (response.ok) {
            event.target.reset();
            await loadComments(postId);
        } else {
            showError(errorBox, await response.text());
        }
    } catch (_) {
        showError(errorBox, 'Network error');
    }
}
