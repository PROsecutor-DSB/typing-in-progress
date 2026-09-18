package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"real-time-forum/internal/chat"
	"real-time-forum/internal/database"
	"real-time-forum/internal/handlers"
	"real-time-forum/internal/models"
)

const (
	serverPort   = "8080"
	databasePath = "database.db"
	frontendDir  = "./frontend"

	// The websocket pumps set their own deadlines once the connection is
	// hijacked, so these limits only apply to ordinary HTTP requests.
	readHeaderTimeout = 10 * time.Second
	readTimeout       = 30 * time.Second
	writeTimeout      = 30 * time.Second
	idleTimeout       = 120 * time.Second
	shutdownTimeout   = 10 * time.Second
)

func main() {
	// Initialize SQLite database
	db, err := database.InitDatabase(databasePath)
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

	h := handlers.NewHandler(users, sessions, posts, comments, reactions, messages, hub)

	srv := &http.Server{
		Addr:              ":" + serverPort,
		Handler:           newRouter(h, hub),
		ReadHeaderTimeout: readHeaderTimeout,
		ReadTimeout:       readTimeout,
		WriteTimeout:      writeTimeout,
		IdleTimeout:       idleTimeout,
	}

	// Stop on Ctrl-C or SIGTERM instead of dropping connections
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	go func() {
		log.Printf("Server starting on port %s...", serverPort)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("Server failed to start: %v", err)
		}
	}()

	<-ctx.Done()
	log.Println("Shutting down...")

	shutdownCtx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
	defer cancel()

	// Websocket connections are hijacked and therefore invisible to Shutdown
	hub.CloseAll()

	if err := srv.Shutdown(shutdownCtx); err != nil {
		log.Printf("Graceful shutdown failed: %v", err)
	}

	log.Println("Server stopped")
}

// newRouter wires every route of the application.
func newRouter(h *handlers.Handler, hub *chat.Hub) http.Handler {
	mux := http.NewServeMux()

	// Frontend, with a fallback so client side routes survive a page reload
	mux.Handle("/", handlers.SPAHandler(frontendDir))

	// Every authenticated endpoint goes through h.RequireAuth, which is the
	// single place where the session cookie and its expiry are checked.
	getPosts := h.RequireAuth(h.GetPostsHandler)
	createPost := h.RequireAuth(h.CreatePostHandler)
	getComments := h.RequireAuth(h.GetCommentsHandler)
	createComment := h.RequireAuth(h.CreateCommentHandler)
	toggleReaction := h.RequireAuth(h.ToggleReactionHandler)

	// Auth
	mux.HandleFunc("/api/register", h.RegisterHandler)
	mux.HandleFunc("/api/login", h.LoginHandler)
	mux.HandleFunc("/api/logout", h.RequireAuth(h.LogoutHandler))
	mux.HandleFunc("/api/me", h.RequireAuth(h.MeHandler))

	// Posts, and reactions addressed as /api/posts/{id}/{action}
	mux.HandleFunc("/api/posts/", func(w http.ResponseWriter, r *http.Request) {
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
			getPosts(w, r)
		case http.MethodPost:
			createPost(w, r)
		default:
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		}
	})

	mux.HandleFunc("/api/comments/", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		toggleReaction(w, r)
	})

	// Comments
	mux.HandleFunc("/api/comments", func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			getComments(w, r)
		case http.MethodPost:
			createComment(w, r)
		default:
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		}
	})

	// Reactions
	mux.HandleFunc("/api/reactions", toggleReaction)

	// Chat / WebSocket
	mux.HandleFunc("/ws", h.RequireAuth(func(w http.ResponseWriter, r *http.Request) {
		h.ServeWs(hub, w, r)
	}))
	mux.HandleFunc("/api/messages", h.RequireAuth(h.GetChatHistoryHandler))
	mux.HandleFunc("/api/users", h.RequireAuth(h.GetUsersHandler))

	return mux
}
