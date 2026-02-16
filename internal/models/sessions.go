package models

import (
	"database/sql"
	"time"
)

type Session struct {
	ID           int
	UserID       int
	SessionToken string
	CreatedAt    time.Time
	ExpiresAt    time.Time
}

type SessionModel struct {
	DB *sql.DB
}

func (m *SessionModel) Create(userID int, token string, expiresAt time.Time) error {
	stmt := `INSERT INTO sessions (user_id, session_token, expires_at) VALUES (?, ?, ?)`
	_, err := m.DB.Exec(stmt, userID, token, expiresAt)
	return err
}

func (m *SessionModel) GetByToken(token string) (*Session, error) {
	stmt := `SELECT id, user_id, session_token, created_at, expires_at FROM sessions WHERE session_token = ?`
	row := m.DB.QueryRow(stmt, token)

	s := &Session{}
	err := row.Scan(&s.ID, &s.UserID, &s.SessionToken, &s.CreatedAt, &s.ExpiresAt)
	if err != nil {
		return nil, err
	}
	return s, nil
}

func (m *SessionModel) Delete(token string) error {
	stmt := `DELETE FROM sessions WHERE session_token = ?`
	_, err := m.DB.Exec(stmt, token)
	return err
}
