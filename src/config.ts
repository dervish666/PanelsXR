// Client-side Komga config for the hosted "bring your own server" (Worker) build.
//
// Stored in a COOKIE, not localStorage — on purpose. The reader loads page images
// and thumbnails as same-origin GETs to /komga/* (straight into <img>/WebGL
// textures), and those requests can't carry a custom header but DO carry cookies
// automatically. So the config rides along on every request, the Worker reads it
// and injects the X-API-Key upstream, and the key never sits in the bundle.
//
// The Worker side that READS this cookie lives in worker/guard.ts — keep the wire
// format (encodeURIComponent(JSON.stringify({u,k}))) in sync between the two.
export interface KomgaConfig {
  url: string
  key: string
}

const COOKIE = 'panel_komga'
const MAX_AGE = 60 * 60 * 24 * 365 // a year — this is a set-once-per-device thing

// Only the hosted Worker build ships the setup/pairing flow. The Docker/Caddy
// container injects the key server-side from env and must behave exactly as
// before (no cookie, no setup screen), so the whole flow is gated on a build-time
// flag set only for the Worker build (VITE_BYO=1 — see vite.config.ts).
export const BYO: boolean = import.meta.env.VITE_BYO === '1'

export function getKomgaConfig(): KomgaConfig | null {
  const raw = readCookie(COOKIE)
  if (!raw) return null
  try {
    const obj = JSON.parse(decodeURIComponent(raw)) as { u?: unknown; k?: unknown }
    const url = typeof obj.u === 'string' ? obj.u.trim() : ''
    const key = typeof obj.k === 'string' ? obj.k.trim() : ''
    return url && key ? { url, key } : null
  } catch {
    return null
  }
}

export function setKomgaConfig(cfg: KomgaConfig): void {
  const value = encodeURIComponent(JSON.stringify({ u: cfg.url.trim(), k: cfg.key.trim() }))
  // Secure only over https (prod). On http://localhost — where `wrangler dev`
  // runs — omit it so the cookie still sets during local verification.
  const secure = location.protocol === 'https:' ? '; Secure' : ''
  document.cookie = `${COOKIE}=${value}; Path=/; Max-Age=${MAX_AGE}; SameSite=Strict${secure}`
}

export function clearKomgaConfig(): void {
  const secure = location.protocol === 'https:' ? '; Secure' : ''
  document.cookie = `${COOKIE}=; Path=/; Max-Age=0; SameSite=Strict${secure}`
}

function readCookie(name: string): string | null {
  for (const part of document.cookie.split(';')) {
    const idx = part.indexOf('=')
    if (idx === -1) continue
    if (part.slice(0, idx).trim() === name) return part.slice(idx + 1).trim()
  }
  return null
}
