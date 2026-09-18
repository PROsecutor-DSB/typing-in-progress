package handlers_test

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"real-time-forum/internal/handlers"
)

// The SPA must survive a reload on a client side route, without turning every
// missing asset or unknown API path into an HTML page.
func TestSPAHandler(t *testing.T) {
	handler := handlers.SPAHandler("../../frontend")

	cases := []struct {
		name     string
		path     string
		want     int
		wantHTML bool
	}{
		{"index", "/", http.StatusOK, true},
		{"deep link falls back to the app", "/posts/12", http.StatusOK, true},
		{"unknown client route falls back too", "/whatever", http.StatusOK, true},
		{"stylesheet", "/static/css/style.css", http.StatusOK, false},
		{"module", "/static/js/app.js", http.StatusOK, false},
		{"directory listing is hidden", "/static/", http.StatusNotFound, false},
		{"nested directory listing is hidden", "/static/js/", http.StatusNotFound, false},
		{"missing asset stays a 404", "/static/js/nope.js", http.StatusNotFound, false},
		{"unknown api path stays a 404", "/api/nope", http.StatusNotFound, false},
		{"websocket path is never the shell", "/ws", http.StatusNotFound, false},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, tc.path, nil))

			if rec.Code != tc.want {
				t.Fatalf("got %d, want %d", rec.Code, tc.want)
			}
			if tc.wantHTML && !strings.Contains(rec.Body.String(), "<div id=\"app\">") {
				t.Errorf("expected the application shell, got %.80s", rec.Body.String())
			}
			if !tc.wantHTML && strings.Contains(rec.Body.String(), "<div id=\"app\">") {
				t.Error("the application shell leaked into a non-page response")
			}
		})
	}

	t.Run("traversal cannot escape the frontend directory", func(t *testing.T) {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/static/../../go.mod", nil)
		handler.ServeHTTP(rec, req)
		if strings.Contains(rec.Body.String(), "module real-time-forum") {
			t.Error("served a file from outside the frontend directory")
		}
	})
}
