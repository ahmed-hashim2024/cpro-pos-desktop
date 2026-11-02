#!/usr/bin/env bash
# Release build. Everything it needs is in the code: the license public key
# (internal/license), the Platform address (internal/saas) and the version
# (wails.json → info.productVersion). Bump productVersion for every release.
#
#   scripts/build.sh -platform windows/amd64 -nsis
#
# Optional overrides: CPRO_SAAS_URL=https://... (another Platform address).
set -euo pipefail
LDFLAGS="-s -w"
if [ -n "${CPRO_SAAS_URL:-}" ]; then
  case "$CPRO_SAAS_URL" in https://*) ;; *) echo "CPRO_SAAS_URL must be https://" >&2; exit 1 ;; esac
  LDFLAGS="$LDFLAGS -X cpro/internal/saas.DefaultURL=${CPRO_SAAS_URL%/}"
fi
exec wails build -clean -trimpath -ldflags "$LDFLAGS" "$@"
