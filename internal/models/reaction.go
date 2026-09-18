package models

import (
	"database/sql"
	"time"
)

type Reaction struct {
	ID        int       `json:"id"`
	UserID    int       `json:"user_id"`
	CommentID int       `json:"comment_id,omitempty"`
	PostID    int       `json:"post_id,omitempty"`
	Type      string    `json:"type"` // like, dislike
	CreatedAt time.Time `json:"created_at"`
}

type ReactionModel struct {
	DB *sql.DB
}

// --- Comment Reactions ---

func (m *ReactionModel) ToggleReaction(userID, commentID int, reactionType string) (string, error) {
	// Check if exists
	var currentType string
	err := m.DB.QueryRow("SELECT type FROM comment_reactions WHERE user_id = ? AND comment_id = ?", userID, commentID).Scan(&currentType)

	if err == sql.ErrNoRows {
		// Insert
		_, err = m.DB.Exec("INSERT INTO comment_reactions (user_id, comment_id, type) VALUES (?, ?, ?)", userID, commentID, reactionType)
		return reactionType, classifyConstraintError(err)
	} else if err != nil {
		return "", err
	}

	// Exists
	if currentType == reactionType {
		// Delete (untoggle) -> Return empty string to signify "removed"
		_, err = m.DB.Exec("DELETE FROM comment_reactions WHERE user_id = ? AND comment_id = ?", userID, commentID)
		return "", err
	} else {
		// Update (switch) -> Return new type
		_, err = m.DB.Exec("UPDATE comment_reactions SET type = ? WHERE user_id = ? AND comment_id = ?", reactionType, userID, commentID)
		return reactionType, err
	}
}

func (m *ReactionModel) GetReactionsCount(commentID int) (int, int, error) {
	rows, err := m.DB.Query("SELECT type, COUNT(*) FROM comment_reactions WHERE comment_id = ? GROUP BY type", commentID)
	if err != nil {
		return 0, 0, err
	}
	defer rows.Close()

	likes := 0
	dislikes := 0

	for rows.Next() {
		var rType string
		var count int
		if err := rows.Scan(&rType, &count); err != nil {
			return 0, 0, err
		}
		if rType == "like" {
			likes = count
		} else if rType == "dislike" {
			dislikes = count
		}
	}
	return likes, dislikes, nil
}

// --- Post Reactions ---

func (m *ReactionModel) TogglePostReaction(userID, postID int, reactionType string) (string, error) {
	var currentType string
	err := m.DB.QueryRow("SELECT type FROM post_reactions WHERE user_id = ? AND post_id = ?", userID, postID).Scan(&currentType)

	if err == sql.ErrNoRows {
		_, err = m.DB.Exec("INSERT INTO post_reactions (user_id, post_id, type) VALUES (?, ?, ?)", userID, postID, reactionType)
		return reactionType, classifyConstraintError(err)
	} else if err != nil {
		return "", err
	}

	if currentType == reactionType {
		_, err = m.DB.Exec("DELETE FROM post_reactions WHERE user_id = ? AND post_id = ?", userID, postID)
		return "", err
	} else {
		_, err = m.DB.Exec("UPDATE post_reactions SET type = ? WHERE user_id = ? AND post_id = ?", reactionType, userID, postID)
		return reactionType, err
	}
}

func (m *ReactionModel) GetPostReactionCounts(postID int) (int, int, error) {
	rows, err := m.DB.Query("SELECT type, COUNT(*) FROM post_reactions WHERE post_id = ? GROUP BY type", postID)
	if err != nil {
		return 0, 0, err
	}
	defer rows.Close()

	likes := 0
	dislikes := 0

	for rows.Next() {
		var rType string
		var count int
		if err := rows.Scan(&rType, &count); err != nil {
			return 0, 0, err
		}
		if rType == "like" {
			likes = count
		} else if rType == "dislike" {
			dislikes = count
		}
	}
	return likes, dislikes, nil
}
