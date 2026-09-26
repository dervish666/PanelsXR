/// <reference types="@cloudflare/workers-types" />
//
// Panel — Cloudflare Worker deploy target. Serves the built WebXR app (static
// assets) and proxies /komga/* to the *user's own* Komga, injecting their API key
// server-side so every request stays same-origin (the property the whole reader
// relies on: page images and thumbnails render straight into <img>/WebGL textures
// with no fetch→blob dance, no CORS). Multi-tenant "bring your own server": the
// key comes from a per-device cookie, never a database. See worker/guard.ts for
// the read-only allowlist + SSRF guard, and worker/pair.ts for the phone handoff.
//
// This is the internet-reachable-Komga counterpart to the Docker/Caddy container
// (which stays for LAN-only setups — a CF edge Worker can't route to a 192.168.x
// box). run_worker_first in wrangler.jsonc routes /komga/* and /api/pair/* here;
// everything else is served straight from static assets.
import { checkKomgaRequest, checkUpstream, parseConfigCookie } from './guard'
import { handlePairing } from './pair'

export interface Env {
  ASSETS: Fetcher
  PANEL_PAIR: KVNamespace
  // Optional single-tenant fallback: set these as Worker secrets to run the
  // Worker like the container (one operator key for everyone, no setup screen).
  KOMGA_URL?: string
  KOMGA_API_KEY?: string
}

const TIMEOUT_MS = 15_000

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname.startsWith('/komga/')) return proxyKomga(request, url, env)
    if (url.pathname.startsWith('/api/pair/')) return handlePairing(request, url, env)
    // Everything else (SPA routes + static files) → the assets binding, which
    // applies not_found_handling: single-page-application (serves index.html).
    return env.ASSETS.fetch(request)
  },
}

async function proxyKomga(request: Request, url: URL, env: Env): Promise<Response> {
  // Per-device cookie (BYO) first; fall back to Worker secrets (single-tenant).
  const cookieCfg = parseConfigCookie(request.headers.get('Cookie'))
  const cfg =
    cookieCfg ?? (env.KOMGA_URL ? { url: env.KOMGA_URL, key: env.KOMGA_API_KEY ?? '' } : null)
  if (!cfg) {
    // Plain-text so the client's humanKomgaError() surfaces it verbatim (503).
    return proxyError(503, 'Panel isn’t set up yet — add your Komga server and API key.')
  }

  const komgaPath = url.pathname.slice('/komga'.length) // '/api/v1/...'
  const check = checkKomgaRequest(request.method, komgaPath)
  if (!check.allowed) return proxyError(check.status, check.message)

  const up = checkUpstream(cfg.url)
  if (!up.ok) return proxyError(502, `Panel: the configured Komga URL ${up.reason}.`)

  let base: URL
  try {
    base = new URL(cfg.url)
  } catch {
    return proxyError(502, 'Panel: the configured Komga URL is not valid.')
  }
  const prefix = base.pathname === '/' ? '' : base.pathname.replace(/\/+$/, '')
  const target = base.origin + prefix + komgaPath + url.search

  // Re-check the fully-resolved target (a base path could push it somewhere odd).
  const up2 = checkUpstream(target)
  if (!up2.ok) return proxyError(502, `Panel: the configured Komga URL ${up2.reason}.`)

  const headers = new Headers()
  const accept = request.headers.get('Accept')
  if (accept) headers.set('Accept', accept)
  const contentType = request.headers.get('Content-Type')
  if (contentType) headers.set('Content-Type', contentType)
  // The key that unlocks the user's own library — injected here, never in the
  // browser. The client's Cookie / Authorization are deliberately NOT forwarded.
  headers.set('X-API-Key', cfg.key)

  let body: string | undefined
  if (request.method === 'POST' || request.method === 'PATCH') {
    body = await request.text()
  }

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  let upstream: Response
  try {
    upstream = await fetch(target, {
      method: request.method,
      headers,
      body,
      signal: ctrl.signal,
      // Don't chase redirects — Komga's API doesn't use them, and following one
      // would let a crafted upstream bounce us past the SSRF check.
      redirect: 'manual',
    })
  } catch {
    return proxyError(
      502,
      'Couldn’t reach Komga — check the server is up and reachable from the internet.',
    )
  } finally {
    clearTimeout(timer)
  }

  // Rebuild the response: pass content + caching through, strip any Set-Cookie,
  // add the same static security headers as the Caddyfile — and, crucially, NOT
  // nosniff or CSP (both black-screened troika <Text> + VR; see the Caddyfile).
  const out = new Headers()
  for (const h of ['Content-Type', 'Content-Length', 'Cache-Control', 'ETag', 'Last-Modified']) {
    const v = upstream.headers.get(h)
    if (v) out.set(h, v)
  }
  out.set('X-Frame-Options', 'DENY')
  out.set('Referrer-Policy', 'no-referrer')

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: out,
  })
}

function proxyError(status: number, message: string): Response {
  return new Response(message, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}
