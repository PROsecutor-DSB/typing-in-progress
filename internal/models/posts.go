package models

import (
	"database/sql"
	"time"
)

type Post struct {
	ID        int       `json:"id"`
	UserID    int       `json:"user_id"`
	Nickname  string    `json:"nickname"` // Author's nickname
	Title     string    `json:"title"`
	Content   string    `json:"content"`
	Category  string    `json:"category"` // Category name
	CreatedAt time.Time `json:"created_at"`
	Likes     int       `json:"likes"`
	Dislikes  int       `json:"dislikes"`
}

type PostModel struct {
	DB *sql.DB
}

func (m *PostModel) Create(p *Post) error {
	tx, err := m.DB.Begin()
	if err != nil {
		return err
	}

	// 1. Insert Post
	res, err := tx.Exec(`INSERT INTO posts (user_id, title, content, created_at) VALUES (?, ?, ?, ?)`, p.UserID, p.Title, p.Content, time.Now())
	if err != nil {
		tx.Rollback()
		return err
	}
	postID, err := res.LastInsertId()
	if err != nil {
		tx.Rollback()
		return err
	}

	// 2. Get or Create Category
	// For simplicity with "Fixed list", we'll just ensure it exists or get the ID.
	// Since the requirement says "Fixed list" in frontend, we assume valid input or we insert it.
	// Let's Insert IGNORE or just Select.
	var categoryID int
	err = tx.QueryRow(`SELECT id FROM categories WHERE name = ?`, p.Category).Scan(&categoryID)
	if err == sql.ErrNoRows {
		// Create if doesn't exist (flexible)
		resCat, err := tx.Exec(`INSERT INTO categories (name) VALUES (?)`, p.Category)
		if err != nil {
			tx.Rollback()
			return err
		}
		catID, _ := resCat.LastInsertId()
		categoryID = int(catID)
	} else if err != nil {
		tx.Rollback()
		return err
	}

	// 3. Link Post and Category
	_, err = tx.Exec(`INSERT INTO post_categories (post_id, category_id) VALUES (?, ?)`, postID, categoryID)
	if err != nil {
		tx.Rollback()
		return err
	}

	return tx.Commit()
}

func (m *PostModel) GetAll() ([]*Post, error) {
	stmt := `
	SELECT 
		p.id, 
		p.user_id, 
		u.nickname,
		p.title, 
		p.content, 
		c.name as category,
		p.created_at,
		(SELECT COUNT(*) FROM post_reactions WHERE post_id = p.id AND type = 'like') as likes,
		(SELECT COUNT(*) FROM post_reactions WHERE post_id = p.id AND type = 'dislike') as dislikes
	FROM posts p
	JOIN users u ON p.user_id = u.id
	JOIN post_categories pc ON p.id = pc.post_id
	JOIN categories c ON pc.category_id = c.id
	ORDER BY p.created_at DESC`

	rows, err := m.DB.Query(stmt)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var posts []*Post
	for rows.Next() {
		p := &Post{}
		err := rows.Scan(&p.ID, &p.UserID, &p.Nickname, &p.Title, &p.Content, &p.Category, &p.CreatedAt, &p.Likes, &p.Dislikes)
		if err != nil {
			return nil, err
		}
		posts = append(posts, p)
	}
	if err = rows.Err(); err != nil {
		return nil, err
	}
	return posts, nil
}
