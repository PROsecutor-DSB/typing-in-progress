package handlers

import (
	"io/fs"
	"net/http"
	"path"
	"path/filepath"
	"strings"
)

// noListingFS serves files but hides directories that have no index.html, so
// that /static/ cannot be browsed.
type noListingFS struct {
	fs http.FileSystem
}

func (n noListingFS) Open(name string) (http.File, error) {
	file, err := n.fs.Open(name)
	if err != nil {
		return nil, err
	}

	info, err := file.Stat()
	if err != nil {
		file.Close()
		return nil, err
	}

	if info.IsDir() {
		index, err := n.fs.Open(strings.TrimSuffix(name, "/") + "/index.html")
		if err != nil {
			file.Close()
			return nil, fs.ErrNotExist
		}
		index.Close()
	}

	return file, nil
}

// SPAHandler serves the frontend. Existing files are returned as they are and
// anything else falls back to index.html, so that a deep link such as
// /posts/12 opens the application instead of a bare 404. Unknown API paths and
// missing assets keep returning 404.
func SPAHandler(root string) http.Handler {
	dir := noListingFS{http.Dir(root)}
	fileServer := http.FileServer(dir)
	index := filepath.Join(root, "index.html")

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		// path.Clean drops a trailing slash, so "/static/" becomes "/static"
		urlPath := path.Clean("/" + r.URL.Path)

		// An unknown API or websocket path is an error, never the app shell
		if underPrefix(urlPath, "/api") || urlPath == "/ws" {
			http.NotFound(w, r)
			return
		}

		// Assets resolve normally, including their 404s
		if underPrefix(urlPath, "/static") || urlPath == "/" {
			fileServer.ServeHTTP(w, r)
			return
		}

		if file, err := dir.Open(urlPath); err == nil {
			file.Close()
			fileServer.ServeHTTP(w, r)
			return
		}

		// Client side route: let the SPA resolve it
		http.ServeFile(w, r, index)
	})
}

// underPrefix reports whether urlPath is the prefix itself or lives under it.
func underPrefix(urlPath, prefix string) bool {
	return urlPath == prefix || strings.HasPrefix(urlPath, prefix+"/")
}
