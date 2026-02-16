package handlers

import (
	"encoding/json"
	"net/http"
)

func (h *Handler) ToggleReactionHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Auth Guard
	c, err := r.Cookie("session_token")
	if err != nil {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	session, err := h.Sessions.GetByToken(c.Value)
	if err != nil {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	var req struct {
		CommentID int    `json:"comment_id,omitempty"`
		PostID    int    `json:"post_id,omitempty"`
		Type      string `json:"type"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if req.Type != "like" && req.Type != "dislike" {
		http.Error(w, "Invalid reaction type", http.StatusBadRequest)
		return
	}

	var likes, dislikes int
	var actionResult string // "like", "dislike", or "" (removed)
	var broadcastType string
	var contentID int

	if req.CommentID > 0 {
		// Comment Reaction
		contentID = req.CommentID
		broadcastType = "comment_reaction"
		actionResult, err = h.Reactions.ToggleReaction(session.UserID, req.CommentID, req.Type)
		if err != nil {
			http.Error(w, "Failed to toggle reaction", http.StatusInternalServerError)
			return
		}
		likes, dislikes, err = h.Reactions.GetReactionsCount(req.CommentID)
	} else if req.PostID > 0 {
		// Post Reaction
		contentID = req.PostID
		broadcastType = "post_reaction"
		actionResult, err = h.Reactions.TogglePostReaction(session.UserID, req.PostID, req.Type)
		if err != nil {
			http.Error(w, "Failed to toggle reaction", http.StatusInternalServerError)
			return
		}
		likes, dislikes, err = h.Reactions.GetPostReactionCounts(req.PostID)
	} else {
		http.Error(w, "Missing post_id or comment_id", http.StatusBadRequest)
		return
	}

	if err != nil {
		http.Error(w, "Failed to fetch counts", http.StatusInternalServerError)
		return
	}

	// Create and Broadcast Message via WebSocket
	broadcastMsg := struct {
		Type         string `json:"type"`
		ContentID    int    `json:"content_id"`
		LikeCount    int    `json:"like_count"`
		DislikeCount int    `json:"dislike_count"`
		UserReaction string `json:"user_reaction,omitempty"` // Optional: sender reaction
		SenderID     int    `json:"sender_id"`               // To exclude sender from UI update if needed, or identify them
	}{
		Type:         broadcastType,
		ContentID:    contentID,
		LikeCount:    likes,
		DislikeCount: dislikes,
		UserReaction: actionResult,
		SenderID:     session.UserID,
	}

	msgBytes, _ := json.Marshal(broadcastMsg)
	// Sending to Broadcast channel (Hub handles distribution)
	h.Hub.Broadcast <- msgBytes

	// Return response to caller
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":  true,
		"reaction": actionResult,
		"likes":    likes,
		"dislikes": dislikes,
	})
}
