package handlers

import (
	"encoding/json"

	"net/http"
	"real-time-forum/internal/models"
)

func (h *Handler) CreatePostHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		Title    string `json:"title"`
		Content  string `json:"content"`
		Category string `json:"category"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if req.Title == "" || req.Content == "" || req.Category == "" {
		http.Error(w, "Missing required fields", http.StatusBadRequest)
		return
	}

	if !isValidCategory(req.Category) {
		http.Error(w, "Invalid category", http.StatusBadRequest)
		return
	}

	post := &models.Post{
		UserID:   sessionFrom(r).UserID,
		Title:    req.Title,
		Content:  req.Content,
		Category: req.Category,
	}

	if err := h.Posts.Create(post); err != nil {

		http.Error(w, "Failed to create post", http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusCreated)
	w.Write([]byte("Post created successfully"))
}

func (h *Handler) GetPostsHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	posts, err := h.Posts.GetAll()
	if err != nil {

		http.Error(w, "Failed to fetch posts", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(posts)
}

func isValidCategory(category string) bool {
	valid := map[string]bool{
		"General":    true,
		"Tech":       true,
		"Random":     true,
		"Blockchain": true,
		"Startups":   true,
		"Economics":  true,
		"Science":    true,
		"Music":      true,
		"Movies":     true,
	}
	return valid[category]
}
