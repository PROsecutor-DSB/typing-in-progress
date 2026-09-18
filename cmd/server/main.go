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
	reactions := &models.ReactionModel{DB: db}
	messages := &models.MessageModel{DB: db}

	// Initialize Chat Hub
	hub := chat.NewHub()
	go hub.Run()

	// Initialize handlers (Inject Hub and Reactions)
	h := handlers.NewHandler(users, sessions, posts, comments, reactions, messages, hub)

	// Serve static files from frontend directory
	fs := http.FileServer(http.Dir("./frontend"))
	http.Handle("/", fs)

	// API routes
	// Every authenticated endpoint goes through h.RequireAuth, which is the
	// single place where the session cookie and its expiry are checked.
	createPost := h.RequireAuth(h.CreatePostHandler)
	createComment := h.RequireAuth(h.CreateCommentHandler)
	toggleReaction := h.RequireAuth(h.ToggleReactionHandler)

	// Auth
	http.HandleFunc("/api/register", h.RegisterHandler)
	http.HandleFunc("/api/login", h.LoginHandler)
	http.HandleFunc("/api/logout", h.RequireAuth(h.LogoutHandler))
	http.HandleFunc("/api/me", h.RequireAuth(h.MeHandler))

	// Posts, and reactions addressed as /api/posts/{id}/{action}
	http.HandleFunc("/api/posts/", func(w http.ResponseWriter, r *http.Request) {
		if strings.TrimPrefix(r.URL.Path, "/api/posts/") != "" {
			if r.Method != http.MethodPost {
				http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
				return
			}
			toggleReaction(w, r)
			return
		}

		switch r.Method {
		case http.MethodGet:
			h.GetPostsHandler(w, r)
		case http.MethodPost:
			createPost(w, r)
		default:
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		}
	})

	http.HandleFunc("/api/comments/", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		toggleReaction(w, r)
	})

	// Comments
	http.HandleFunc("/api/comments", func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			h.GetCommentsHandler(w, r)
		case http.MethodPost:
			createComment(w, r)
		default:
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		}
	})

	// Reactions
	http.HandleFunc("/api/reactions", toggleReaction)

	// Chat / WebSocket
	http.HandleFunc("/ws", h.RequireAuth(func(w http.ResponseWriter, r *http.Request) {
		h.ServeWs(hub, w, r)
	}))
	http.HandleFunc("/api/messages", h.RequireAuth(h.GetChatHistoryHandler))
	http.HandleFunc("/api/users", h.RequireAuth(h.GetUsersHandler))

	log.Println("Routes configured")

	// Start HTTP server
	port := "8080"
	log.Printf("Server starting on port %s...", port)
	err = http.ListenAndServe(":"+port, nil)
	if err != nil {
		log.Fatalf("Server failed to start: %v", err)
	}
}
