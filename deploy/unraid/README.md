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

## 🔒 Lock it down before you expose it

The container **injects your Komga API key** into every `/komga` request, so an
*unauthenticated* Panel on the public internet is an open proxy to your whole
library (it bypasses Komga's own auth). Before you put it on a public URL, gate
it — two independent layers, use either or both:

- **Built-in basic auth (portable, recommended).** Set `PANEL_USER` +
  `PANEL_PASSWORD` and the whole app (and the Komga proxy) sits behind an HTTP
  basic-auth login. The browser caches it, so it's a **one-time** login in the
  Quest — no monthly re-auth. Works for anyone, no Cloudflare needed. The
  password is hashed at container start (never stored in plaintext).
- **Edge auth (Cloudflare Access / reverse-proxy SSO).** If you front Panel with
  a Cloudflare Tunnel, add a CF Access policy on the hostname for SSO-grade
  gating at the edge. Great as a personal outer layer; note CF Access sessions
  expire periodically, which is why basic auth is nicer for the actual reading.

**Least privilege (do this too):** give Panel a **dedicated Komga user** with
read-only access to just the libraries you want in VR, and use *that* user's API
key — so even a worst case only exposes that limited view, not your whole account.

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
