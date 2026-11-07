// Command devserver runs the POS API and web UI in a normal browser for
// development and automated UI tests, without the desktop window. It binds
// to localhost only and uses the "app" channel, exactly like the window.
//
//	go run ./cmd/devserver -addr 127.0.0.1:8787 -ui frontend/dist
//	cd frontend && CPRO_API=http://127.0.0.1:8787 npm run dev   # Vite proxies /api to it
//
// With -fake-saas, an in-process fake Platform accepts the activation code
// ACT-DEMO, and -public serves the guest e-menu like the tunnel listener.
package main

import (
	"context"
	"flag"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"

	"cpro/internal/app"
	"cpro/internal/domain/rbac"
	"cpro/internal/license"
	"cpro/internal/platform/logging"
	"cpro/internal/platform/paths"
	"cpro/internal/saas"
	"cpro/internal/saas/saastest"
	"cpro/internal/store/sqlite"
	"cpro/internal/transport/httpapi"
)

func main() {
	addr := flag.String("addr", "127.0.0.1:8787", "listen address (must be loopback)")
	ui := flag.String("ui", "frontend/dist", "built web UI directory")
	fake := flag.Bool("fake-saas", false, "link to an in-process fake Platform (activation code ACT-DEMO)")
	public := flag.String("public", "", "also serve the guest e-menu on this loopback address, e.g. 127.0.0.1:8788")
	remote := flag.String("remote", "", "also serve the staff system as remote access (tunnel channel) on this loopback address, e.g. 127.0.0.1:8789")
	flag.Parse()
	if err := run(*addr, *ui, *fake, *public, *remote); err != nil {
		fmt.Fprintln(os.Stderr, "devserver:", err)
		os.Exit(1)
	}
}

func loopback(addr string) error {
	host, _, err := net.SplitHostPort(addr)
	if err != nil {
		return err
	}
	if ip := net.ParseIP(host); host != "localhost" && (ip == nil || !ip.IsLoopback()) {
		return fmt.Errorf("refusing to listen on %s: devserver is localhost-only", addr)
	}
	return nil
}

func run(addr, ui string, fake bool, public, remote string) error {
	if err := loopback(addr); err != nil {
		return err
	}
	for _, extra := range []string{public, remote} {
		if extra == "" {
			continue
		}
		if err := loopback(extra); err != nil {
			return err
		}
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()

	p, err := paths.Resolve()
	if err != nil {
		return err
	}
	log, closeLog, err := logging.New(p.Logs)
	if err != nil {
		return err
	}
	defer closeLog()
	if err := sqlite.ApplyPending(p.DB, p.PendingRestore()); err != nil {
		return err
	}
	db, err := sqlite.Open(ctx, p.DB)
	if err != nil {
		return err
	}
	defer db.Close()
	a := app.New(db, p, log)
	a.SetRelaunch(stop) // run the devserver again by hand: it applies the restore on start
	if _, err := a.EnsureTerminal(ctx); err != nil {
		return err
	}
	static := os.DirFS(ui)

	if fake {
		f := saastest.NewHandler("ACT-DEMO")
		f.Update("ACT-DEMO", func(t *saastest.Tenant) { t.Remote = remote != "" })
		ln, err := net.Listen("tcp", "127.0.0.1:0")
		if err != nil {
			return err
		}
		f.URL = "http://" + ln.Addr().String()
		go http.Serve(ln, f.Handler())
		license.PublicKey = f.Public // dev tool only; release builds embed the real key
		id, err := saas.LoadIdentity(filepath.Join(p.Data, "device.json"))
		if err != nil {
			return err
		}
		if err := a.EnablePlatform(ctx, saas.NewClient(id, f.Public)); err != nil {
			return err
		}
		admin := app.Actor{Role: rbac.Owner}
		if err := a.SetPlatformURL(ctx, admin, "http://"+ln.Addr().String()); err != nil {
			return err
		}
		go a.RunPlatformSync(ctx)
		log.Info("fake platform", "url", "http://"+ln.Addr().String(), "code", "ACT-DEMO")
	}
	if public != "" {
		go func() {
			if err := httpapi.Listen(ctx, public, httpapi.NewPublic(a, log, static), log); err != nil {
				log.Error("public server", "err", err)
			}
		}()
	}
	if remote != "" {
		go func() {
			if err := httpapi.Listen(ctx, remote, httpapi.New(a, app.ChannelTunnel, log, static), log); err != nil {
				log.Error("remote server", "err", err)
			}
		}()
	}
	log.Info("devserver", "data", p.Data, "addr", addr, "public", public, "remote", remote)
	return httpapi.Listen(ctx, addr, httpapi.New(a, app.ChannelApp, log, static), log)
}
