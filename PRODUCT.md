# Panel — PRODUCT.md

## Register

product — the UI serves the reading; app shell, library browser, HUD. (The *pages*
are the content; chrome must frame them, never compete.)

## Users & Purpose

One user: Sam, reading comics from his self-hosted Komga library — on a desktop
browser to pick books and sanity-check, and inside a Meta Quest 3 (WebXR) to
actually read. Context: sofa, evening, headset on. Primary job on any screen:
get back into your book with zero friction (auto-resume does this on load).
Secondary: browse/pick the next book.

## Brand personality

**Comic-shop pulp.** Inky blacks, one bold comic-red accent, chunky confident
type, halftone-dot texture used sparingly. It should feel like the back room of
a good comic shop — not a SaaS dashboard, not Plex.

Three words: inky, pulpy, confident.

## Anti-references

- Generic dark-mode SaaS (indigo accent on #111 with soft gray borders — what v0 shipped)
- Plex/Jellyfin media-server chrome
- Anything cream/parchment "comic nostalgia" — the paper lives in the comics themselves

## Accessibility

- Body text ≥4.5:1 on its background; the HUD floats over a black void so this is easy — keep it honest on hover tints.
- `prefers-reduced-motion` honoured on all motion.
- Hit targets ≥40px in the HUD (it's also used as a 2D page on the Quest browser with imprecise pointing).

## Constraints

- The 3D canvas (comic page) is the hero; UI is an overlay at the edges.
- Dark theme only — it's a VR reading app; the surround must stay near-black to
  not bleed light around the page in-headset. (Scene sentence: a man on a sofa
  at night with a headset on wants the room dark and the page lit.)
- No heavy JS UI libs; hand-rolled CSS on Vite + React.
