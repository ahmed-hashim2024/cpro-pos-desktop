package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"

	"cpro/internal/app"
	"cpro/internal/platform/paths"
	"cpro/internal/store/sqlite"
)

func setup(t *testing.T) (*app.App, *slog.Logger) {
	t.Helper()
	t.Setenv("CPRO_DATA_DIR", t.TempDir())
	p, _ := paths.Resolve()
	db, err := sqlite.Open(context.Background(), p.DB)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	return app.New(db, p, log), log
}

func call(t *testing.T, h http.Handler, method, path, token string, body any) (int, map[string]any) {
	t.Helper()
	var buf bytes.Buffer
	if body != nil {
		json.NewEncoder(&buf).Encode(body)
	}
	req := httptest.NewRequest(method, path, &buf)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	var out map[string]any
	json.Unmarshal(rec.Body.Bytes(), &out)
	return rec.Code, out
}

func TestSetupLoginAndAuth(t *testing.T) {
	a, log := setup(t)
	h := New(a, app.ChannelApp, log, nil)

	code, out := call(t, h, "GET", "/api/v1/status", "", nil)
	if code != 200 || out["needs_setup"] != true {
		t.Fatalf("status: %d %v", code, out)
	}
	code, out = call(t, h, "POST", "/api/v1/setup", "", app.SetupInput{RestaurantName: "R", OwnerName: "O", Username: "o", Password: "pass12345"})
	if code != 200 || out["token"] == "" {
		t.Fatalf("setup: %d %v", code, out)
	}
	token := out["token"].(string)

	if code, _ := call(t, h, "GET", "/api/v1/items", "", nil); code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated items: %d", code)
	}
	if code, _ := call(t, h, "GET", "/api/v1/items", token, nil); code != 200 {
		t.Fatalf("items: %d", code)
	}
	code, out = call(t, h, "POST", "/api/v1/categories", token, app.Category{})
	if code != http.StatusBadRequest || out["error"] == "" {
		t.Fatalf("validation error mapping: %d %v", code, out)
	}
	if code, _ := call(t, h, "GET", "/api/v1/nope", token, nil); code != 404 {
		t.Fatalf("unknown route: %d", code)
	}

	// The app-channel token is useless on the LAN listener.
	lan := New(a, app.ChannelLAN, log, fstest.MapFS{"index.html": {Data: []byte("<html>")}})
	if code, _ := call(t, lan, "GET", "/api/v1/items", token, nil); code != http.StatusUnauthorized {
		t.Fatalf("app token accepted on LAN: %d", code)
	}
	// LAN serves the UI with SPA fallback; setup isn't allowed from the LAN.
	req := httptest.NewRequest("GET", "/pos/tables", nil)
	rec := httptest.NewRecorder()
	lan.ServeHTTP(rec, req)
	if rec.Code != 200 || rec.Body.String() != "<html>" {
		t.Fatalf("spa fallback: %d %q", rec.Code, rec.Body.String())
	}
}

func TestPublicHandlerExposesOnlyTheMenu(t *testing.T) {
	a, log := setup(t)
	staff := New(a, app.ChannelApp, log, nil)
	_, out := call(t, staff, "POST", "/api/v1/setup", "", map[string]string{"restaurant_name": "R", "owner_name": "O", "username": "o", "password": "pass12345"})
	token := out["token"].(string)

	static := fstest.MapFS{
		"index.html":     {Data: []byte("staff")},
		"menu.html":      {Data: []byte("menu")},
		"assets/menu.js": {Data: []byte("js")},
	}
	pub := NewPublic(a, log, static)
	get := func(p string) (int, string) {
		rec := httptest.NewRecorder()
		pub.ServeHTTP(rec, httptest.NewRequest("GET", p, nil))
		return rec.Code, rec.Body.String()
	}
	for _, p := range []string{"/", "/t/abc"} {
		if code, body := get(p); code != 200 || body != "menu" {
			t.Fatalf("%s: %d %q", p, code, body)
		}
	}
	if code, body := get("/assets/menu.js"); code != 200 || body != "js" {
		t.Fatalf("asset: %d %q", code, body)
	}
	for _, p := range []string{"/index.html", "/pos", "/api/v1/status", "/api/v1/items", "/api/v1/backups"} {
		if code, body := get(p); code != 404 || strings.Contains(body, "staff") {
			t.Fatalf("%s reachable on the public handler: %d %q", p, code, body)
		}
	}
	// Even a valid staff token gets nothing through it.
	if code, _ := call(t, pub, "GET", "/api/v1/items", token, nil); code != 404 {
		t.Fatalf("staff API via public handler: %d", code)
	}
	if code, _ := call(t, pub, "GET", "/api/public/v1/menu", "", nil); code != 200 {
		t.Fatalf("public menu: %d", code)
	}
	if code, _ := call(t, pub, "DELETE", "/api/public/v1/menu", "", nil); code != http.StatusMethodNotAllowed {
		t.Fatalf("delete: %d", code)
	}
}
