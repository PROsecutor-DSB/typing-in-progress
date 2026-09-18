package handlers_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"real-time-forum/internal/chat"
	"real-time-forum/internal/database"
	"real-time-forum/internal/handlers"
	"real-time-forum/internal/models"
)

type testEnv struct {
	handler  *handlers.Handler
	sessions *models.SessionModel
}

func newEnv(t *testing.T) *testEnv {
	t.Helper()

	db, err := database.InitDatabase(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("InitDatabase: %v", err)
	}
	t.Cleanup(func() { db.Close() })

	hub := chat.NewHub()
	go hub.Run()

	sessions := &models.SessionModel{DB: db}
	h := handlers.NewHandler(
		&models.UserModel{DB: db}, sessions,
		&models.PostModel{DB: db}, &models.CommentModel{DB: db},
		&models.ReactionModel{DB: db}, &models.MessageModel{DB: db}, hub,
	)

	return &testEnv{handler: h, sessions: sessions}
}

func postJSON(t *testing.T, handler http.HandlerFunc, path, body string, cookie *http.Cookie) *httptest.ResponseRecorder {
	t.Helper()

	req := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	if cookie != nil {
		req.AddCookie(cookie)
	}

	rec := httptest.NewRecorder()
	handler(rec, req)
	return rec
}

const validRegistration = `{"nickname":"alice","age":25,"gender":"female","first_name":"Alice","last_name":"L","email":"alice@example.com","password":"secret123"}`

func TestRegisterValidation(t *testing.T) {
	cases := []struct {
		name string
		body string
		want int
	}{
		{"valid", validRegistration, http.StatusCreated},
		{"everything empty", `{"nickname":"","age":0,"gender":"","first_name":"","last_name":"","email":"","password":""}`, http.StatusBadRequest},
		{"nickname too short", `{"nickname":"ab","age":25,"gender":"male","first_name":"A","last_name":"B","email":"a@b.com","password":"secret123"}`, http.StatusBadRequest},
		{"markup in nickname", `{"nickname":"<b>xy","age":25,"gender":"male","first_name":"A","last_name":"B","email":"a@b.com","password":"secret123"}`, http.StatusBadRequest},
		{"negative age", `{"nickname":"bob","age":-42,"gender":"male","first_name":"A","last_name":"B","email":"a@b.com","password":"secret123"}`, http.StatusBadRequest},
		{"unknown gender", `{"nickname":"bob","age":25,"gender":"alien","first_name":"A","last_name":"B","email":"a@b.com","password":"secret123"}`, http.StatusBadRequest},
		{"malformed email", `{"nickname":"bob","age":25,"gender":"male","first_name":"A","last_name":"B","email":"not-an-email","password":"secret123"}`, http.StatusBadRequest},
		{"short password", `{"nickname":"bob","age":25,"gender":"male","first_name":"A","last_name":"B","email":"a@b.com","password":"short"}`, http.StatusBadRequest},
		{"unicode nickname", `{"nickname":"Аружан","age":25,"gender":"female","first_name":"Аружан","last_name":"Ж","email":"aruzhan@example.com","password":"secret123"}`, http.StatusCreated},
	}

	env := newEnv(t)
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := postJSON(t, env.handler.RegisterHandler, "/api/register", tc.body, nil)
			if rec.Code != tc.want {
				t.Errorf("got %d, want %d (%s)", rec.Code, tc.want, strings.TrimSpace(rec.Body.String()))
			}
		})
	}
}

func TestRegisterReportsDuplicates(t *testing.T) {
	env := newEnv(t)
	postJSON(t, env.handler.RegisterHandler, "/api/register", validRegistration, nil)

	rec := postJSON(t, env.handler.RegisterHandler, "/api/register",
		`{"nickname":"alice","age":25,"gender":"male","first_name":"A","last_name":"B","email":"other@example.com","password":"secret123"}`, nil)
	if rec.Code != http.StatusConflict {
		t.Errorf("duplicate nickname: got %d, want %d", rec.Code, http.StatusConflict)
	}

	rec = postJSON(t, env.handler.RegisterHandler, "/api/register",
		`{"nickname":"alice2","age":25,"gender":"male","first_name":"A","last_name":"B","email":"alice@example.com","password":"secret123"}`, nil)
	if rec.Code != http.StatusConflict {
		t.Errorf("duplicate email: got %d, want %d", rec.Code, http.StatusConflict)
	}
}

func login(t *testing.T, env *testEnv, identifier, password string) *http.Cookie {
	t.Helper()

	rec := postJSON(t, env.handler.LoginHandler, "/api/login",
		`{"identifier":"`+identifier+`","password":"`+password+`"}`, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("login failed: %d %s", rec.Code, rec.Body.String())
	}

	for _, cookie := range rec.Result().Cookies() {
		if cookie.Name == "session_token" {
			return cookie
		}
	}
	t.Fatal("login did not set a session cookie")
	return nil
}

func TestLogin(t *testing.T) {
	env := newEnv(t)
	postJSON(t, env.handler.RegisterHandler, "/api/register", validRegistration, nil)

	t.Run("by nickname and by email", func(t *testing.T) {
		login(t, env, "alice", "secret123")
		login(t, env, "ALICE@example.com", "secret123") // e-mail is case insensitive
	})

	t.Run("empty credentials are rejected", func(t *testing.T) {
		rec := postJSON(t, env.handler.LoginHandler, "/api/login", `{"identifier":"","password":""}`, nil)
		if rec.Code != http.StatusUnauthorized {
			t.Errorf("got %d, want %d", rec.Code, http.StatusUnauthorized)
		}
	})

	t.Run("wrong password is rejected", func(t *testing.T) {
		rec := postJSON(t, env.handler.LoginHandler, "/api/login", `{"identifier":"alice","password":"nope"}`, nil)
		if rec.Code != http.StatusUnauthorized {
			t.Errorf("got %d, want %d", rec.Code, http.StatusUnauthorized)
		}
	})

	t.Run("the session cookie is not reachable from JavaScript", func(t *testing.T) {
		cookie := login(t, env, "alice", "secret123")
		if !cookie.HttpOnly {
			t.Error("cookie is missing HttpOnly")
		}
		if cookie.SameSite != http.SameSiteLaxMode {
			t.Errorf("cookie SameSite = %v, want Lax", cookie.SameSite)
		}
		if cookie.Path != "/" {
			t.Errorf("cookie path = %q, want /", cookie.Path)
		}
	})
}

func TestRequireAuth(t *testing.T) {
	env := newEnv(t)
	postJSON(t, env.handler.RegisterHandler, "/api/register", validRegistration, nil)

	guarded := env.handler.RequireAuth(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	t.Run("no cookie", func(t *testing.T) {
		rec := httptest.NewRecorder()
		guarded(rec, httptest.NewRequest(http.MethodGet, "/api/me", nil))
		if rec.Code != http.StatusUnauthorized {
			t.Errorf("got %d, want %d", rec.Code, http.StatusUnauthorized)
		}
	})

	t.Run("unknown token", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/me", nil)
		req.AddCookie(&http.Cookie{Name: "session_token", Value: "made-up"})
		rec := httptest.NewRecorder()
		guarded(rec, req)
		if rec.Code != http.StatusUnauthorized {
			t.Errorf("got %d, want %d", rec.Code, http.StatusUnauthorized)
		}
	})

	t.Run("valid session", func(t *testing.T) {
		cookie := login(t, env, "alice", "secret123")
		req := httptest.NewRequest(http.MethodGet, "/api/me", nil)
		req.AddCookie(cookie)
		rec := httptest.NewRecorder()
		guarded(rec, req)
		if rec.Code != http.StatusOK {
			t.Errorf("got %d, want %d", rec.Code, http.StatusOK)
		}
	})

	t.Run("expired session", func(t *testing.T) {
		cookie := login(t, env, "alice", "secret123")
		session, err := env.sessions.GetByToken(cookie.Value)
		if err != nil {
			t.Fatalf("GetByToken: %v", err)
		}
		env.sessions.Delete(session.SessionToken)
		if err := env.sessions.Create(session.UserID, session.SessionToken, time.Now().Add(-time.Hour)); err != nil {
			t.Fatalf("Create: %v", err)
		}

		req := httptest.NewRequest(http.MethodGet, "/api/me", nil)
		req.AddCookie(cookie)
		rec := httptest.NewRecorder()
		guarded(rec, req)
		if rec.Code != http.StatusUnauthorized {
			t.Errorf("expired session accepted: got %d, want %d", rec.Code, http.StatusUnauthorized)
		}
	})
}

func TestMeAndLogout(t *testing.T) {
	env := newEnv(t)
	postJSON(t, env.handler.RegisterHandler, "/api/register", validRegistration, nil)
	cookie := login(t, env, "alice", "secret123")

	req := httptest.NewRequest(http.MethodGet, "/api/me", nil)
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()
	env.handler.RequireAuth(env.handler.MeHandler)(rec, req)

	var me struct {
		ID       int    `json:"id"`
		Nickname string `json:"nickname"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&me); err != nil {
		t.Fatalf("decode /api/me: %v", err)
	}
	if me.Nickname != "alice" {
		t.Errorf("nickname = %q, want alice", me.Nickname)
	}

	rec = postJSON(t, env.handler.RequireAuth(env.handler.LogoutHandler), "/api/logout", "", cookie)
	if rec.Code != http.StatusOK {
		t.Fatalf("logout: got %d", rec.Code)
	}

	// The same cookie must not work afterwards
	req = httptest.NewRequest(http.MethodGet, "/api/me", nil)
	req.AddCookie(cookie)
	rec = httptest.NewRecorder()
	env.handler.RequireAuth(env.handler.MeHandler)(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Errorf("session survived logout: got %d", rec.Code)
	}
}

func TestChatHistoryPageSize(t *testing.T) {
	env := newEnv(t)
	postJSON(t, env.handler.RegisterHandler, "/api/register", validRegistration, nil)
	postJSON(t, env.handler.RegisterHandler, "/api/register",
		`{"nickname":"bob","age":30,"gender":"male","first_name":"Bob","last_name":"O","email":"bob@example.com","password":"secret123"}`, nil)

	cookie := login(t, env, "alice", "secret123")

	for i := 0; i < 15; i++ {
		if err := env.handler.Messages.Save(&models.Message{SenderID: 1, ReceiverID: 2, Content: "hello"}); err != nil {
			t.Fatalf("Save: %v", err)
		}
	}

	req := httptest.NewRequest(http.MethodGet, "/api/messages?user_id=2&offset=0", nil)
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()
	env.handler.RequireAuth(env.handler.GetChatHistoryHandler)(rec, req)

	var page []models.Message
	if err := json.NewDecoder(rec.Body).Decode(&page); err != nil {
		t.Fatalf("decode history: %v", err)
	}
	// The audit asks for the last 10 messages, not more
	if len(page) != 10 {
		t.Errorf("history page = %d messages, want 10", len(page))
	}
}

// Writing against a row that does not exist is the client's mistake, so it
// must not be reported as an internal server error.
func TestMissingRelationsAreClientErrors(t *testing.T) {
	env := newEnv(t)
	postJSON(t, env.handler.RegisterHandler, "/api/register", validRegistration, nil)
	cookie := login(t, env, "alice", "secret123")

	cases := []struct {
		name    string
		handler http.HandlerFunc
		path    string
		body    string
	}{
		{"comment on a missing post", env.handler.RequireAuth(env.handler.CreateCommentHandler), "/api/comments", `{"post_id":99999,"content":"orphan"}`},
		{"reaction on a missing post", env.handler.RequireAuth(env.handler.ToggleReactionHandler), "/api/reactions", `{"post_id":99999,"type":"like"}`},
		{"reaction on a missing comment", env.handler.RequireAuth(env.handler.ToggleReactionHandler), "/api/reactions", `{"comment_id":99999,"type":"like"}`},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := postJSON(t, tc.handler, tc.path, tc.body, cookie)
			if rec.Code != http.StatusBadRequest {
				t.Errorf("got %d, want %d (%s)", rec.Code, http.StatusBadRequest, strings.TrimSpace(rec.Body.String()))
			}
			if !strings.Contains(rec.Body.String(), "does not exist") {
				t.Errorf("the message does not explain the problem: %q", strings.TrimSpace(rec.Body.String()))
			}
		})
	}
}

// A valid comment must still work after the error mapping above.
func TestCreateCommentOnExistingPost(t *testing.T) {
	env := newEnv(t)
	postJSON(t, env.handler.RegisterHandler, "/api/register", validRegistration, nil)
	cookie := login(t, env, "alice", "secret123")

	rec := postJSON(t, env.handler.RequireAuth(env.handler.CreatePostHandler), "/api/posts/",
		`{"title":"Title","content":"Body","category":"Tech"}`, cookie)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create post: got %d", rec.Code)
	}

	rec = postJSON(t, env.handler.RequireAuth(env.handler.CreateCommentHandler), "/api/comments",
		`{"post_id":1,"content":"looks good"}`, cookie)
	if rec.Code != http.StatusCreated {
		t.Errorf("create comment: got %d (%s)", rec.Code, strings.TrimSpace(rec.Body.String()))
	}
}
