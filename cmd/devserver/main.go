// Command devserver runs the POS API and web UI in a normal browser for
// development and automated UI tests, without the desktop window. It binds
// to localhost only and uses the "app" channel, exactly like the window.
//
//	go run ./cmd/devserver -addr 127.0.0.1:8787 -ui frontend/dist
//	cd frontend && CPRO_API=http://127.0.0.1:8787 npm run dev   # Vite proxies /api to it
package main

import (
	"context"
	"flag"
	"fmt"
	"net"
	"os"
	"os/signal"

	"cpro/internal/app"
	"cpro/internal/platform/logging"
	"cpro/internal/platform/paths"
	"cpro/internal/store/sqlite"
	"cpro/internal/transport/httpapi"
)

func main() {
	addr := flag.String("addr", "127.0.0.1:8787", "listen address (must be loopback)")
	ui := flag.String("ui", "frontend/dist", "built web UI directory")
	flag.Parse()
	if err := run(*addr, *ui); err != nil {
		fmt.Fprintln(os.Stderr, "devserver:", err)
		os.Exit(1)
	}
}

func run(addr, ui string) error {
	host, _, err := net.SplitHostPort(addr)
	if err != nil {
		return err
	}
	if ip := net.ParseIP(host); host != "localhost" && (ip == nil || !ip.IsLoopback()) {
		return fmt.Errorf("refusing to listen on %s: devserver is localhost-only", addr)
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
	db, err := sqlite.Open(ctx, p.DB)
	if err != nil {
		return err
	}
	defer db.Close()
	a := app.New(db, p, log)
	if _, err := a.EnsureTerminal(ctx); err != nil {
		return err
	}
	log.Info("devserver", "data", p.Data, "addr", addr)
	return httpapi.Listen(ctx, addr, httpapi.New(a, app.ChannelApp, log, os.DirFS(ui)), log)
}
