#!/usr/bin/env bash
# Release build. Embeds the Platform address and license public key; refuses
# to build without them (a keyless build runs with licensing off).
#
#   CPRO_SAAS_URL=https://cpro.example.com \
#   CPRO_LICENSE_PUBKEY=<from SCP Settings → License Public Key> \
#   CPRO_VERSION=1.0.0 \
#   scripts/build.sh [-platform windows/amd64]
set -euo pipefail
: "${CPRO_SAAS_URL:?set CPRO_SAAS_URL (https://...)}"
: "${CPRO_LICENSE_PUBKEY:?set CPRO_LICENSE_PUBKEY (bench execute saas_control_platform.licensing.signing.generate_keys)}"
VERSION="${CPRO_VERSION:-0.1.0}"
case "$CPRO_SAAS_URL" in https://*) ;; *) echo "CPRO_SAAS_URL must be https://" >&2; exit 1 ;; esac
if [ "${#CPRO_LICENSE_PUBKEY}" -ne 43 ]; then echo "CPRO_LICENSE_PUBKEY must be a 43-char base64url Ed25519 key" >&2; exit 1; fi
LDFLAGS="-s -w -X cpro/internal/license.PublicKey=${CPRO_LICENSE_PUBKEY} -X cpro/internal/saas.DefaultURL=${CPRO_SAAS_URL} -X cpro/internal/app.Version=${VERSION}"
exec wails build -clean -trimpath -ldflags "$LDFLAGS" "$@"
