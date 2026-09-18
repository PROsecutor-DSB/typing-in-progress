package models

import (
	"database/sql"
	"time"
)

type Comment struct {
	ID        int       `json:"id"`
	PostID    int       `json:"post_id"`
	UserID    int       `json:"user_id"`
	Nickname  string    `json:"nickname"` // Author's nickname
	Content   string    `json:"content"`
	CreatedAt time.Time `json:"created_at"`
	Likes     int       `json:"likes"`
	Dislikes  int       `json:"dislikes"`
}

type CommentModel struct {
	DB *sql.DB
}

func (m *CommentModel) Create(c *Comment) error {
	stmt := `INSERT INTO comments (post_id, user_id, content, created_at) VALUES (?, ?, ?, ?)`
	_, err := m.DB.Exec(stmt, c.PostID, c.UserID, c.Content, time.Now())
	return classifyConstraintError(err)
}

func (m *CommentModel) GetByPostID(postID int) ([]*Comment, error) {
	stmt := `
	SELECT 
		c.id, 
		c.post_id, 
		c.user_id, 
		u.nickname,
		c.content, 
		c.created_at,
		(SELECT COUNT(*) FROM comment_reactions WHERE comment_id = c.id AND type = 'like') as likes,
		(SELECT COUNT(*) FROM comment_reactions WHERE comment_id = c.id AND type = 'dislike') as dislikes
	FROM comments c
	JOIN users u ON c.user_id = u.id
	WHERE c.post_id = ?
	ORDER BY c.created_at ASC`

	rows, err := m.DB.Query(stmt, postID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var comments []*Comment
	for rows.Next() {
		c := &Comment{}
		err := rows.Scan(&c.ID, &c.PostID, &c.UserID, &c.Nickname, &c.Content, &c.CreatedAt, &c.Likes, &c.Dislikes)
		if err != nil {
			return nil, err
		}
		comments = append(comments, c)
	}
	if err = rows.Err(); err != nil {
		return nil, err
	}
	return comments, nil
}
