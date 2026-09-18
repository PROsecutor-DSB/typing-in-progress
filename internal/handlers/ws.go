package handlers

import (
	"encoding/json"
	"log"
	"net/http"
	"real-time-forum/internal/chat"
	"strconv"
)

// messagePageSize is the number of messages returned per chat history request.
const messagePageSize = 10

func (h *Handler) ServeWs(hub *chat.Hub, w http.ResponseWriter, r *http.Request) {
	session := sessionFrom(r)

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
		MsgModel: h.Messages,
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

	otherUserID, err := strconv.Atoi(r.URL.Query().Get("user_id"))
	if err != nil || otherUserID <= 0 {
		http.Error(w, "Invalid user ID", http.StatusBadRequest)
		return
	}

	offset, err := strconv.Atoi(r.URL.Query().Get("offset"))
	if err != nil || offset < 0 {
		offset = 0
	}

	msgs, err := h.Messages.GetHistory(sessionFrom(r).UserID, otherUserID, messagePageSize, offset)
	if err != nil {
		http.Error(w, "Failed to fetch history", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(msgs)
}

// GetUsersHandler returns the chat contacts of the current user, ordered by the
// most recent conversation.
func (h *Handler) GetUsersHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	contacts, err := h.Users.ListChatContacts(sessionFrom(r).UserID)
	if err != nil {
		http.Error(w, "Failed to fetch users", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(contacts)
}
