// Package httpapi exposes the app use cases as a JSON API. The same handler
// serves the desktop window (through the Wails asset server), tablets and
// kitchen screens on the restaurant network, and remote access; only the
// Channel differs, and tokens are bound to the channel they were issued on.
package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"io/fs"
	"log/slog"
	"net"
	"net/http"
	"path"
	"strings"
	"time"

	"cpro/internal/app"
)

type ctxKey struct{}

type server struct {
	app     *app.App
	channel app.Channel
	log     *slog.Logger
}

// New returns the API handler for one channel, mounted under /api/v1/.
// If static is non-nil, other paths serve the web UI from it (with SPA
// fallback to index.html), which is how LAN devices load the app.
func New(a *app.App, ch app.Channel, log *slog.Logger, static fs.FS) http.Handler {
	s := &server{app: a, channel: ch, log: log}
	mux := http.NewServeMux()
	s.routes(mux)
	var h http.Handler = mux
	if static != nil {
		h = withStatic(mux, static)
	}
	return s.recover(securityHeaders(h))
}

// ---- plumbing ----------------------------------------------------------------

type handlerFunc func(w http.ResponseWriter, r *http.Request, actor app.Actor) (any, error)

// public wraps a handler that needs no session.
func (s *server) public(fn func(w http.ResponseWriter, r *http.Request) (any, error)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		out, err := fn(w, r)
		s.respond(w, r, out, err)
	}
}

// auth wraps a handler that requires a valid bearer token on this channel.
func (s *server) auth(fn handlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		token := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
		actor, _, err := s.app.Authenticate(r.Context(), token, s.channel)
		if err != nil {
			s.respond(w, r, nil, err)
			return
		}
		out, err := fn(w, r, actor)
		s.respond(w, r, out, err)
	}
}

// written marks that a handler already wrote its own response (file download).
type written struct{}

func (s *server) respond(w http.ResponseWriter, r *http.Request, out any, err error) {
	if _, ok := out.(written); ok && err == nil {
		return
	}
	if err != nil {
		status, msg := http.StatusInternalServerError, "حدث خطأ غير متوقع"
		var ae *app.Error
		if errors.As(err, &ae) {
			msg = ae.Msg
			status = map[app.Code]int{
				app.CodeInvalid:      http.StatusBadRequest,
				app.CodeNotFound:     http.StatusNotFound,
				app.CodeForbidden:    http.StatusForbidden,
				app.CodeConflict:     http.StatusConflict,
				app.CodeUnauthorized: http.StatusUnauthorized,
			}[ae.Code]
		} else {
			s.log.Error("request failed", "method", r.Method, "path", r.URL.Path, "err", err)
		}
		writeJSON(w, status, map[string]string{"error": msg})
		return
	}
	if out == nil {
		out = map[string]bool{"ok": true}
	}
	writeJSON(w, http.StatusOK, out)
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

var errBadJSON = &app.Error{Code: app.CodeInvalid, Msg: "بيانات الطلب غير صالحة"}

func decode(r *http.Request, v any) error {
	if err := json.NewDecoder(io.LimitReader(r.Body, 4<<20)).Decode(v); err != nil {
		return errBadJSON
	}
	return nil
}

func (s *server) recover(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if p := recover(); p != nil {
				s.log.Error("panic", "path", r.URL.Path, "panic", p)
				writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "حدث خطأ غير متوقع"})
			}
		}()
		next.ServeHTTP(w, r)
	})
}

func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("X-Frame-Options", "SAMEORIGIN")
		h.Set("Referrer-Policy", "no-referrer")
		next.ServeHTTP(w, r)
	})
}

func remoteIP(r *http.Request) string {
	if ip := r.Header.Get("Cf-Connecting-Ip"); ip != "" {
		return ip // set by Cloudflare on the tunnel
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

// withStatic serves the embedded web UI for any non-API path.
func withStatic(api http.Handler, static fs.FS) http.Handler {
	files := http.FileServerFS(static)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/") {
			api.ServeHTTP(w, r)
			return
		}
		p := strings.TrimPrefix(path.Clean(r.URL.Path), "/")
		if p == "" {
			p = "index.html"
		}
		if _, err := fs.Stat(static, p); err != nil {
			r = r.Clone(r.Context())
			r.URL.Path = "/" // SPA route: let the client router handle it
		}
		files.ServeHTTP(w, r)
	})
}

// Listen runs an HTTP server until ctx is cancelled.
func Listen(ctx context.Context, addr string, h http.Handler, log *slog.Logger) error {
	srv := &http.Server{
		Addr:              addr,
		Handler:           h,
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      60 * time.Second,
		IdleTimeout:       120 * time.Second,
	}
	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		srv.Shutdown(shutdown)
	}()
	log.Info("http listening", "addr", addr)
	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}
