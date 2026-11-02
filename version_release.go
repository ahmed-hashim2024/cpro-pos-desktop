//go:build !dev

package main

import (
	_ "embed"
	"encoding/json"

	"cpro/internal/app"
)

// The app version is wails.json → info.productVersion, so a release only
// bumps that one number. (`wails dev` builds with the "dev" tag and stays
// "dev": no update checks.) -ldflags "-X cpro/internal/app.Version=..." still
// wins when given.

//go:embed wails.json
var wailsJSON []byte

func init() {
	if app.Version != "dev" {
		return
	}
	var cfg struct {
		Info struct {
			ProductVersion string `json:"productVersion"`
		} `json:"info"`
	}
	if json.Unmarshal(wailsJSON, &cfg) == nil && cfg.Info.ProductVersion != "" {
		app.Version = cfg.Info.ProductVersion
	}
}
