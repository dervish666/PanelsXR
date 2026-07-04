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

# run it against your Komga (KOMGA_URL / KOMGA_API_KEY live in .env.local)
docker run --rm -p 8677:80 --env-file .env.local dervish/panelsxr:latest

# open http://localhost:8677 — pick a book, and the /komga proxy should stream it
```

## Publishing to Community Apps

You've done this before with `dervish/unraidmonitorbot`; same flow:

1. **Push a multi-arch image to Docker Hub** (Unraid is amd64; arm64 is a bonus):
   ```bash
   docker buildx build --platform linux/amd64,linux/arm64 \
     -t dervish/panelsxr:latest -t dervish/panelsxr:vX.Y.Z --push .
   ```
2. **Push this repo to GitHub** (PanelsXR has no remote yet) — CA needs a public
   project + support URL, and the template lives in the repo.
3. **Submit the template** at **https://ca.unraid.net/submit** — the portal live-
   scans your repo, parses `deploy/unraid/panelsxr.xml` + a `ca_profile.xml`,
   checks for duplicates, and previews the listing. Fill in metadata/license/
   support links and publish into the feed.

## The template

`panelsxr.xml` is a first-draft Unraid CA template. Before submitting, fill the
`TODO` fields (GitHub project/support URLs, icon URL — all need the repo pushed
to GitHub first) and confirm the host port. The two env vars — `KOMGA_URL` and
`KOMGA_API_KEY` — are what the user configures in the Unraid "Add Container" UI.
