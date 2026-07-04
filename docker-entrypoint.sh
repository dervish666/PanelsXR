#!/bin/sh
# Panel container entrypoint — safe by default.
#
# The container injects a shared Komga key on every /komga request (bypassing
# Komga's own auth), so an ungated public Panel is an open proxy to the whole
# library. To make that impossible by accident, the /komga proxy is FAIL-CLOSED:
# it won't serve unless you've set a gate, or explicitly opted out.
#
#   PANEL_PASSWORD set   -> HTTP basic auth on the whole app (recommended).
#   PANEL_AUTH=none      -> deliberately ungated (LAN-only, or gated upstream by
#                           a reverse proxy / Cloudflare Access / Authelia / …).
#   neither              -> the app loads but /komga returns 503 until you set one.
set -e

AUTH_FILE=/etc/caddy/auth.conf   # site-wide basic_auth block (or empty)
GATE_FILE=/etc/caddy/gate.conf   # /komga fail-closed gate (or empty = allow)

if [ "$PANEL_AUTH" = "none" ]; then
  : > "$AUTH_FILE"
  : > "$GATE_FILE"
  echo "[panel] !!! UNGATED (PANEL_AUTH=none) — your entire Komga library is served to ANYONE who reaches this URL. Ensure it is LAN-only or gated upstream (reverse proxy / SSO). !!!"
elif [ -n "$PANEL_PASSWORD" ]; then
  PUSER="${PANEL_USER:-panel}"
  PHASH="$(caddy hash-password --plaintext "$PANEL_PASSWORD" --algorithm bcrypt)"
  printf 'basic_auth {\n\t%s %s\n}\n' "$PUSER" "$PHASH" > "$AUTH_FILE"
  : > "$GATE_FILE"
  echo "[panel] basic auth ENABLED (user: $PUSER)"
else
  # fail closed: no gate configured -> load the app but refuse to proxy Komga
  : > "$AUTH_FILE"
  printf 'respond "Panel is not secured. Set PANEL_PASSWORD to enable the built-in login, or PANEL_AUTH=none if you have gated access elsewhere (LAN / reverse proxy / SSO)." 503\n' > "$GATE_FILE"
  echo "[panel] NOT SECURED — no PANEL_PASSWORD set, so /komga is DISABLED (503). Set PANEL_PASSWORD to lock it with a login, or PANEL_AUTH=none if you have gated access another way."
fi

exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
