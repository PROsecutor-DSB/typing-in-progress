package handlers

import (
	"context"
	"net/http"
	"time"

	"real-time-forum/internal/models"
)

type contextKey string

const sessionContextKey contextKey = "session"

// currentSession resolves the session cookie of a request and rejects sessions
// that have already expired.
func (h *Handler) currentSession(r *http.Request) (*models.Session, bool) {
	c, err := r.Cookie(sessionCookieName)
	if err != nil {
		return nil, false
	}

	session, err := h.Sessions.GetByToken(c.Value)
	if err != nil {
		return nil, false
	}

	if session.ExpiresAt.Before(time.Now()) {
		h.Sessions.Delete(session.SessionToken)
		return nil, false
	}

	return session, true
}

// RequireAuth guards a handler with a single, consistent authentication check
// and passes the session down through the request context.
func (h *Handler) RequireAuth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		session, ok := h.currentSession(r)
		if !ok {
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}
		next(w, r.WithContext(context.WithValue(r.Context(), sessionContextKey, session)))
	}
}

// sessionFrom returns the session stored by RequireAuth. It is never nil in a
// handler wrapped with RequireAuth.
func sessionFrom(r *http.Request) *models.Session {
	session, _ := r.Context().Value(sessionContextKey).(*models.Session)
	return session
}
