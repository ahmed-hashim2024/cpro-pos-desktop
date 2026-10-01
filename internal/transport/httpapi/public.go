package httpapi

import (
	"encoding/json"
	"io"
	"io/fs"
	"log/slog"
	"net/http"
	"path"
	"strings"

	"cpro/internal/app"
)

// NewPublic returns the handler behind the restaurant's domain (the tunnel
// listener). It serves only the guest e-menu: the page, its assets, item
// images and /api/public/v1. The staff API (/api/v1) is not reachable here
// at all, whatever the request looks like.
func NewPublic(a *app.App, log *slog.Logger, static fs.FS) http.Handler {
	s := &server{app: a, channel: app.ChannelTunnel, log: log}
	mux := http.NewServeMux()

	mux.HandleFunc("GET /api/public/v1/menu", s.public(func(w http.ResponseWriter, r *http.Request) (any, error) {
		return a.PublicMenu(r.Context(), r.URL.Query().Get("table"))
	}))
	mux.HandleFunc("POST /api/public/v1/call", s.public(func(w http.ResponseWriter, r *http.Request) (any, error) {
		var in struct {
			Table string `json:"table"`
			Kind  string `json:"kind"`
		}
		if err := decodeSmall(w, r, &in); err != nil {
			return nil, err
		}
		return nil, a.CallWaiter(r.Context(), in.Table, in.Kind, remoteIP(r))
	}))
	mux.HandleFunc("POST /api/public/v1/orders", s.public(func(w http.ResponseWriter, r *http.Request) (any, error) {
		var in app.OnlineOrderInput
		if err := decodeSmall(w, r, &in); err != nil {
			return nil, err
		}
		return a.SubmitOnlineOrder(r.Context(), in, remoteIP(r))
	}))
	mux.HandleFunc("GET /api/public/v1/orders/{token}", s.public(func(w http.ResponseWriter, r *http.Request) (any, error) {
		return a.GuestOrderStatus(r.Context(), r.PathValue("token"))
	}))
	mux.HandleFunc("GET /api/public/v1/images/{name}", func(w http.ResponseWriter, r *http.Request) {
		p, ok := a.ImagePath(r.PathValue("name"))
		if !ok {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Cache-Control", "public, max-age=86400")
		http.ServeFile(w, r, p)
	})
	mux.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "غير موجود"})
	})

	page := func(w http.ResponseWriter, r *http.Request) {
		if static == nil {
			http.NotFound(w, r)
			return
		}
		b, err := fs.ReadFile(static, "menu.html")
		if err != nil {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("Cache-Control", "no-cache")
		w.Write(b)
	}
	mux.HandleFunc("GET /{$}", page)
	mux.HandleFunc("GET /t/{token}", page)
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		// Only built assets; never index.html (the staff app).
		p := strings.TrimPrefix(path.Clean(r.URL.Path), "/")
		if static == nil || !(strings.HasPrefix(p, "assets/") || strings.HasPrefix(p, "fonts/") || p == "favicon.svg") {
			http.NotFound(w, r)
			return
		}
		if strings.HasPrefix(p, "assets/") {
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		}
		http.FileServerFS(static).ServeHTTP(w, r)
	})
	return s.recover(publicHeaders(mux))
}

func publicHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("X-Frame-Options", "DENY")
		h.Set("Referrer-Policy", "strict-origin-when-cross-origin")
		h.Set("Content-Security-Policy", "default-src 'self'; img-src 'self' https: data:; style-src 'self' 'unsafe-inline'; "+
			"font-src 'self' data:; connect-src 'self'; frame-src https://www.google.com; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
		if r.Method != http.MethodGet && r.Method != http.MethodPost && r.Method != http.MethodHead {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// decodeSmall reads a guest request body (a few KB at most).
func decodeSmall(w http.ResponseWriter, r *http.Request, v any) error {
	r.Body = http.MaxBytesReader(w, r.Body, 64<<10)
	if err := json.NewDecoder(io.LimitReader(r.Body, 64<<10)).Decode(v); err != nil {
		return errBadJSON
	}
	return nil
}
