# Changelog

All notable changes to Panel are recorded here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this project aims for
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

_Parked / on the roadmap: per-user Komga login (cookie-passthrough), built-in
HTTPS (`PANEL_DOMAIN` real-cert / `PANEL_TLS=internal`), forward-auth mode for
Authelia/Authentik, and a public "bring-your-own-Komga" static build._

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

[Unreleased]: https://github.com/dervish666/PanelsXR/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/dervish666/PanelsXR/releases/tag/v0.2.0
[0.1.0]: https://github.com/dervish666/PanelsXR/releases/tag/v0.1.0
