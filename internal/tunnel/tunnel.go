// Package tunnel runs cloudflared so the restaurant's domain reaches this
// computer. Cloudflare routes the domain to 127.0.0.1:<public port>, where
// only the public e-menu is served.
//
// cloudflared is downloaded once (pinned version, verified by SHA-256) into
// the data dir and supervised: restarted with backoff if it exits, stopped
// when the account no longer has a tunnel.
package tunnel

import (
	"archive/tar"
	"bufio"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"
)

const Version = "2026.9.3"

type asset struct {
	file, sha256 string
	tgz          bool
}

// Digests from the GitHub release of cloudflared 2026.9.3.
var assets = map[string]asset{
	"windows/amd64": {"cloudflared-windows-amd64.exe", "f096265ec2fcbe9bb6e2d64268db167ced3fcbb83d894bdb9e2fcdb26f2ea7e2", false},
	"windows/386":   {"cloudflared-windows-386.exe", "9b95ddc2eba67b86ed3dc4cc2a15881960563031b52ce564376af41fb91ad402", false},
	"darwin/arm64":  {"cloudflared-darwin-arm64.tgz", "587c2cfb1c230fe36c7fa7727da78be459dae028cabe8c001291999350f07095", true},
	"darwin/amd64":  {"cloudflared-darwin-amd64.tgz", "d1155d0837487f261183b15c1eab6c4ebcad9dc49b94675f1524c3564cea3977", true},
	"linux/amd64":   {"cloudflared-linux-amd64", "77e26d8d900e0b8469f416239d14b5f296525fdf79fee6f511ef55609e3fbac2", false},
	"linux/arm64":   {"cloudflared-linux-arm64", "aaeb2d7d0da3614634c7e03ab13487a1522c2e79165ed2929cfe23d5e95b326d", false},
}

const releaseURL = "https://github.com/cloudflare/cloudflared/releases/download/" + Version + "/"

// Status values.
const (
	Off       = "off"
	Starting  = "starting"
	Connected = "connected"
	Failed    = "error"
)

type Status struct {
	State string
	Error string
}

type Supervisor struct {
	dir string // where the binary lives
	log *slog.Logger

	applyMu sync.Mutex // one Apply at a time
	mu      sync.Mutex
	token   string
	cancel  context.CancelFunc
	done    chan struct{}
	status  Status
	binPath string
}

func New(dataDir string, log *slog.Logger) *Supervisor {
	return &Supervisor{dir: filepath.Join(dataDir, "bin"), log: log, status: Status{State: Off}}
}

func (s *Supervisor) Status() Status {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.status
}

func (s *Supervisor) set(st Status) {
	s.mu.Lock()
	s.status = st
	s.mu.Unlock()
}

// Apply runs cloudflared with token, restarting it if the token changed;
// an empty token stops it.
func (s *Supervisor) Apply(ctx context.Context, token string) {
	s.applyMu.Lock()
	defer s.applyMu.Unlock()
	s.mu.Lock()
	if token == s.token {
		s.mu.Unlock()
		return
	}
	cancel, done := s.cancel, s.done
	s.token, s.cancel, s.done = token, nil, nil
	s.mu.Unlock()
	if cancel != nil {
		cancel()
		<-done
	}
	if token == "" {
		s.set(Status{State: Off})
		return
	}
	rctx, rcancel := context.WithCancel(ctx)
	d := make(chan struct{})
	s.mu.Lock()
	s.cancel, s.done = rcancel, d
	s.mu.Unlock()
	go func() {
		defer close(d)
		s.run(rctx, token)
	}()
}

// Stop ends cloudflared (app exit).
func (s *Supervisor) Stop() { s.Apply(context.Background(), "") }

func (s *Supervisor) run(ctx context.Context, token string) {
	backoff := 2 * time.Second
	for ctx.Err() == nil {
		s.set(Status{State: Starting})
		bin, err := s.binary(ctx)
		if err == nil {
			started := time.Now()
			err = s.once(ctx, bin, token)
			if time.Since(started) > time.Minute {
				backoff = 2 * time.Second // it ran fine for a while
			}
		}
		if ctx.Err() != nil {
			break
		}
		msg := "stopped"
		if err != nil {
			msg = err.Error()
		}
		s.log.Warn("tunnel stopped; retrying", "err", msg, "in", backoff)
		s.set(Status{State: Failed, Error: msg})
		select {
		case <-ctx.Done():
		case <-time.After(backoff):
		}
		backoff = min(backoff*2, 5*time.Minute)
	}
	s.set(Status{State: Off})
}

func (s *Supervisor) once(ctx context.Context, bin, token string) error {
	cmd := exec.CommandContext(ctx, bin, "tunnel", "--no-autoupdate", "--protocol", "auto", "run")
	// The token goes through the environment, not argv (visible to other
	// users in the process list).
	cmd.Env = append(os.Environ(), "TUNNEL_TOKEN="+token)
	cmd.Cancel = func() error { return cmd.Process.Kill() }
	hideWindow(cmd)
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return err
	}
	cmd.Stdout = io.Discard
	if err := cmd.Start(); err != nil {
		return err
	}
	var lastErr string
	sc := bufio.NewScanner(stderr)
	for sc.Scan() {
		line := sc.Text()
		switch {
		case strings.Contains(line, "Registered tunnel connection"):
			s.set(Status{State: Connected})
			s.log.Info("tunnel connected")
		case strings.Contains(line, " ERR "):
			lastErr = line
			if i := strings.Index(line, " ERR "); i >= 0 {
				lastErr = strings.TrimSpace(line[i+5:])
			}
			s.log.Warn("cloudflared", "line", line)
		}
	}
	err = cmd.Wait()
	if err != nil && lastErr != "" {
		return errors.New(lastErr)
	}
	return err
}

// binary returns a verified cloudflared, downloading it on first use.
func (s *Supervisor) binary(ctx context.Context) (string, error) {
	s.mu.Lock()
	cached := s.binPath
	s.mu.Unlock()
	if cached != "" {
		return cached, nil
	}
	a, ok := assets[runtime.GOOS+"/"+runtime.GOARCH]
	if !ok {
		if p, err := exec.LookPath("cloudflared"); err == nil {
			return p, nil
		}
		return "", fmt.Errorf("no cloudflared build for %s/%s", runtime.GOOS, runtime.GOARCH)
	}
	name := "cloudflared-" + Version
	if runtime.GOOS == "windows" {
		name += ".exe"
	}
	path := filepath.Join(s.dir, name)
	if _, err := os.Stat(path); err != nil {
		if err := s.download(ctx, a, path); err != nil {
			return "", fmt.Errorf("download cloudflared: %w", err)
		}
	}
	s.mu.Lock()
	s.binPath = path
	s.mu.Unlock()
	return path, nil
}

func (s *Supervisor) download(ctx context.Context, a asset, dest string) error {
	if err := os.MkdirAll(s.dir, 0o700); err != nil {
		return err
	}
	s.log.Info("downloading cloudflared", "version", Version, "file", a.file)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, releaseURL+a.file, nil)
	if err != nil {
		return err
	}
	resp, err := (&http.Client{Timeout: 10 * time.Minute}).Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 200<<20))
	if err != nil {
		return err
	}
	if err := verify(raw, a.sha256); err != nil {
		return err
	}
	bin := raw
	if a.tgz {
		if bin, err = untarFile(raw, "cloudflared"); err != nil {
			return err
		}
	}
	tmp := dest + ".tmp"
	if err := os.WriteFile(tmp, bin, 0o700); err != nil {
		return err
	}
	return os.Rename(tmp, dest)
}

func verify(b []byte, want string) error {
	sum := sha256.Sum256(b)
	if got := hex.EncodeToString(sum[:]); got != want {
		return fmt.Errorf("checksum mismatch: got %s", got)
	}
	return nil
}

func untarFile(tgz []byte, name string) ([]byte, error) {
	zr, err := gzip.NewReader(strings.NewReader(string(tgz)))
	if err != nil {
		return nil, err
	}
	tr := tar.NewReader(zr)
	for {
		h, err := tr.Next()
		if err == io.EOF {
			return nil, fmt.Errorf("%s not found in archive", name)
		}
		if err != nil {
			return nil, err
		}
		if filepath.Base(h.Name) == name && h.Typeflag == tar.TypeReg {
			return io.ReadAll(io.LimitReader(tr, 200<<20))
		}
	}
}
