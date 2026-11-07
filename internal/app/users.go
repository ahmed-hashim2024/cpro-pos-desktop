package app

import (
	"context"
	"database/sql"
	"errors"
	"strings"

	"cpro/internal/auth"
	"cpro/internal/domain/rbac"
	"cpro/internal/store/sqlite"
)

type User struct {
	ID         string    `json:"id"`
	Username   string    `json:"username"`
	FullName   string    `json:"full_name"`
	Role       rbac.Role `json:"role"`
	Active     bool      `json:"active"`
	HasPIN     bool      `json:"has_pin"`
	MustChange bool      `json:"must_change_password"`
	Remote     bool      `json:"remote_access"` // may sign in over the internet
	CreatedAt  string    `json:"created_at"`
}

type UserInput struct {
	FullName string    `json:"full_name"`
	Username string    `json:"username"`
	Role     rbac.Role `json:"role"`
	Password string    `json:"password"` // empty on update = keep
	PIN      string    `json:"pin"`      // empty on update = keep
	Active   bool      `json:"active"`
	// Remote lets the user sign in from outside the restaurant. Only the
	// owner sets it; nil keeps what's there.
	Remote *bool `json:"remote_access"`
}

// remoteChange checks who may set remote access: only the owner, since it
// opens the system to the internet for that account.
func remoteChange(actor Actor, want *bool, have bool) error {
	if want != nil && *want != have && actor.Role != rbac.Owner {
		return errf(CodeForbidden, "المالك وحده يملك الإذن بالدخول عن بُعد")
	}
	return nil
}

func mapAuthErr(err error) error {
	switch {
	case errors.Is(err, auth.ErrWeakPassword):
		return invalid("كلمة المرور يجب ألا تقل عن 8 أحرف وتحتوي على حرف ورقم")
	case errors.Is(err, auth.ErrBadPIN):
		return invalid("الرقم السري يجب أن يكون من 4 إلى 6 أرقام")
	}
	return err
}

func (a *App) insertUser(ctx context.Context, q sqlite.Querier, in UserInput) (string, error) {
	in.FullName, in.Username = strings.TrimSpace(in.FullName), strings.TrimSpace(in.Username)
	if in.FullName == "" || in.Username == "" {
		return "", invalid("الاسم واسم المستخدم مطلوبان")
	}
	if !rbac.ValidRole(in.Role) {
		return "", invalid("الدور غير صحيح")
	}
	hash, err := auth.HashPassword(in.Password)
	if err != nil {
		return "", mapAuthErr(err)
	}
	var pin sql.NullString
	if in.PIN != "" {
		h, err := auth.HashPIN(in.PIN)
		if err != nil {
			return "", mapAuthErr(err)
		}
		pin = sql.NullString{String: h, Valid: true}
	}
	id := sqlite.NewID()
	_, err = q.ExecContext(ctx,
		`INSERT INTO users(id, username, full_name, password_hash, pin_hash, role, active, remote_access, created_at, updated_at)
		 VALUES (?,?,?,?,?,?,?,?,?,?)`,
		id, in.Username, in.FullName, hash, pin, string(in.Role), sqlite.Int(in.Active), sqlite.Int(in.Remote != nil && *in.Remote), a.stamp(), a.stamp())
	if err != nil && strings.Contains(err.Error(), "UNIQUE") {
		return "", conflict("اسم المستخدم مستخدم بالفعل")
	}
	return id, err
}

func (a *App) Users(ctx context.Context, actor Actor) ([]User, error) {
	if err := actor.require(rbac.UsersManage); err != nil {
		return nil, err
	}
	rows, err := a.db.Read.QueryContext(ctx,
		`SELECT id, username, full_name, role, active, pin_hash IS NOT NULL, must_change_password, remote_access, created_at FROM users ORDER BY active DESC, full_name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []User{}
	for rows.Next() {
		var u User
		var active, pin, must, remote int64
		if err := rows.Scan(&u.ID, &u.Username, &u.FullName, &u.Role, &active, &pin, &must, &remote, &u.CreatedAt); err != nil {
			return nil, err
		}
		u.Active, u.HasPIN, u.MustChange, u.Remote = active == 1, pin == 1, must == 1, remote == 1
		out = append(out, u)
	}
	return out, rows.Err()
}

func (a *App) CreateUser(ctx context.Context, actor Actor, in UserInput) (string, error) {
	if err := actor.require(rbac.UsersManage); err != nil {
		return "", err
	}
	if in.Role == rbac.Owner && actor.Role != rbac.Owner {
		return "", errForbidden
	}
	if err := remoteChange(actor, in.Remote, false); err != nil {
		return "", err
	}
	var id string
	err := a.tx(ctx, func(tx *sql.Tx) error {
		var err error
		if id, err = a.insertUser(ctx, tx, in); err != nil {
			return err
		}
		return a.audit(ctx, tx, actor, "user.create", "users", id, map[string]any{"username": in.Username, "role": in.Role, "remote_access": in.Remote != nil && *in.Remote})
	})
	return id, err
}

func (a *App) UpdateUser(ctx context.Context, actor Actor, id string, in UserInput) error {
	if err := actor.require(rbac.UsersManage); err != nil {
		return err
	}
	if !rbac.ValidRole(in.Role) || strings.TrimSpace(in.FullName) == "" {
		return invalid("الاسم والدور مطلوبان")
	}
	return a.tx(ctx, func(tx *sql.Tx) error {
		var cur rbac.Role
		var remote int64
		if err := tx.QueryRowContext(ctx, `SELECT role, remote_access FROM users WHERE id = ?`, id).Scan(&cur, &remote); err != nil {
			return noRows(err, "المستخدم")
		}
		if err := remoteChange(actor, in.Remote, remote == 1); err != nil {
			return err
		}
		if (cur == rbac.Owner || in.Role == rbac.Owner) && actor.Role != rbac.Owner {
			return errForbidden
		}
		if cur == rbac.Owner && (in.Role != rbac.Owner || !in.Active) {
			var owners int
			tx.QueryRowContext(ctx, `SELECT count(*) FROM users WHERE role = 'owner' AND active = 1`).Scan(&owners)
			if owners <= 1 {
				return conflict("لا يمكن تعطيل أو تغيير دور المالك الوحيد")
			}
		}
		if _, err := tx.ExecContext(ctx, `UPDATE users SET full_name = ?, role = ?, active = ?, updated_at = ? WHERE id = ?`,
			strings.TrimSpace(in.FullName), string(in.Role), sqlite.Int(in.Active), a.stamp(), id); err != nil {
			return err
		}
		changes := map[string]any{"role": in.Role, "active": in.Active}
		if in.Remote != nil && *in.Remote != (remote == 1) {
			if _, err := tx.ExecContext(ctx, `UPDATE users SET remote_access = ? WHERE id = ?`, sqlite.Int(*in.Remote), id); err != nil {
				return err
			}
			changes["remote_access"] = *in.Remote
			// Taking it away ends the sessions already open from outside.
			if !*in.Remote {
				if _, err := tx.ExecContext(ctx, `UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND channel = ? AND revoked_at IS NULL`, a.stamp(), id, string(ChannelTunnel)); err != nil {
					return err
				}
			}
		}
		if in.Password != "" {
			h, err := auth.HashPassword(in.Password)
			if err != nil {
				return mapAuthErr(err)
			}
			if _, err := tx.ExecContext(ctx, `UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?`, h, id); err != nil {
				return err
			}
			changes["password_reset"] = true
		}
		if in.PIN != "" {
			h, err := auth.HashPIN(in.PIN)
			if err != nil {
				return mapAuthErr(err)
			}
			if _, err := tx.ExecContext(ctx, `UPDATE users SET pin_hash = ? WHERE id = ?`, h, id); err != nil {
				return err
			}
			changes["pin_reset"] = true
		}
		// Disabling a user or resetting their password signs them out everywhere.
		if !in.Active || in.Password != "" {
			if _, err := tx.ExecContext(ctx, `UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL`, a.stamp(), id); err != nil {
				return err
			}
		}
		return a.audit(ctx, tx, actor, "user.update", "users", id, changes)
	})
}

func (a *App) ChangeOwnPassword(ctx context.Context, actor Actor, current, next string) error {
	var hash string
	if err := a.db.Read.QueryRowContext(ctx, `SELECT password_hash FROM users WHERE id = ?`, actor.UserID).Scan(&hash); err != nil {
		return err
	}
	if auth.Verify(hash, current) != nil {
		return invalid("كلمة المرور الحالية غير صحيحة")
	}
	h, err := auth.HashPassword(next)
	if err != nil {
		return mapAuthErr(err)
	}
	return a.tx(ctx, func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx, `UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = ? WHERE id = ?`, h, a.stamp(), actor.UserID); err != nil {
			return err
		}
		return a.audit(ctx, tx, actor, "user.change_password", "users", actor.UserID, nil)
	})
}
