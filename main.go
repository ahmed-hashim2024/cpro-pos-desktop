// Command cpro is the restaurant POS desktop app. main only wires things
// together; all behaviour lives under internal/.
package main

import (
	"context"
	"embed"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"time"

	"cpro/internal/app"
	"cpro/internal/license"
	"cpro/internal/platform/logging"
	"cpro/internal/platform/paths"
	"cpro/internal/saas"
	"cpro/internal/store/sqlite"
	"cpro/internal/transport/httpapi"
	"cpro/internal/transport/native"
	"cpro/internal/tunnel"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
)

//go:embed all:frontend/dist
var assets embed.FS

// publicAddr is where Cloudflare delivers the restaurant's domain
// (saas integrations/cloudflare.py DESKTOP_TUNNEL_ORIGIN). Loopback only.
const publicAddr = "127.0.0.1:8788"

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "cpro:", err)
		os.Exit(1)
	}
}

func run() error {
	p, err := paths.Resolve()
	if err != nil {
		return fmt.Errorf("data dir: %w", err)
	}
	log, closeLog, err := logging.New(p.Logs)
	if err != nil {
		return err
	}
	defer closeLog()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	db, err := sqlite.Open(ctx, p.DB)
	if err != nil {
		log.Error("open database", "err", err)
		return err
	}
	defer db.Close()

	a := app.New(db, p, log)
	if _, err := a.EnsureTerminal(ctx); err != nil {
		return err
	}
	go backupLoop(ctx, a)

	dist, err := fs.Sub(assets, "frontend/dist")
	if err != nil {
		return err
	}

	// Platform link: license, domain and e-menu settings.
	id, err := saas.LoadIdentity(filepath.Join(p.Data, "device.json"))
	if err != nil {
		return err
	}
	if license.Key() != "" {
		if err := a.EnablePlatform(ctx, saas.NewClient(id)); err != nil {
			return err
		}
	} else {
		// Development build (wails dev). Release builds always embed the
		// key: scripts/build.sh refuses to build without it.
		log.Warn("no license key built in: licensing is OFF (development build)")
	}
	tun := tunnel.New(p.Data, log)
	a.SetTunnelStatusFunc(func() app.TunnelStatus {
		st := tun.Status()
		return app.TunnelStatus{State: st.State, Error: st.Error}
	})
	applyTunnel := func() {
		// Read the config inside the goroutine: Apply calls are serialised,
		// so the last one always runs the latest config.
		go func() {
			token, _ := a.TunnelConfig()
			tun.Apply(ctx, token)
		}()
	}
	a.OnPlatformChange(applyTunnel)
	applyTunnel()
	go a.RunPlatformSync(ctx)
	go func() {
		// The guest e-menu, reached through the tunnel.
		if err := httpapi.Listen(ctx, publicAddr, httpapi.NewPublic(a, log, dist), log); err != nil {
			log.Error("public server", "err", err)
		}
	}()
	settings, err := a.Settings(ctx, app.Actor{})
	if err != nil {
		return err
	}
	if settings.LANEnabled {
		// Tablets, kitchen screens and the customer display on the same network.
		lan := httpapi.New(a, app.ChannelLAN, log, dist)
		go func() {
			if err := httpapi.Listen(ctx, fmt.Sprintf(":%d", settings.LANPort), lan, log); err != nil {
				log.Error("lan server", "err", err)
			}
		}()
	}

	title := "CPro POS"
	if settings.RestaurantName != "" {
		title = settings.RestaurantName + " — CPro POS"
	}
	nat := native.New()
	return wails.Run(&options.App{
		Title:     title,
		Width:     1366,
		Height:    820,
		MinWidth:  1024,
		MinHeight: 700,
		AssetServer: &assetserver.Options{
			Assets:  assets,
			Handler: httpapi.New(a, app.ChannelApp, log, nil),
		},
		BackgroundColour: &options.RGBA{R: 245, G: 246, B: 251, A: 1},
		OnStartup:        native.OnStartup(nat),
		Bind:             []any{nat},
		OnShutdown: func(context.Context) {
			cancel()
			tun.Stop()
			if _, err := a.BackupNow(context.Background(), app.Actor{}, "exit"); err != nil {
				log.Error("exit backup", "err", err)
			}
		},
	})
}

// backupLoop takes the automatic backup at start-up and then hourly checks
// whether the configured interval has passed.
func backupLoop(ctx context.Context, a *app.App) {
	a.AutoBackup(ctx)
	t := time.NewTicker(time.Hour)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			a.AutoBackup(ctx)
		}
	}
}
