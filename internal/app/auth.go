package app

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"sync"
	"time"

	"cpro/internal/auth"
	"cpro/internal/domain/rbac"
	"cpro/internal/store/sqlite"
)

const terminalKey = "terminal_device_id"

// EnsureTerminal makes sure this machine has its own device row (used for
// shifts and invoice numbering) and returns its id.
func (a *App) EnsureTerminal(ctx context.Context) (string, error) {
	var id string
	err := a.db.Write.QueryRowContext(ctx, `SELECT value FROM settings WHERE key = ?`, terminalKey).Scan(&id)
	if err == nil {
		return id, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return "", err
	}
	id = sqlite.NewID()
	err = a.tx(ctx, func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx, `INSERT INTO devices(id, name, kind, paired_at) VALUES (?, 'الكاشير الرئيسي', 'terminal', ?)`, id, a.stamp()); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO invoice_counters(device_id, prefix) VALUES (?, 'A')`, id); err != nil {
			return err
		}
		_, err := tx.ExecContext(ctx, `INSERT INTO settings(key, value, updated_at) VALUES (?,?,?)`, terminalKey, id, a.stamp())
		return err
	})
	return id, err
}

// NeedsSetup is true until the first owner account exists.
func (a *App) NeedsSetup(ctx context.Context) (bool, error) {
	var n int
	err := a.db.Read.QueryRowContext(ctx, `SELECT count(*) FROM users`).Scan(&n)
	return n == 0, err
}

type SetupInput struct {
	RestaurantName string `json:"restaurant_name"`
	OwnerName      string `json:"owner_name"`
	Username       string `json:"username"`
	Password       string `json:"password"`
	PIN            string `json:"pin"`
}

// Setup creates the owner on first run. It only works while there are no users.
func (a *App) Setup(ctx context.Context, in SetupInput, ch Channel) (Session, error) {
	if ch != ChannelApp {
		return Session{}, errForbidden
	}
	// A licensed build can't be set up offline or without an account: the
	// owner signs up on the Platform and links this computer first.
	if a.platform != nil && !a.SetupPlatformInfo().Linked {
		return Session{}, errNotLinked
	}
	if strings.TrimSpace(in.RestaurantName) == "" {
		return Session{}, invalid("اسم المطعم مطلوب")
	}
	var userID string
	err := a.tx(ctx, func(tx *sql.Tx) error {
		var n int
		if err := tx.QueryRowContext(ctx, `SELECT count(*) FROM users`).Scan(&n); err != nil {
			return err
		}
		if n > 0 {
			return conflict("تم إعداد النظام بالفعل")
		}
		var err error
		userID, err = a.insertUser(ctx, tx, UserInput{
			FullName: in.OwnerName, Username: in.Username, Role: rbac.Owner, Password: in.Password, PIN: in.PIN, Active: true,
		})
		if err != nil {
			return err
		}
		s := defaultSettings()
		s.RestaurantName = strings.TrimSpace(in.RestaurantName)
		if err := a.saveSettings(ctx, tx, s); err != nil {
			return err
		}
		return a.audit(ctx, tx, Actor{UserID: userID, Channel: ch}, "setup", "users", userID, nil)
	})
	if err != nil {
		return Session{}, err
	}
	terminal, err := a.EnsureTerminal(ctx)
	if err != nil {
		return Session{}, err
	}
	return a.startSession(ctx, userID, terminal, ch)
}

// ---- login -----------------------------------------------------------------

type Session struct {
	Token string `json:"token"`
	Me    Me     `json:"me"`
}

type Me struct {
	UserID      string            `json:"user_id"`
	Name        string            `json:"name"`
	Username    string            `json:"username"`
	Role        rbac.Role         `json:"role"`
	Permissions []rbac.Permission `json:"permissions"`
	DeviceID    string            `json:"device_id"`
	Channel     Channel           `json:"channel"`
	MustChange  bool              `json:"must_change_password"`
}

type LoginInput struct {
	Username   string `json:"username"`
	Password   string `json:"password"`
	UserID     string `json:"user_id"` // PIN login: pick the user, then enter PIN
	PIN        string `json:"pin"`
	DeviceID   string `json:"device_id"`   // LAN devices remember their own id
	DeviceName string `json:"device_name"` // e.g. "تابلت الصالة"
	DeviceKind string `json:"device_kind"` // waiter, kds, display, terminal
}

var errBadLogin = &Error{CodeUnauthorized, "اسم المستخدم أو كلمة المرور غير صحيحة"}

func (a *App) Login(ctx context.Context, in LoginInput, ch Channel, remote string) (Session, error) {
	key := strings.ToLower(in.Username + in.UserID)
	if err := throttle.check(key + "|" + remote); err != nil {
		return Session{}, err
	}
	var (
		id, hash, pinHash string
		active            int64
		pin               sql.NullString
	)
	var err error
	if in.PIN != "" {
		if ch == ChannelTunnel {
			return Session{}, errf(CodeForbidden, "الدخول بالرقم السري غير متاح من خارج المطعم")
		}
		err = a.db.Read.QueryRowContext(ctx, `SELECT id, password_hash, pin_hash, active FROM users WHERE id = ?`, in.UserID).
			Scan(&id, &hash, &pin, &active)
		pinHash = pin.String
	} else {
		err = a.db.Read.QueryRowContext(ctx, `SELECT id, password_hash, pin_hash, active FROM users WHERE username = ?`, strings.TrimSpace(in.Username)).
			Scan(&id, &hash, &pin, &active)
	}
	if errors.Is(err, sql.ErrNoRows) {
		auth.VerifyMissing(in.Password + in.PIN)
		throttle.fail(key + "|" + remote)
		return Session{}, errBadLogin
	}
	if err != nil {
		return Session{}, err
	}
	secret, against := in.Password, hash
	if in.PIN != "" {
		secret, against = in.PIN, pinHash
	}
	if auth.Verify(against, secret) != nil || active == 0 {
		throttle.fail(key + "|" + remote)
		_ = a.audit(ctx, a.db.Write, Actor{UserID: id, Channel: ch}, "auth.login_failed", "users", id, map[string]string{"remote": remote})
		return Session{}, errBadLogin
	}
	throttle.reset(key + "|" + remote)

	deviceID, err := a.resolveDevice(ctx, in, ch)
	if err != nil {
		return Session{}, err
	}
	s, err := a.startSession(ctx, id, deviceID, ch)
	if err == nil {
		_ = a.audit(ctx, a.db.Write, Actor{UserID: id, DeviceID: deviceID, Channel: ch}, "auth.login", "users", id, map[string]string{"remote": remote})
	}
	return s, err
}

func (a *App) resolveDevice(ctx context.Context, in LoginInput, ch Channel) (string, error) {
	if ch == ChannelApp {
		return a.EnsureTerminal(ctx)
	}
	kind := in.DeviceKind
	switch kind {
	case "waiter", "kds", "display", "terminal":
	default:
		kind = "waiter"
	}
	if ch == ChannelTunnel {
		kind = "remote"
	}
	id := strings.TrimSpace(in.DeviceID)
	if len(id) != 26 { // client-generated ULID
		id = sqlite.NewID()
	}
	name := strings.TrimSpace(in.DeviceName)
	if name == "" {
		name = "جهاز " + id[len(id)-4:]
	}
	var revoked sql.NullString
	err := a.db.Write.QueryRowContext(ctx, `SELECT revoked_at FROM devices WHERE id = ?`, id).Scan(&revoked)
	switch {
	case errors.Is(err, sql.ErrNoRows):
		err = a.tx(ctx, func(tx *sql.Tx) error {
			if _, err := tx.ExecContext(ctx, `INSERT INTO devices(id, name, kind, paired_at, last_seen) VALUES (?,?,?,?,?)`, id, name, kind, a.stamp(), a.stamp()); err != nil {
				return err
			}
			_, err := tx.ExecContext(ctx, `INSERT INTO invoice_counters(device_id, prefix) VALUES (?, ?)`, id, "D"+id[len(id)-3:])
			return err
		})
		return id, err
	case err != nil:
		return "", err
	case revoked.Valid:
		return "", errf(CodeForbidden, "تم إيقاف هذا الجهاز")
	}
	_, err = a.db.Write.ExecContext(ctx, `UPDATE devices SET last_seen = ?, name = ? WHERE id = ?`, a.stamp(), name, id)
	return id, err
}

var sessionTTL = map[Channel]time.Duration{
	ChannelApp:    30 * 24 * time.Hour,
	ChannelLAN:    16 * time.Hour,
	ChannelTunnel: 8 * time.Hour,
}

func (a *App) startSession(ctx context.Context, userID, deviceID string, ch Channel) (Session, error) {
	token, hash, err := auth.NewToken()
	if err != nil {
		return Session{}, err
	}
	now := a.now()
	_, err = a.db.Write.ExecContext(ctx,
		`INSERT INTO sessions(token_hash, user_id, device_id, channel, created_at, last_seen_at, expires_at) VALUES (?,?,?,?,?,?,?)`,
		hash, userID, sqlite.NullString(deviceID), string(ch), sqlite.FormatTime(now), sqlite.FormatTime(now), sqlite.FormatTime(now.Add(sessionTTL[ch])))
	if err != nil {
		return Session{}, err
	}
	_, me, err := a.lookupSession(ctx, hash, ch)
	return Session{Token: token, Me: me}, err
}

// Authenticate resolves a bearer token. A token only works on the channel it
// was issued for, so a LAN token can't be replayed through the tunnel.
func (a *App) Authenticate(ctx context.Context, token string, ch Channel) (Actor, Me, error) {
	if token == "" {
		return Actor{}, Me{}, &Error{CodeUnauthorized, "يجب تسجيل الدخول"}
	}
	return a.lookupSession(ctx, auth.HashToken(token), ch)
}

func (a *App) lookupSession(ctx context.Context, hash string, ch Channel) (Actor, Me, error) {
	var (
		me                     Me
		device                 sql.NullString
		channel, expires, seen string
		revoked                sql.NullString
		active, mustChange     int64
	)
	err := a.db.Write.QueryRowContext(ctx,
		`SELECT s.user_id, s.device_id, s.channel, s.expires_at, s.last_seen_at, s.revoked_at,
		        u.full_name, u.username, u.role, u.active, u.must_change_password
		   FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`, hash).
		Scan(&me.UserID, &device, &channel, &expires, &seen, &revoked, &me.Name, &me.Username, &me.Role, &active, &mustChange)
	unauth := &Error{CodeUnauthorized, "انتهت الجلسة، سجّل الدخول مرة أخرى"}
	if errors.Is(err, sql.ErrNoRows) {
		return Actor{}, Me{}, unauth
	}
	if err != nil {
		return Actor{}, Me{}, err
	}
	now := a.now()
	if revoked.Valid || active == 0 || Channel(channel) != ch || now.After(sqlite.ParseTime(expires)) {
		return Actor{}, Me{}, unauth
	}
	if now.Sub(sqlite.ParseTime(seen)) > time.Minute {
		a.db.Write.ExecContext(ctx, `UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?`, sqlite.FormatTime(now), hash)
	}
	me.DeviceID, me.Channel, me.MustChange = device.String, ch, mustChange == 1
	me.Permissions = me.Role.Permissions()
	return Actor{UserID: me.UserID, Name: me.Name, Role: me.Role, DeviceID: me.DeviceID, Channel: ch}, me, nil
}

func (a *App) Logout(ctx context.Context, token string) error {
	_, err := a.db.Write.ExecContext(ctx, `UPDATE sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL`, a.stamp(), auth.HashToken(token))
	return err
}

// LoginUsers lists who can sign in with a PIN on this screen. Not offered
// over the tunnel.
type LoginUser struct {
	ID   string    `json:"id"`
	Name string    `json:"name"`
	Role rbac.Role `json:"role"`
}

func (a *App) LoginUsers(ctx context.Context, ch Channel) ([]LoginUser, error) {
	if ch == ChannelTunnel {
		return []LoginUser{}, nil
	}
	rows, err := a.db.Read.QueryContext(ctx, `SELECT id, full_name, role FROM users WHERE active = 1 AND pin_hash IS NOT NULL ORDER BY full_name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []LoginUser{}
	for rows.Next() {
		var u LoginUser
		if err := rows.Scan(&u.ID, &u.Name, &u.Role); err != nil {
			return nil, err
		}
		out = append(out, u)
	}
	return out, rows.Err()
}

// approver returns a user whose PIN matches and who holds perm. It lets a
// manager authorise a cashier's void or discount on the spot.
func (a *App) approver(ctx context.Context, actor Actor, perm rbac.Permission, pin string) (Actor, error) {
	if actor.Can(perm) {
		return actor, nil
	}
	if pin == "" {
		return Actor{}, &Error{CodeForbidden, "يتطلب هذا الإجراء موافقة المدير (الرقم السري)"}
	}
	key := "approve|" + actor.UserID
	if err := throttle.check(key); err != nil {
		return Actor{}, err
	}
	rows, err := a.db.Read.QueryContext(ctx, `SELECT id, full_name, role, pin_hash FROM users WHERE active = 1 AND pin_hash IS NOT NULL AND role IN ('owner','manager')`)
	if err != nil {
		return Actor{}, err
	}
	defer rows.Close()
	for rows.Next() {
		var u Actor
		var h string
		if err := rows.Scan(&u.UserID, &u.Name, &u.Role, &h); err != nil {
			return Actor{}, err
		}
		if u.Can(perm) && auth.Verify(h, pin) == nil {
			throttle.reset(key)
			u.DeviceID, u.Channel = actor.DeviceID, actor.Channel
			return u, nil
		}
	}
	throttle.fail(key)
	return Actor{}, &Error{CodeForbidden, "الرقم السري للمدير غير صحيح"}
}

// ---- throttling ------------------------------------------------------------

// throttle locks a key for 5 minutes after 5 failures in a row.
var throttle = &limiter{fails: map[string]*failState{}}

type failState struct {
	n     int
	until time.Time
}

type limiter struct {
	mu    sync.Mutex
	fails map[string]*failState
}

func (l *limiter) check(key string) error {
	l.mu.Lock()
	defer l.mu.Unlock()
	if f := l.fails[key]; f != nil && time.Now().Before(f.until) {
		return &Error{CodeForbidden, "محاولات كثيرة خاطئة، حاول بعد 5 دقائق"}
	}
	return nil
}

func (l *limiter) fail(key string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	f := l.fails[key]
	if f == nil {
		f = &failState{}
		l.fails[key] = f
	}
	f.n++
	if f.n >= 5 {
		f.n, f.until = 0, time.Now().Add(5*time.Minute)
	}
}

func (l *limiter) reset(key string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	delete(l.fails, key)
}
