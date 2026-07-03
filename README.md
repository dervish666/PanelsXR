# Panel — WebXR comic reader for Komga

A browser-based WebXR reader that (from v1) streams a self-hosted **Komga**
library straight into a VR headset. Put the headset on, it opens where you left
off on the iPad, pages turn on the thumbstick, text stays readable. Runs in the
Quest browser — no store, no native build, no sideload.

## Status: v0 — "the reading surface"

The reading experience, with a deliberately dumb page source so we can tune
comfort and controls before touching auth/CORS.

- Enter-VR button; works on **desktop** (mouse/keyboard) **and in headset**.
- A page surface floating at a comfortable size/distance.
- **Thumbstick L/R** (or **A/B**) turns pages in VR; **arrow keys** on desktop.
- Next/prev pages are **preloaded**; off-window textures are **disposed**.
- Page source: **20 synthetic test pages** out of the box, or **load a local
  `.cbz`** (a ZIP of images) via the button — no server needed.

Not in v0 (coming next): Komga browse + auth, WebXR Layers for crisp text,
read-progress sync. See the roadmap in the kickoff brief.

## Running it

```bash
npm install
npm run dev          # http://localhost:5173  (desktop iteration loop)
```

### On the Quest

`adb` isn't set up on this machine, so use the LAN + HTTPS path (WebXR needs a
secure context, and the Quest reaches this box over the network):

```bash
npm run dev:quest    # serves over HTTPS on the LAN (self-signed cert)
```

Then browse to `https://<your-mac-lan-ip>:5173` on the Quest and accept the
certificate warning. On the desktop, the "Enter VR" button uses an emulated
Quest 3 so you can smoke-test the VR path without hardware.

## Tech

Vite + React + TypeScript · three.js · @react-three/fiber · @react-three/xr
(v6, `createXRStore`) · @react-three/drei · JSZip (dev-only local `.cbz`).

## Layout

```
src/
  main.tsx            app entry
  App.tsx             XR store, HUD, page state, keyboard fallback
  xr/store.ts         createXRStore config (foveation, floor space, desktop emulate)
  scene/
    Reader.tsx        the reading scene (surface + input + desktop orbit)
    PageSurface.tsx   textured plane; preload window + texture disposal
    XRPageInput.tsx   thumbstick / A-B page turning with edge detection
  pages/
    synthetic.ts      canvas-drawn placeholder pages (default source)
    cbz.ts            local .cbz loader (JSZip) — dev convenience
```
