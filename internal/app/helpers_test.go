package app

import (
	"context"

	"cpro/internal/domain/rbac"
)

// ActivateDevice connects the app in tests without a browser: the fake
// Platform takes the tenant's code as a link token.
func (a *App) ActivateDevice(ctx context.Context, actor Actor, code, _ string) (PlatformInfo, error) {
	if err := actor.require(rbac.SettingsManage); err != nil {
		return PlatformInfo{}, err
	}
	if err := a.activateWithLink(ctx, code); err != nil {
		return PlatformInfo{}, err
	}
	return a.PlatformInfo(ctx, actor)
}
