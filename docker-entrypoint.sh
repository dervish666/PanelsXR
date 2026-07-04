#!/bin/sh
# Panel container entrypoint. Optionally turns on HTTP basic auth from a
# plaintext password env var (hashed at boot, never stored in plaintext in the
# config), then starts Caddy. Auth is OFF unless PANEL_PASSWORD is set, so
# LAN-only or Cloudflare-Access-gated deployments aren't forced to use it.
set -e

AUTH_FILE=/etc/caddy/auth.conf

if [ -n "$PANEL_PASSWORD" ]; then
  PUSER="${PANEL_USER:-panel}"
  PHASH="$(caddy hash-password --plaintext "$PANEL_PASSWORD" --algorithm bcrypt)"
  printf 'basic_auth {\n\t%s %s\n}\n' "$PUSER" "$PHASH" > "$AUTH_FILE"
  echo "[panel] basic auth ENABLED (user: $PUSER)"
else
  echo '# basic auth disabled — set PANEL_PASSWORD to enable' > "$AUTH_FILE"
  echo "[panel] basic auth DISABLED (no PANEL_PASSWORD) — gate via Cloudflare Access or keep it LAN-only"
fi

exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
