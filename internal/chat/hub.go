package chat

import (
	"encoding/json"
	"log"
	"sync"
)

type Hub struct {
	// ВАЖНО: Храним список ВСЕХ соединений, а не мапу по ID.
	// Это позволяет одному юзеру сидеть с телефона и компа одновременно.
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
			h.Mu.Unlock()

			log.Printf("Client connected. UserID: %d", client.UserID)

			// 1. Сообщаем ВСЕМ ОСТАЛЬНЫМ, что этот клиент вошел (Боб пришел!)
			h.broadcastUserStatus(client.UserID, true)

			// 2. (НОВОЕ) Сообщаем ЭТОМУ КЛИЕНТУ про всех, кто УЖЕ здесь (Боб, тут сидит Алиса!)
			h.Mu.Lock()
			for existingClient := range h.Clients {
				// Проверяем всех, кроме себя самого
				if existingClient.UserID != client.UserID {
					msg := struct {
						Type   string `json:"type"`
						UserID int    `json:"user_id"`
						Online bool   `json:"online"`
					}{
						Type:   "status",
						UserID: existingClient.UserID,
						Online: true,
					}
					data, _ := json.Marshal(msg)

					// Отправляем новичку
					select {
					case client.Send <- data:
					default:
						close(client.Send)
						delete(h.Clients, client)
					}
				}
			}
			h.Mu.Unlock()

		case client := <-h.Unregister:
			h.Mu.Lock()
			if _, ok := h.Clients[client]; ok {
				delete(h.Clients, client)
				close(client.Send)
				
				// Check if this was their last connection
				stillActive := false
				for c := range h.Clients {
					if c.UserID == client.UserID {
						stillActive = true
						break
					}
				}
				h.Mu.Unlock()

				log.Printf("Client disconnected. UserID: %d", client.UserID)

				if !stillActive {
					h.broadcastUserStatus(client.UserID, false)
				}
			} else {
				h.Mu.Unlock()
			}

		case message := <-h.Broadcast:
			// 1. Распарсим сообщение, чтобы узнать SenderID и ReceiverID
			var payload struct {
				Type       string `json:"type"`
				SenderID   int    `json:"sender_id"` // <--- ВАЖНО
				ReceiverID int    `json:"receiver_id"`
			}

			// Если JSON битый, пропускаем
			if err := json.Unmarshal(message, &payload); err != nil {
				log.Printf("Hub JSON Error: %v", err)
				continue
			}

			// 2. Route by message type
			if payload.Type == "message" {
				h.Mu.Lock()
				for client := range h.Clients {
					if client.UserID == payload.ReceiverID || client.UserID == payload.SenderID {
						select {
						case client.Send <- message:
						default:
							close(client.Send)
							delete(h.Clients, client)
						}
					}
				}
				h.Mu.Unlock()
			} else if payload.Type == "typing" {
				// Typing indicator — only send to the receiver, not back to sender
				h.Mu.Lock()
				for client := range h.Clients {
					if client.UserID == payload.ReceiverID {
						select {
						case client.Send <- message:
						default:
							close(client.Send)
							delete(h.Clients, client)
						}
					}
				}
				h.Mu.Unlock()
			} else {
				// All other types (e.g. post_reaction) — broadcast to everyone
				h.Mu.Lock()
				for client := range h.Clients {
					select {
					case client.Send <- message:
					default:
						close(client.Send)
						delete(h.Clients, client)
					}
				}
				h.Mu.Unlock()
			}
		}
	}
}

func (h *Hub) broadcastUserStatus(userID int, online bool) {
	msg := struct {
		Type   string `json:"type"`
		UserID int    `json:"user_id"`
		Online bool   `json:"online"`
	}{
		Type:   "status",
		UserID: userID,
		Online: online,
	}

	data, _ := json.Marshal(msg)

	h.Mu.Lock()
	defer h.Mu.Unlock()

	// Статус отправляем вообще всем подключенным
	for client := range h.Clients {
		select {
		case client.Send <- data:
		default:
			close(client.Send)
			delete(h.Clients, client)
		}
	}
}
