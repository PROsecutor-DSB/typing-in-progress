package handlers

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"real-time-forum/internal/models"

	"github.com/gofrs/uuid"
	"golang.org/x/crypto/bcrypt"
)

const (
	sessionCookieName = "session_token"
	sessionDuration   = 24 * time.Hour

	minNicknameLen = 3
	maxNicknameLen = 20
	minPasswordLen = 8
	maxPasswordLen = 72 // bcrypt refuses anything longer
	minAge         = 13
	maxAge         = 120
	maxNameLen     = 50
	maxEmailLen    = 254
)

var (
	nicknamePattern = regexp.MustCompile(`^[\p{L}\p{N}_-]+$`)
	emailPattern    = regexp.MustCompile(`^[^@\s]+@[^@\s]+\.[^@\s]{2,}$`)
	allowedGenders  = map[string]bool{"male": true, "female": true, "other": true}
)

type registerRequest struct {
	Nickname  string `json:"nickname"`
	Age       int    `json:"age"`
	Gender    string `json:"gender"`
	FirstName string `json:"first_name"`
	LastName  string `json:"last_name"`
	Email     string `json:"email"`
	Password  string `json:"password"`
}

// normalize trims the incoming values so that " alice " and "alice" cannot
// become two different accounts.
func (req *registerRequest) normalize() {
	req.Nickname = strings.TrimSpace(req.Nickname)
	req.Gender = strings.ToLower(strings.TrimSpace(req.Gender))
	req.FirstName = strings.TrimSpace(req.FirstName)
	req.LastName = strings.TrimSpace(req.LastName)
	req.Email = strings.ToLower(strings.TrimSpace(req.Email))
}

// validate returns a message describing the first problem found, or an empty
// string when the registration data is acceptable.
func (req *registerRequest) validate() string {
	nicknameLen := utf8.RuneCountInString(req.Nickname)

	switch {
	case nicknameLen < minNicknameLen || nicknameLen > maxNicknameLen:
		return fmt.Sprintf("Nickname must be between %d and %d characters", minNicknameLen, maxNicknameLen)
	case !nicknamePattern.MatchString(req.Nickname):
		return "Nickname may only contain letters, digits, '_' and '-'"
	case req.Age < minAge || req.Age > maxAge:
		return fmt.Sprintf("Age must be between %d and %d", minAge, maxAge)
	case !allowedGenders[req.Gender]:
		return "Gender must be male, female or other"
	case req.FirstName == "" || utf8.RuneCountInString(req.FirstName) > maxNameLen:
		return fmt.Sprintf("First name is required and must be at most %d characters", maxNameLen)
	case req.LastName == "" || utf8.RuneCountInString(req.LastName) > maxNameLen:
		return fmt.Sprintf("Last name is required and must be at most %d characters", maxNameLen)
	case len(req.Email) > maxEmailLen || !emailPattern.MatchString(req.Email):
		return "A valid e-mail address is required"
	case utf8.RuneCountInString(req.Password) < minPasswordLen:
		return fmt.Sprintf("Password must be at least %d characters long", minPasswordLen)
	case len(req.Password) > maxPasswordLen:
		return fmt.Sprintf("Password must be at most %d bytes long", maxPasswordLen)
	}
	return ""
}

// sessionCookie builds the session cookie. It is not readable from JavaScript
// and is not sent on cross-site requests.
func sessionCookie(r *http.Request, value string, expires time.Time) *http.Cookie {
	return &http.Cookie{
		Name:     sessionCookieName,
		Value:    value,
		Path:     "/",
		Expires:  expires,
		HttpOnly: true,
		Secure:   r.TLS != nil,
		SameSite: http.SameSiteLaxMode,
	}
}

func (h *Handler) RegisterHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req registerRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	req.normalize()
	if msg := req.validate(); msg != "" {
		http.Error(w, msg, http.StatusBadRequest)
		return
	}

	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		http.Error(w, "Internal server error", http.StatusInternalServerError)
		return
	}

	user := &models.User{
		Nickname:  req.Nickname,
		Age:       req.Age,
		Gender:    req.Gender,
		FirstName: req.FirstName,
		LastName:  req.LastName,
		Email:     req.Email,
		Password:  string(hashedPassword),
	}

	if err := h.Users.Create(user); err != nil {
		switch {
		case errors.Is(err, models.ErrDuplicateNickname):
			http.Error(w, "This nickname is already taken", http.StatusConflict)
		case errors.Is(err, models.ErrDuplicateEmail):
			http.Error(w, "This e-mail is already registered", http.StatusConflict)
		default:
			http.Error(w, "Failed to create user", http.StatusInternalServerError)
		}
		return
	}

	w.WriteHeader(http.StatusCreated)
	w.Write([]byte("User created successfully"))
}

func (h *Handler) LoginHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		Identifier string `json:"identifier"` // Email or Nickname
		Password   string `json:"password"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	req.Identifier = strings.TrimSpace(req.Identifier)
	if req.Identifier == "" || req.Password == "" {
		http.Error(w, "Invalid credentials", http.StatusUnauthorized)
		return
	}

	// Try to find by email first, then by nickname
	user, err := h.Users.GetByEmail(strings.ToLower(req.Identifier))
	if err != nil {
		user, err = h.Users.GetByNickname(req.Identifier)
		if err != nil {
			http.Error(w, "Invalid credentials", http.StatusUnauthorized)
			return
		}
	}

	if err := bcrypt.CompareHashAndPassword([]byte(user.Password), []byte(req.Password)); err != nil {
		http.Error(w, "Invalid credentials", http.StatusUnauthorized)
		return
	}

	// Invalidate old sessions
	h.Sessions.DeleteByUserID(user.ID)

	// Create session
	token, err := uuid.NewV4()
	if err != nil {
		http.Error(w, "Internal server error", http.StatusInternalServerError)
		return
	}

	expiresAt := time.Now().Add(sessionDuration)
	if err := h.Sessions.Create(user.ID, token.String(), expiresAt); err != nil {
		http.Error(w, "Internal server error", http.StatusInternalServerError)
		return
	}

	http.SetCookie(w, sessionCookie(r, token.String(), expiresAt))

	w.WriteHeader(http.StatusOK)
	w.Write([]byte("Login successful"))
}

// MeHandler returns the currently authenticated user's id and nickname.
func (h *Handler) MeHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	user, err := h.Users.GetByID(sessionFrom(r).UserID)
	if err != nil {
		http.Error(w, "User not found", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(struct {
		ID       int    `json:"id"`
		Nickname string `json:"nickname"`
	}{ID: user.ID, Nickname: user.Nickname})
}

func (h *Handler) LogoutHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	if err := h.Sessions.Delete(sessionFrom(r).SessionToken); err != nil {
		http.Error(w, "Internal server error", http.StatusInternalServerError)
		return
	}

	expired := sessionCookie(r, "", time.Unix(0, 0))
	expired.MaxAge = -1
	http.SetCookie(w, expired)

	w.WriteHeader(http.StatusOK)
	w.Write([]byte("Logout successful"))
}
