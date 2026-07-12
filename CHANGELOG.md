# Changelog

All notable changes to Panel are recorded here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this project aims for
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

_Parked / on the roadmap: per-user Komga login (cookie-passthrough), built-in
HTTPS (`PANEL_DOMAIN` real-cert / `PANEL_TLS=internal`), forward-auth mode for
Authelia/Authentik, and a public "bring-your-own-Komga" static build._

_On-device follow-ups (emulator can't verify): off-thread page decode, keeping
the page surface mounted across the VR toggle, and abortable cover loads._

## [0.2.3] — 2026-07-12

### Fixed
- **A new container deploy now "takes" on the first load.** The container set no
  `Cache-Control`, so browsers fell back to heuristic caching and the Quest held
  a stale `index.html` pointing at the previous build's hashed assets — a new
  image needed a couple of hard refreshes before it appeared (seen upgrading to
  0.2.2). `index.html` and other unfingerprinted files are now served `no-cache`
  so they always revalidate via ETag (a cheap 304 when unchanged), while Vite's
  content-hashed `/assets/*` are served `immutable` for a year. Result: no
  stale-deploy lag, and faster repeat loads (the big JS/texture bundles stop
  revalidating every visit).

## [0.2.2] — 2026-07-12

Hotfix for a regression introduced in 0.2.1.

### Fixed
- **The 3D library and VR reader rendered black.** The security headers added in
  0.2.1 broke drei's `<Text>` (troika): `X-Content-Type-Options: nosniff` makes
  the Quest/Chrome browser refuse troika's blob-URL text-layout worker, so every
  3D scene using text (the whole library and reader) threw and rendered black,
  while the plain-HTML 2D landing still worked. Removed `nosniff` and the CSP
  (troika also needs `Function`, which the CSP blocked). `X-Frame-Options` and
  `Referrer-Policy` are kept — verified the 3D scene renders with those present.

## [0.2.1] — 2026-07-10

The audit-remediation release — correctness, first-run experience, and container
hardening. No new reading features; everything the reader did, it still does,
now with the failure paths handled.

### Fixed
- **Reopening a finished book no longer wipes its progress.** Auto-resuming (or
  reopening) a completed book used to silently reset its Komga read-progress to
  page 1; the sync now only fires on a real page turn, so cross-device resume
  stays intact.
- **First-run and failure states are no longer silent.** The fail-closed `503`
  gate, an unreachable Komga, and an empty library now show clear, distinct
  messages (in both the 2D and 3D libraries) instead of a blank screen or an
  indistinguishable "Nothing here yet". `ENTER VR` explains itself on browsers
  without WebXR or without HTTPS instead of doing nothing.
- No more dead-ends: closing the 3D library with nothing loaded, or the space
  bar being swallowed while typing in the library search.
- A transient Komga blip at startup no longer permanently forgets your last
  book; the last page turn before the headset comes off is now flushed.
- Failed page images show a label and auto-retry instead of a silent dark page;
  `.cbz` archives ignore macOS resource-fork junk and are guarded against
  zip-bomb sized inputs; `.cbz` picker is keyboard-accessible.

### Security
- **The `/komga` proxy is now least-privilege.** It forwards only the read
  surface the app uses (GET series/books/pages/thumbnails, `POST /books/list`,
  `PATCH read-progress`); everything else — `DELETE`, `PUT`, library management,
  `/users` — is refused at the proxy, so even a full-access key can't be turned
  into account control. `PANEL_USER` is validated (no Caddyfile injection).
- Baseline security headers + CSP on the served app; private files kept out of
  the Docker build context.

### Performance
- Page textures are clamped (bounds Quest VRAM); cover thumbnails get mipmaps;
  a cover-texture disposal leak on library navigation is fixed.

### Added
- A GitHub Actions release workflow (build + tests + multi-arch push on a tag).
- Type-safe error handling, a render error boundary, and unit tests for the
  page-pairing logic.

## [0.2.0] — 2026-07-05

The reading-experience release — page comfort, in-VR controls, and hands-free
paging, all tuned on the real headset.

### Added
- **Adjustable page curve** — bend the page toward you (like a curved monitor)
  so the far edges come closer and stay readable. A slider on the flat page; the
  amount persists. A two-page spread bends as one continuous sheet.
- **Hand mode (Quest hand tracking)** — a "Hands" toggle that turns on:
  - **Three-zone page tap** (the comic-reader standard): tap the page's left
    third to go back, right third to go forward, middle to show/hide the
    controls. Works with a controller trigger or a hand pinch.
  - **Wave to turn the page** — wave a hand across the page (right-to-left
    advances). Off by default; opt in from the HUD.
- Icon and MIT `LICENSE` for the Community Applications listing.

### Changed
- **Redesigned the in-VR control bar** to match the app: a rounded tray plate
  with the placard's keyline + hard-offset shadow, sticker-style buttons, and a
  3D slider for curve.
- Controller mode (Hands off) is untouched — trigger-hold grabs/moves/resizes
  the page and the thumbstick / A-B buttons page, exactly as before.

## [0.1.0] — 2026-07-05

First shipped release — a self-hostable WebXR comic reader that streams a
self-hosted [Komga](https://komga.org) library into a Meta Quest 3 headset.

### Reader
- WebXR reader that composites Komga pages onto a plane in VR, with a backing
  board + fanned paper stack so the comic reads as a physical object.
- **Auto-resume**: reopens your last book fresh from Komga on load, so progress
  read elsewhere (e.g. the iPad) carries over with zero clicks.
- Read-progress sync — resume on open, debounced push on page turn.
- Single-page and two-page spread modes.
- In-headset controls: right-stick / trigger paging, grab-to-move, two-handed
  resize, left-stick locomotion, recenter; a follow-along control bar that can't
  be grabbed by mistake.
- Ambience: the void tints to the page's dominant colour.
- Desktop iteration path (OrbitControls + IWER-emulated Quest 3) alongside the
  real-headset path.
- `.cbz` loading for local files (dev/testing).

### 3D library
- **A–Z "Alphabet Shelf"**: browse the whole library as letter stacks whose
  thickness and count badge scale with bucket size; pick a letter to be
  surrounded by its series, drill into a series' issues, page through sets
  larger than 72. Sparse letters gather their covers in front of you.
- **Recent** mode: continue-reading + on-deck + series, curated.
- 2D library browser (series list, search, shelves) for picking on the flat page.

### Look & feel
- "Comic-shop pulp" identity: warm-black OKLCH palette, one pulp-red accent,
  Archivo Black display type, a halftone signature mark.
- A "Placard" landing that centres into a proper front page, showing your
  current book (cover + progress) when you have one.
- Sticker-style button system (heavy keyline + hard offset "misregistration"
  shadow), including the bold red **Enter VR** hero button.

### Packaging & security
- Ships as a single Docker container (multi-stage build → Caddy) serving the
  static app + a same-origin `/komga` proxy that injects the Komga API key
  server-side, so the browser never sees it and the client stays same-origin.
- **Safe by default**: the `/komga` proxy is fail-closed — it refuses to serve
  (503) unless you set `PANEL_PASSWORD` (built-in HTTP basic auth, cached by the
  Quest browser for a one-time login) or explicitly opt out with
  `PANEL_AUTH=none` (LAN-only / upstream-gated). No accidental open proxy.
- Unraid Community Applications template + self-hosting docs.

[Unreleased]: https://github.com/dervish666/PanelsXR/compare/v0.2.2...HEAD
[0.2.2]: https://github.com/dervish666/PanelsXR/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/dervish666/PanelsXR/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/dervish666/PanelsXR/releases/tag/v0.2.0
[0.1.0]: https://github.com/dervish666/PanelsXR/releases/tag/v0.1.0
