package main

import (
	"log"
	"net/http"
	"real-time-forum/internal/chat"
	"real-time-forum/internal/database"
	"real-time-forum/internal/handlers"
	"real-time-forum/internal/models"
	"strings"
)

func main() {
	// Initialize SQLite database
	db, err := database.InitDatabase()
	if err != nil {
		log.Fatalf("Failed to initialize database: %v", err)
	}
	defer db.Close()

	log.Println("Database initialized successfully")

	// Initialize models
	users := &models.UserModel{DB: db}
	sessions := &models.SessionModel{DB: db}
	posts := &models.PostModel{DB: db}
	comments := &models.CommentModel{DB: db}
	reactions := &models.ReactionModel{DB: db} // New Model

	// Initialize Chat Hub
	hub := chat.NewHub()
	go hub.Run()

	// Initialize handlers (Inject Hub and Reactions)
	h := handlers.NewHandler(users, sessions, posts, comments, reactions, hub)

	// Serve static files from frontend directory
	fs := http.FileServer(http.Dir("./frontend"))
	http.Handle("/", fs)

	// API routes
	// Auth
	http.HandleFunc("/api/register", h.RegisterHandler)
	http.HandleFunc("/api/login", h.LoginHandler)
	http.HandleFunc("/api/logout", h.LogoutHandler)
	http.HandleFunc("/api/me", h.MeHandler)

	// Posts

	// Reactions для постов и комментариев
	http.HandleFunc("/api/posts/", func(w http.ResponseWriter, r *http.Request) {
		path := strings.TrimPrefix(r.URL.Path, "/api/posts/")

		// Если путь пустой или только слеш, это обычный запрос к постам
		if path == "" {
			if r.Method == http.MethodGet {
				h.GetPostsHandler(w, r)
			} else if r.Method == http.MethodPost {
				h.CreatePostHandler(w, r)
			} else {
				http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			}
			return
		}

		// Иначе это запрос реакции /api/posts/{id}/{action}
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		h.ToggleReactionHandler(w, r)
	})

	http.HandleFunc("/api/comments/", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		h.ToggleReactionHandler(w, r)
	})

	// Comments
	http.HandleFunc("/api/comments", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet {
			h.GetCommentsHandler(w, r)
		} else if r.Method == http.MethodPost {
			h.CreateCommentHandler(w, r)
		} else {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		}
	})

	// Reactions
	http.HandleFunc("/api/reactions", h.ToggleReactionHandler)

	// Chat / WebSocket
	http.HandleFunc("/ws", func(w http.ResponseWriter, r *http.Request) {
		h.ServeWs(hub, w, r)
	})
	http.HandleFunc("/api/messages", h.GetChatHistoryHandler)
	http.HandleFunc("/api/users", h.GetUsersHandler)

	log.Println("Routes configured")

	// Start HTTP server
	port := "8080"
	log.Printf("Server starting on port %s...", port)
	err = http.ListenAndServe(":"+port, nil)
	if err != nil {
		log.Fatalf("Server failed to start: %v", err)
	}
}
