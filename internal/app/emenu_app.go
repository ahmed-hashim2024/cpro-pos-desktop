package app

import (
	"bytes"
	"context"
	"encoding/json"
	"image/png"
	"unicode/utf8"
)

// The e-menu as an installable app (PWA). The guest page links
// /manifest.webmanifest; it exists only while the menu is open, the owner
// keeps the install offer on and has uploaded an app icon, so browsers
// offer installing exactly then.

func (s EMenuSettings) installable() bool {
	return bool(s.InstallPrompt) && s.AppIcon512 != "" && s.AppIcon192 != ""
}

// applyAppIcon stores a new icon (both sizes) or removes it ("-").
func (a *App) applyAppIcon(s *EMenuSettings, data512, data192 string) error {
	switch {
	case data512 == "" && data192 == "":
		return nil
	case data512 == "-":
		s.AppIcon512, s.AppIcon192 = "", ""
		return nil
	case data512 == "" || data192 == "":
		return invalid("أيقونة التطبيق ناقصة، اختارها تاني")
	}
	big, err := pngIcon(data512, 512)
	if err != nil {
		return err
	}
	small, err := pngIcon(data192, 192)
	if err != nil {
		return err
	}
	if s.AppIcon512, err = a.writeImage("image/png", big); err != nil {
		return err
	}
	s.AppIcon192, err = a.writeImage("image/png", small)
	return err
}

// pngIcon checks an icon is a real PNG of exactly size×size pixels.
func pngIcon(dataURL string, size int) ([]byte, error) {
	mime, b, err := decodeImage(dataURL)
	if err != nil {
		return nil, err
	}
	if mime != "image/png" {
		return nil, invalid("أيقونة التطبيق لازم تكون PNG")
	}
	cfg, err := png.DecodeConfig(bytes.NewReader(b))
	if err != nil || cfg.Width != size || cfg.Height != size {
		return nil, invalid("مقاس أيقونة التطبيق غير صحيح")
	}
	return b, nil
}

// AppManifest is the web app manifest for the restaurant's domain.
func (a *App) AppManifest(ctx context.Context) ([]byte, error) {
	if !a.menuOpen() {
		return nil, errMenuClosed
	}
	cfg := a.emenuConfig()
	if !cfg.installable() {
		return nil, errMenuClosed
	}
	s, err := loadSettings(ctx, a.db.Read)
	if err != nil {
		return nil, err
	}
	name := cfg.DisplayName
	if name == "" {
		name = s.RestaurantName
	}
	short := name
	if utf8.RuneCountInString(short) > 12 {
		short = string([]rune(short)[:12])
	}
	bg, _ := presetHex(backgrounds, cfg.Background)
	lang := cfg.DefaultLanguage
	dir := "ltr"
	if lang == "ar" {
		dir = "rtl"
	}
	const img = "/api/public/v1/images/"
	return json.Marshal(map[string]any{
		"id": "/", "name": name, "short_name": short, "lang": lang, "dir": dir,
		"start_url": "/", "scope": "/", "display": "standalone", "orientation": "portrait",
		"background_color": bg, "theme_color": bg,
		"icons": []map[string]string{
			{"src": img + cfg.AppIcon192, "sizes": "192x192", "type": "image/png", "purpose": "any"},
			{"src": img + cfg.AppIcon512, "sizes": "512x512", "type": "image/png", "purpose": "any"},
		},
	})
}

// AppleTouchIcon is the icon file iOS uses for "Add to Home Screen".
func (a *App) AppleTouchIcon() (string, bool) {
	cfg := a.emenuConfig()
	if !a.menuOpen() || !cfg.installable() {
		return "", false
	}
	return a.ImagePath(cfg.AppIcon192)
}

// ServiceWorker makes the menu installable. It never caches: prices and
// availability always come live from this computer. Offline, page loads get
// a short message instead of the browser's error page.
const ServiceWorker = `self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  if (e.request.mode !== 'navigate') return;
  e.respondWith(fetch(e.request).catch(() => new Response(
    '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<body style="font-family:system-ui;display:grid;place-items:center;min-height:90vh;text-align:center;padding:24px">' +
    '<div><h1 style="font-size:20px">مفيش اتصال بالإنترنت</h1><p>اتأكد من الاتصال وحاول تاني.<br>No internet connection.</p></div>',
    { headers: { 'Content-Type': 'text/html; charset=utf-8' } })));
});
`
