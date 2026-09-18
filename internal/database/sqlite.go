package database

import (
	"database/sql"
	"fmt"
	"time"

	_ "github.com/mattn/go-sqlite3"
)

// InitDatabase creates and initializes the SQLite database with schema
func InitDatabase() (*sql.DB, error) {
	const dbPath = "database.db"

	// Connection settings belong in the DSN: a PRAGMA executed through database/sql
	// would only apply to the single pooled connection that happened to run it,
	// which silently disables foreign keys on every other connection.
	dsn := fmt.Sprintf("file:%s?_foreign_keys=on&_journal_mode=WAL&_busy_timeout=5000", dbPath)

	database, err := sql.Open("sqlite3", dsn)
	if err != nil {
		return nil, fmt.Errorf("failed to open database: %w", err)
	}

	// SQLite allows a single writer at a time; WAL plus a small pool keeps
	// concurrent websocket writes from failing with "database is locked".
	database.SetMaxOpenConns(8)
	database.SetMaxIdleConns(8)
	database.SetConnMaxLifetime(time.Hour)

	if err := database.Ping(); err != nil {
		database.Close()
		return nil, fmt.Errorf("failed to connect to database: %w", err)
	}

	// Every statement uses IF NOT EXISTS, so this is safe to run on every start
	// and also repairs a database that was only partially created.
	if err := createSchema(database); err != nil {
		database.Close()
		return nil, fmt.Errorf("failed to create schema: %w", err)
	}

	if err := verifyForeignKeys(database); err != nil {
		database.Close()
		return nil, err
	}

	return database, nil
}

// verifyForeignKeys makes sure foreign key enforcement is really active on
// pooled connections, so a broken DSN cannot go unnoticed.
func verifyForeignKeys(db *sql.DB) error {
	var enabled int
	if err := db.QueryRow("PRAGMA foreign_keys").Scan(&enabled); err != nil {
		return fmt.Errorf("failed to read foreign_keys pragma: %w", err)
	}
	if enabled != 1 {
		return fmt.Errorf("foreign key enforcement is disabled")
	}
	return nil
}

// createSchema creates all required database tables
func createSchema(db *sql.DB) error {
	schema := `
	-- Users table
	CREATE TABLE IF NOT EXISTS users (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		nickname TEXT NOT NULL UNIQUE,
		age INTEGER NOT NULL,
		gender TEXT NOT NULL,
		first_name TEXT NOT NULL,
		last_name TEXT NOT NULL,
		email TEXT NOT NULL UNIQUE,
		password TEXT NOT NULL,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);

	-- Sessions table for authentication
	CREATE TABLE IF NOT EXISTS sessions (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		user_id INTEGER NOT NULL,
		session_token TEXT NOT NULL UNIQUE,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		expires_at DATETIME NOT NULL,
		FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
	);

	-- Categories table for posts
	CREATE TABLE IF NOT EXISTS categories (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		name TEXT NOT NULL UNIQUE,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);

	-- Posts table
	CREATE TABLE IF NOT EXISTS posts (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		user_id INTEGER NOT NULL,
		title TEXT NOT NULL,
		content TEXT NOT NULL,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
	);

	-- Post-Category association table
	CREATE TABLE IF NOT EXISTS post_categories (
		post_id INTEGER NOT NULL,
		category_id INTEGER NOT NULL,
		PRIMARY KEY (post_id, category_id),
		FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
		FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
	);

	-- Comments table
	CREATE TABLE IF NOT EXISTS comments (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		post_id INTEGER NOT NULL,
		user_id INTEGER NOT NULL,
		content TEXT NOT NULL,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
		FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
	);

	-- Private messages table
	CREATE TABLE IF NOT EXISTS messages (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		sender_id INTEGER NOT NULL,
		receiver_id INTEGER NOT NULL,
		content TEXT NOT NULL,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE,
		FOREIGN KEY (receiver_id) REFERENCES users(id) ON DELETE CASCADE
	);

	-- Indexes for performance
	CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(session_token);
	CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
	CREATE INDEX IF NOT EXISTS idx_posts_user ON posts(user_id);
	CREATE INDEX IF NOT EXISTS idx_comments_post ON comments(post_id);
	CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_id);
	CREATE INDEX IF NOT EXISTS idx_messages_receiver ON messages(receiver_id);
	CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);
	-- Comment Reactions table
	CREATE TABLE IF NOT EXISTS comment_reactions (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		user_id INTEGER NOT NULL,
		comment_id INTEGER NOT NULL,
		type TEXT NOT NULL CHECK(type IN ('like', 'dislike')),
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
		FOREIGN KEY (comment_id) REFERENCES comments(id) ON DELETE CASCADE,
		UNIQUE(user_id, comment_id)
	);

	-- Post Reactions table
	CREATE TABLE IF NOT EXISTS post_reactions (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		user_id INTEGER NOT NULL,
		post_id INTEGER NOT NULL,
		type TEXT NOT NULL CHECK(type IN ('like', 'dislike')),
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
		FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
		UNIQUE(user_id, post_id)
	);

	CREATE INDEX IF NOT EXISTS idx_comment_reactions_comment ON comment_reactions(comment_id);
	CREATE INDEX IF NOT EXISTS idx_post_reactions_post ON post_reactions(post_id);
	`

	_, err := db.Exec(schema)
	if err != nil {
		return fmt.Errorf("failed to execute schema: %w", err)
	}

	return nil
}
