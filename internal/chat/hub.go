package chat

import (
	"encoding/json"
	"log"
	"sync"
)

type Hub struct {
	// Every connection is tracked separately, not keyed by user id, so one
	// user can be connected from several devices at the same time.
	Clients map[*Client]bool

	Broadcast  chan []byte
	Register   chan *Client
	Unregister chan *Client
	Mu         sync.Mutex
}

func NewHub() *Hub {
	return &Hub{
		Broadcast:  make(chan []byte),
		Register:   make(chan *Client),
		Unregister: make(chan *Client),
		Clients:    make(map[*Client]bool),
	}
}

func (h *Hub) Run() {
	for {
		select {
		case client := <-h.Register:
			h.Mu.Lock()
			h.Clients[client] = true

			// Collect who is already here, one entry per user even when that
			// user has several connections open.
			alreadyOnline := make(map[int]bool)
			for existing := range h.Clients {
				if existing.UserID != client.UserID {
					alreadyOnline[existing.UserID] = true
				}
			}
			h.Mu.Unlock()

			log.Printf("Client connected. UserID: %d", client.UserID)

			// 1. Tell the newcomer who is already online
			for userID := range alreadyOnline {
				if !h.send(client, statusMessage(userID, true)) {
					break // the newcomer is already gone
				}
			}

			// 2. Tell everybody else that this user came online
			h.broadcastUserStatus(client.UserID, true)

		case client := <-h.Unregister:
			h.Mu.Lock()
			removed := h.removeLocked(client)

			// Check if this was their last connection
			stillActive := false
			for c := range h.Clients {
				if c.UserID == client.UserID {
					stillActive = true
					break
				}
			}
			h.Mu.Unlock()

			if !removed {
				continue // already dropped, nothing to announce
			}

			log.Printf("Client disconnected. UserID: %d", client.UserID)

			if !stillActive {
				h.broadcastUserStatus(client.UserID, false)
			}

		case message := <-h.Broadcast:
			var payload struct {
				Type       string `json:"type"`
				SenderID   int    `json:"sender_id"`
				ReceiverID int    `json:"receiver_id"`
			}

			// Skip malformed messages
			if err := json.Unmarshal(message, &payload); err != nil {
				log.Printf("Hub JSON Error: %v", err)
				continue
			}

			h.deliver(message, func(c *Client) bool {
				switch payload.Type {
				case "message":
					// Private chat: only the two participants
					return c.UserID == payload.ReceiverID || c.UserID == payload.SenderID
				case "typing":
					// Typing indicator: only the receiver, never back to the sender
					return c.UserID == payload.ReceiverID
				default:
					// Everything else (reactions) is public
					return true
				}
			})
		}
	}
}

// deliver sends a message to every connected client matching the predicate.
func (h *Hub) deliver(message []byte, matches func(*Client) bool) {
	h.Mu.Lock()
	defer h.Mu.Unlock()

	// Deleting from a map while ranging over it is safe in Go, and sendLocked
	// is the only place that removes a client, so Send is never closed twice.
	for client := range h.Clients {
		if matches(client) {
			h.sendLocked(client, message)
		}
	}
}

// send delivers one message to one client. It reports whether the client is
// still connected afterwards.
func (h *Hub) send(client *Client, message []byte) bool {
	h.Mu.Lock()
	defer h.Mu.Unlock()
	return h.sendLocked(client, message)
}

// sendLocked must be called with h.Mu held. A client whose buffer is full is
// considered dead and is dropped.
func (h *Hub) sendLocked(client *Client, message []byte) bool {
	if !h.Clients[client] {
		return false
	}

	select {
	case client.Send <- message:
		return true
	default:
		h.removeLocked(client)
		return false
	}
}

// removeLocked must be called with h.Mu held. It closes Send exactly once,
// which is what keeps a slow client from panicking the whole hub.
func (h *Hub) removeLocked(client *Client) bool {
	if !h.Clients[client] {
		return false
	}
	delete(h.Clients, client)
	close(client.Send)
	return true
}

func statusMessage(userID int, online bool) []byte {
	data, _ := json.Marshal(struct {
		Type   string `json:"type"`
		UserID int    `json:"user_id"`
		Online bool   `json:"online"`
	}{
		Type:   "status",
		UserID: userID,
		Online: online,
	})
	return data
}

func (h *Hub) broadcastUserStatus(userID int, online bool) {
	h.deliver(statusMessage(userID, online), func(*Client) bool { return true })
}

// CloseAll disconnects every client. Websocket connections are hijacked, so
// http.Server.Shutdown cannot close them on its own.
func (h *Hub) CloseAll() {
	h.Mu.Lock()
	defer h.Mu.Unlock()

	for client := range h.Clients {
		h.removeLocked(client)
	}
}
