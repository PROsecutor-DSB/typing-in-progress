package models

import (
	"database/sql"
	"time"
)

type Message struct {
	ID         int       `json:"id"`
	SenderID   int       `json:"sender_id"`
	ReceiverID int       `json:"receiver_id"`
	Content    string    `json:"content"`
	CreatedAt  time.Time `json:"created_at"`
}

type MessageModel struct {
	DB *sql.DB
}

func (m *MessageModel) Save(msg *Message) error {
	stmt := `INSERT INTO messages (sender_id, receiver_id, content, created_at) VALUES (?, ?, ?, ?)`
	res, err := m.DB.Exec(stmt, msg.SenderID, msg.ReceiverID, msg.Content, time.Now())
	if err != nil {
		return err
	}
	id, err := res.LastInsertId()
	if err != nil {
		return err
	}
	msg.ID = int(id)
	return nil
}

func (m *MessageModel) GetHistory(user1, user2 int, limit, offset int) ([]*Message, error) {
	// Fetch conversation between two users
	stmt := `
	SELECT id, sender_id, receiver_id, content, created_at 
	FROM messages 
	WHERE (sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?)
	ORDER BY created_at DESC
	LIMIT ? OFFSET ?`

	rows, err := m.DB.Query(stmt, user1, user2, user2, user1, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var messages []*Message
	for rows.Next() {
		msg := &Message{}
		err := rows.Scan(&msg.ID, &msg.SenderID, &msg.ReceiverID, &msg.Content, &msg.CreatedAt)
		if err != nil {
			return nil, err
		}
		messages = append(messages, msg)
	}

	// Reverse order to show oldest first (optional, but UI might expect chronological)
	// But optimizing for "Load older" means we get latest first.
	// The frontend can reverse if needed. Let's keep DESC (latest first) as per typical API.
	return messages, nil
}
