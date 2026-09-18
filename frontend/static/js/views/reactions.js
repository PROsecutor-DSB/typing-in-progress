// Likes and dislikes for both posts and comments.

import { api } from '../api.js';
import { el } from '../utils.js';

export function initReactions() {
    document.addEventListener('click', async event => {
        const button = event.target.closest('.like-btn, .dislike-btn');
        if (!button) return;
        event.preventDefault();

        const container = button.closest('.reaction-buttons');
        if (!container) return;

        const payload = { type: button.dataset.action };
        if (container.dataset.postId) payload.post_id = parseInt(container.dataset.postId, 10);
        if (container.dataset.commentId) payload.comment_id = parseInt(container.dataset.commentId, 10);
        if (!payload.post_id && !payload.comment_id) return;

        try {
            const response = await api.react(payload);
            if (!response.ok) return;

            const data = await response.json();
            if (!data.success) return;

            paintCounts(container, data.likes, data.dislikes);
            paintOwnReaction(container, data.reaction);
        } catch (e) {
            console.error(e);
        }
    });
}

// applyReactionUpdate reflects somebody else's reaction, pushed over the socket.
export function applyReactionUpdate(msg) {
    const attribute = msg.type === 'post_reaction' ? 'post-id' : 'comment-id';
    const container = document.querySelector(`.reaction-buttons[data-${attribute}="${msg.content_id}"]`);
    if (container) paintCounts(container, msg.like_count, msg.dislike_count);
}

function paintCounts(container, likes, dislikes) {
    const likeCount = container.querySelector('.like-count');
    const dislikeCount = container.querySelector('.dislike-count');
    if (likeCount) likeCount.textContent = likes || 0;
    if (dislikeCount) dislikeCount.textContent = dislikes || 0;
}

function paintOwnReaction(container, reaction) {
    const like = container.querySelector('.like-btn');
    const dislike = container.querySelector('.dislike-btn');
    like?.classList.toggle('active', reaction === 'like');
    dislike?.classList.toggle('active', reaction === 'dislike');
}

export function reactionButtons(target, id, likes, dislikes, small = false) {
    return `
        <div class="reaction-buttons${small ? ' reaction-buttons--small' : ''}" data-${target}-id="${id}">
            <button type="button" class="like-btn" data-action="like">👍 <span class="like-count">${likes || 0}</span></button>
            <button type="button" class="dislike-btn" data-action="dislike">👎 <span class="dislike-count">${dislikes || 0}</span></button>
        </div>
    `;
}
