// Pure, runtime-agnostic guards for the Komga proxy. Uses only `URL` and string
// work (available in both the Workers runtime and node), so it's unit-tested
// under vitest — the security surface of a public, BYO-host proxy is exactly the
// thing you want covered by tests, not just eyeballs.

export interface AllowResult {
  allowed: boolean
  status: number // HTTP status to return when !allowed
  message: string
}

const OK: AllowResult = { allowed: true, status: 200, message: '' }

function deny(status: number, message: string): AllowResult {
  return { allowed: false, status, message }
}

// PATCH is only ever legitimate against a single book's read-progress.
const READ_PROGRESS = /^\/api\/v1\/books\/[^/]+\/read-progress$/

// Port of the Caddyfile's read-only allowlist. `path` is the Komga path AFTER
// the /komga prefix and WITHOUT the query string (a pathname). The injected API
// key bypasses Komga's own auth, so we permit exactly what the reader needs and
// nothing else:
//   GET    /api/v1/*                      series, books, pages, thumbnails
//   POST   /api/v1/books/list             the search endpoint
//   PATCH  /api/v1/books/{id}/read-progress
// Everything else — other methods, other POST/PATCH targets, and the sensitive
// account/oauth/claim endpoints — is refused here, so even a full-access key
// can't be turned into account control (or a general relay) through Panel.
export function checkKomgaRequest(method: string, path: string): AllowResult {
  const m = method.toUpperCase()

  // Only ever talk to the v1 API surface the client uses. This also stops the
  // proxy being used to relay arbitrary paths to the upstream host.
  if (!path.startsWith('/api/v1/')) {
    return deny(404, 'Panel proxy: not a Komga API path')
  }

  // Account / auth surfaces are off-limits regardless of method.
  if (
    path.startsWith('/api/v1/users') ||
    path.startsWith('/api/v1/oauth2') ||
    path.startsWith('/api/v1/claim')
  ) {
    return deny(403, 'Panel proxy: not allowed')
  }

  if (m === 'GET') return OK
  if (m === 'POST') {
    return path === '/api/v1/books/list' ? OK : deny(403, 'Panel proxy: not allowed')
  }
  if (m === 'PATCH') {
    return READ_PROGRESS.test(path) ? OK : deny(403, 'Panel proxy: not allowed')
  }
  return deny(405, 'Panel proxy: method not allowed')
}

// SSRF guard. The Komga URL is user-supplied (that's the whole point of BYO), so
// the proxy must not become a lever into private network space. Cloudflare's
// edge won't route to RFC1918 anyway, but we reject explicitly so a bad target
// fails fast and legibly rather than hanging or surprising us.
export interface UpstreamResult {
  ok: boolean
  reason?: string
}

export function checkUpstream(raw: string): UpstreamResult {
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return { ok: false, reason: 'is not a valid URL' }
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    return { ok: false, reason: 'must start with http:// or https://' }
  }
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal')
  ) {
    return { ok: false, reason: 'points at a local-only address' }
  }
  if (isPrivateIp(host)) {
    return { ok: false, reason: 'points at a private address (must be reachable from the internet)' }
  }
  return { ok: true }
}

function isPrivateIp(host: string): boolean {
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (v4) {
    const a = Number(v4[1])
    const b = Number(v4[2])
    if (a > 255 || b > 255 || Number(v4[3]) > 255 || Number(v4[4]) > 255) return true // malformed → treat as unsafe
    if (a === 0 || a === 10 || a === 127) return true
    if (a === 169 && b === 254) return true // link-local (incl. 169.254.169.254 metadata)
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
    if (a === 100 && b >= 64 && b <= 127) return true // CGNAT 100.64.0.0/10
    return false
  }
  if (host.includes(':')) {
    if (host === '::1' || host === '::') return true
    // IPv4-mapped IPv6 (::ffff:a.b.c.d). The URL parser usually normalises the
    // embedded IPv4 to hex (::ffff:c0a8:1), so handle both forms and re-check the
    // underlying IPv4 — otherwise a private box could sneak in mapped.
    const dotted = host.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/)
    if (dotted) return isPrivateIp(dotted[1])
    const hexMapped = host.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/)
    if (hexMapped) {
      const hi = parseInt(hexMapped[1], 16)
      const lo = parseInt(hexMapped[2], 16)
      return isPrivateIp(`${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`)
    }
    // fc00::/7 unique-local, fe80::/10 link-local
    if (host.startsWith('fc') || host.startsWith('fd')) return true
    if (/^fe[89ab]/.test(host)) return true
    return false
  }
  return false
}

// Config cookie parsing. Wire format is encodeURIComponent(JSON.stringify({u,k}))
// — kept tiny so it fits the 4KB cookie budget and rides along on every
// same-origin request (including <img>/texture GETs, which can't carry a custom
// header — the whole reason config lives in a cookie, not localStorage). The
// browser side that WRITES this lives in src/config.ts; keep the formats in sync.
export interface KomgaConfig {
  url: string
  key: string
}

export const COOKIE_NAME = 'panel_komga'

export function parseConfigCookie(cookieHeader: string | null | undefined): KomgaConfig | null {
  if (!cookieHeader) return null
  const raw = readCookie(cookieHeader, COOKIE_NAME)
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

function readCookie(header: string, name: string): string | null {
  for (const part of header.split(';')) {
    const idx = part.indexOf('=')
    if (idx === -1) continue
    if (part.slice(0, idx).trim() === name) return part.slice(idx + 1).trim()
  }
  return null
}
