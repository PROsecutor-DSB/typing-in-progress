package handlers

import (
	"encoding/json"
	"log"
	"net/http"
	"real-time-forum/internal/chat"
	"real-time-forum/internal/models"
	"strconv"
	"time"
)

func (h *Handler) ServeWs(hub *chat.Hub, w http.ResponseWriter, r *http.Request) {
	// Auth Guard
	c, err := r.Cookie("session_token")
	if err != nil {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	session, err := h.Sessions.GetByToken(c.Value)
	if err != nil || session.ExpiresAt.Before(time.Now()) {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	conn, err := chat.Upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Println(err)
		return
	}

	// Look up nickname for the connected user
	nickname := ""
	user, err := h.Users.GetByID(session.UserID)
	if err == nil {
		nickname = user.Nickname
	}

	client := &chat.Client{
		Hub:      hub,
		Conn:     conn,
		Send:     make(chan []byte, 256),
		UserID:   session.UserID,
		Nickname: nickname,
		MsgModel: &models.MessageModel{DB: h.Users.DB}, // Reuse DB connection
	}

	client.Hub.Register <- client

	// Allow collection of memory referenced by the caller by doing all work in
	// new goroutines.
	go client.WritePump()
	go client.ReadPump()
}

func (h *Handler) GetChatHistoryHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	c, err := r.Cookie("session_token")
	if err != nil {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	session, err := h.Sessions.GetByToken(c.Value)
	if err != nil || session.ExpiresAt.Before(time.Now()) {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	otherUserIDStr := r.URL.Query().Get("user_id")
	otherUserID, err := strconv.Atoi(otherUserIDStr)
	if err != nil {
		http.Error(w, "Invalid user ID", http.StatusBadRequest)
		return
	}

	offsetStr := r.URL.Query().Get("offset")
	offset, _ := strconv.Atoi(offsetStr) // Default 0

	limit := 20

	msgs, err := (&models.MessageModel{DB: h.Posts.DB}).GetHistory(session.UserID, otherUserID, limit, offset)
	if err != nil {
		http.Error(w, "Failed to fetch history", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(msgs)
}

func (h *Handler) GetUsersHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	c, err := r.Cookie("session_token")
	if err != nil {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	session, err := h.Sessions.GetByToken(c.Value)
	if err != nil || session.ExpiresAt.Before(time.Now()) {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	rows, err := h.Users.DB.Query("SELECT id, nickname, email FROM users ORDER BY nickname ASC")
	if err != nil {
		http.Error(w, "Failed to fetch users", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var users []struct {
		ID       int    `json:"id"`
		Nickname string `json:"nickname"`
	}
	for rows.Next() {
		var u struct {
			ID       int    `json:"id"`
			Nickname string `json:"nickname"`
			Email    string
		}
		rows.Scan(&u.ID, &u.Nickname, &u.Email)
		users = append(users, struct {
			ID       int    `json:"id"`
			Nickname string `json:"nickname"`
		}{u.ID, u.Nickname})
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(users)
}
