package models

import (
	"database/sql"
	"errors"
	"strings"
	"time"
)

// Errors returned by UserModel.Create when the nickname or e-mail is taken.
var (
	ErrDuplicateNickname = errors.New("models: nickname already taken")
	ErrDuplicateEmail    = errors.New("models: email already registered")
)

type User struct {
	ID        int
	Nickname  string
	Age       int
	Gender    string
	FirstName string
	LastName  string
	Email     string
	Password  string
	CreatedAt time.Time
}

// ChatContact is a user shown in the chat sidebar.
type ChatContact struct {
	ID       int    `json:"id"`
	Nickname string `json:"nickname"`
}

type UserModel struct {
	DB *sql.DB
}

func (m *UserModel) Create(u *User) error {
	stmt := `INSERT INTO users (nickname, age, gender, first_name, last_name, email, password, created_at)
	VALUES (?, ?, ?, ?, ?, ?, ?, ?)`

	_, err := m.DB.Exec(stmt, u.Nickname, u.Age, u.Gender, u.FirstName, u.LastName, u.Email, u.Password, time.Now())
	if err != nil {
		switch {
		case strings.Contains(err.Error(), "users.nickname"):
			return ErrDuplicateNickname
		case strings.Contains(err.Error(), "users.email"):
			return ErrDuplicateEmail
		}
	}
	return err
}

func (m *UserModel) GetByEmail(email string) (*User, error) {
	stmt := `SELECT id, nickname, age, gender, first_name, last_name, email, password, created_at FROM users WHERE email = ? COLLATE NOCASE`
	row := m.DB.QueryRow(stmt, email)

	u := &User{}
	err := row.Scan(&u.ID, &u.Nickname, &u.Age, &u.Gender, &u.FirstName, &u.LastName, &u.Email, &u.Password, &u.CreatedAt)
	if err != nil {
		return nil, err
	}
	return u, nil
}

func (m *UserModel) GetByNickname(nickname string) (*User, error) {
	stmt := `SELECT id, nickname, age, gender, first_name, last_name, email, password, created_at FROM users WHERE nickname = ?`
	row := m.DB.QueryRow(stmt, nickname)

	u := &User{}
	err := row.Scan(&u.ID, &u.Nickname, &u.Age, &u.Gender, &u.FirstName, &u.LastName, &u.Email, &u.Password, &u.CreatedAt)
	if err != nil {
		return nil, err
	}
	return u, nil
}

func (m *UserModel) GetByID(id int) (*User, error) {
	stmt := `SELECT id, nickname, age, gender, first_name, last_name, email, password, created_at FROM users WHERE id = ?`
	row := m.DB.QueryRow(stmt, id)

	u := &User{}
	err := row.Scan(&u.ID, &u.Nickname, &u.Age, &u.Gender, &u.FirstName, &u.LastName, &u.Email, &u.Password, &u.CreatedAt)
	if err != nil {
		return nil, err
	}
	return u, nil
}

// ListChatContacts returns every user except the caller, ordered like a chat
// application: conversations with the most recent message first, then users
// without any shared message in alphabetical order.
func (m *UserModel) ListChatContacts(currentUserID int) ([]*ChatContact, error) {
	stmt := `
	SELECT u.id, u.nickname
	FROM users u
	LEFT JOIN messages m
		ON (m.sender_id = u.id AND m.receiver_id = ?)
		OR (m.receiver_id = u.id AND m.sender_id = ?)
	WHERE u.id != ?
	GROUP BY u.id, u.nickname
	ORDER BY MAX(m.created_at) IS NULL, MAX(m.created_at) DESC, u.nickname COLLATE NOCASE ASC`

	rows, err := m.DB.Query(stmt, currentUserID, currentUserID, currentUserID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	contacts := []*ChatContact{}
	for rows.Next() {
		c := &ChatContact{}
		if err := rows.Scan(&c.ID, &c.Nickname); err != nil {
			return nil, err
		}
		contacts = append(contacts, c)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return contacts, nil
}
