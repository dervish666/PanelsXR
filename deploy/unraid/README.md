# Self-hosting Panel on Unraid

Panel ships as a single Docker container: the built WebXR app + a tiny Caddy
proxy that talks to your Komga with your API key injected server-side (the same
same-origin `/komga` arrangement the dev server uses — so **the app itself needs
no changes** to run self-hosted). You run it next to Komga; nothing goes through
anyone else's servers.

## ⚠️ HTTPS is required for VR

WebXR only works in a **secure context**. A plain `http://tower:8677` will load
the 2D page fine, but the **Quest browser won't enter VR**. Put Panel behind
your existing reverse proxy (SWAG / Nginx Proxy Manager / Cloudflare Tunnel) so
it's served over `https://`. Same story as any WebXR app.

## 🔒 Auth — safe by default

The container injects your Komga API key into every `/komga` request (that's what
keeps the client simple), which also means it **bypasses Komga's own auth** — so
an ungated Panel is an open proxy to your whole library. To make that impossible
by accident, **the `/komga` proxy is fail-closed**: it won't serve unless you've
set a gate. Pick one:

- **Set a password (recommended).** `PANEL_PASSWORD` (+ optional `PANEL_USER`,
  default `panel`) locks the whole app + proxy behind a login. The Quest browser
  caches it, so it's a **one-time** login — no repeated re-auth. Works anywhere,
  no Cloudflare needed; the password is bcrypt-hashed at container start. **Set it
  before first run** (it's a template field).
- **Gate it upstream, then set `PANEL_AUTH=none`.** If Panel is LAN-only or sits
  behind a reverse-proxy SSO (Cloudflare Access, Authelia, Authentik, Tinyauth…),
  set `PANEL_AUTH=none` to skip the built-in login. This serves your whole library
  to anyone who reaches the URL, so use it *only* when access is genuinely handled
  elsewhere — and make sure Panel is reachable **only** via that proxy.
- **Set nothing → fail-closed.** With no password and no `PANEL_AUTH=none`, the app
  loads but `/komga` returns `503` until you pick one of the above. Panel won't
  become an open proxy on its own.

**Least privilege (do this regardless):** give Panel a **dedicated read-only Komga
user** and use *that* user's API key. The injected key bypasses Komga's auth, so a
full-access key behind one password is one leak from total account compromise; a
read-only key caps the worst case to "someone saw my comics."

## What you need

- A **Komga API key** — Komga → Account Settings → API Keys.
- Your Komga URL reachable from the container (a LAN address like
  `http://192.168.1.10:8080` is fine — the container proxies it; the browser
  never talks to Komga directly).

## Test it locally first

```bash
# build the image
docker build -t dervish/panelsxr:latest .

# run it against your Komga. Panel is fail-closed, so you MUST set a gate or the
# /komga proxy returns 503: either a password (recommended) …
docker run --rm -p 8677:80 \
  -e KOMGA_URL="http://192.168.1.10:8080" \
  -e KOMGA_API_KEY="your-read-only-key" \
  -e PANEL_PASSWORD="a-test-password" \
  dervish/panelsxr:latest

# … or, for a quick LAN-only test, opt out of the gate explicitly:
#   -e PANEL_AUTH=none   (serves your library to anyone who reaches the URL)

# open http://localhost:8677 — log in (user "panel"), pick a book, and the
# /komga proxy streams it. (Without PANEL_PASSWORD or PANEL_AUTH=none you'll get
# a 503 by design — that's the fail-closed gate, not a bug.)
```

## Publishing to Community Apps

You've done this before with `dervish/unraidmonitorbot`; same flow:

1. **Push a multi-arch image to Docker Hub** (Unraid is amd64; arm64 is a bonus).
   Pass `PANEL_VERSION` so the image's `org.opencontainers.image.version` label
   matches the tag (otherwise it defaults to `dev`):
   ```bash
   docker buildx build --platform linux/amd64,linux/arm64 \
     --build-arg PANEL_VERSION=vX.Y.Z \
     -t dervish/panelsxr:latest -t dervish/panelsxr:vX.Y.Z --push .
   ```
   Or let CI do it: pushing a `vX.Y.Z` git tag triggers `.github/workflows/release.yml`
   (needs the `DOCKERHUB_USERNAME` / `DOCKERHUB_TOKEN` repo secrets set).
2. **Submit the template** at **https://ca.unraid.net/submit** — the portal live-
   scans the public repo (`github.com/dervish666/PanelsXR`), parses
   `deploy/unraid/panelsxr.xml` + `ca_profile.xml`, checks for duplicates, and
   previews the listing. Panel is already in Sam's registered CA repo
   (`dervish666/unraid-templates`), so it flows into Community Apps on the next
   index refresh.

## The template

`panelsxr.xml` is the Unraid CA template. Its Project/Support/Icon URLs point at
the public repo and it's ready to submit — just confirm the host port for your
box. The user configures `KOMGA_URL`, `KOMGA_API_KEY`, and a gate (`PANEL_PASSWORD`
or `PANEL_AUTH=none`) in the Unraid "Add Container" UI.
