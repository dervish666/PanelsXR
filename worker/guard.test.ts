import { describe, it, expect } from 'vitest'
import { checkKomgaRequest, checkUpstream, parseConfigCookie, COOKIE_NAME } from './guard'

describe('checkKomgaRequest — the read-only allowlist', () => {
  it('allows GET on any v1 path (series, books, pages, thumbnails)', () => {
    for (const p of [
      '/api/v1/series',
      '/api/v1/books/abc/pages/3',
      '/api/v1/series/xyz/thumbnail',
      '/api/v1/books/ondeck',
    ]) {
      expect(checkKomgaRequest('GET', p).allowed).toBe(true)
    }
  })

  it('allows POST only on the search endpoint', () => {
    expect(checkKomgaRequest('POST', '/api/v1/books/list').allowed).toBe(true)
    expect(checkKomgaRequest('POST', '/api/v1/series').allowed).toBe(false)
    expect(checkKomgaRequest('POST', '/api/v1/books/list/extra').allowed).toBe(false)
  })

  it('allows PATCH only on a single book read-progress', () => {
    expect(checkKomgaRequest('PATCH', '/api/v1/books/abc123/read-progress').allowed).toBe(true)
    expect(checkKomgaRequest('PATCH', '/api/v1/books/abc/read-progress/x').allowed).toBe(false)
    expect(checkKomgaRequest('PATCH', '/api/v1/series/abc').allowed).toBe(false)
  })

  it('refuses write/dangerous methods with 405', () => {
    for (const m of ['DELETE', 'PUT', 'OPTIONS', 'HEAD']) {
      const r = checkKomgaRequest(m, '/api/v1/series')
      expect(r.allowed).toBe(false)
      expect(r.status).toBe(405)
    }
  })

  it('refuses account/oauth/claim surfaces regardless of method', () => {
    for (const p of ['/api/v1/users', '/api/v1/users/me', '/api/v1/oauth2/x', '/api/v1/claim']) {
      expect(checkKomgaRequest('GET', p).allowed).toBe(false)
      expect(checkKomgaRequest('GET', p).status).toBe(403)
    }
  })

  it('refuses anything outside the v1 API (no arbitrary relay)', () => {
    for (const p of ['/', '/actuator/health', '/api/v2/whatever', '/etc/passwd']) {
      const r = checkKomgaRequest('GET', p)
      expect(r.allowed).toBe(false)
      expect(r.status).toBe(404)
    }
  })
})

describe('checkUpstream — SSRF guard', () => {
  it('allows public http(s) hosts', () => {
    expect(checkUpstream('https://komga.example.com').ok).toBe(true)
    expect(checkUpstream('https://komga.brisflix.com/api').ok).toBe(true)
    expect(checkUpstream('http://1.2.3.4:8080').ok).toBe(true)
  })

  it('rejects non-http(s) schemes', () => {
    expect(checkUpstream('file:///etc/passwd').ok).toBe(false)
    expect(checkUpstream('ftp://host/x').ok).toBe(false)
    expect(checkUpstream('gopher://host').ok).toBe(false)
  })

  it('rejects localhost and local-only names', () => {
    for (const u of [
      'http://localhost:8080',
      'https://komga.localhost',
      'http://nas.local',
      'http://komga.internal',
    ]) {
      expect(checkUpstream(u).ok).toBe(false)
    }
  })

  it('rejects private / loopback / link-local IPv4', () => {
    for (const u of [
      'http://127.0.0.1:8080',
      'http://10.0.0.5',
      'http://192.168.1.10:8080',
      'http://172.16.0.1',
      'http://172.31.255.255',
      'http://169.254.169.254', // cloud metadata
      'http://100.64.0.1', // CGNAT
      'http://0.0.0.0',
    ]) {
      expect(checkUpstream(u).ok).toBe(false)
    }
  })

  it('allows public IPv4 that merely looks adjacent to private ranges', () => {
    expect(checkUpstream('http://172.32.0.1').ok).toBe(true)
    expect(checkUpstream('http://11.0.0.1').ok).toBe(true)
    expect(checkUpstream('http://192.167.1.1').ok).toBe(true)
  })

  it('rejects private / mapped IPv6', () => {
    for (const u of [
      'http://[::1]:8080',
      'http://[fc00::1]',
      'http://[fd12:3456::1]',
      'http://[fe80::1]',
      'http://[::ffff:192.168.0.1]',
    ]) {
      expect(checkUpstream(u).ok).toBe(false)
    }
  })

  it('rejects garbage', () => {
    expect(checkUpstream('not a url').ok).toBe(false)
    expect(checkUpstream('').ok).toBe(false)
  })
})

describe('parseConfigCookie', () => {
  const enc = (u: string, k: string) => encodeURIComponent(JSON.stringify({ u, k }))

  it('round-trips a valid config from the cookie header', () => {
    const header = `foo=bar; ${COOKIE_NAME}=${enc('https://komga.example.com', 'secret-key')}; baz=1`
    expect(parseConfigCookie(header)).toEqual({ url: 'https://komga.example.com', key: 'secret-key' })
  })

  it('returns null when the cookie is absent or empty', () => {
    expect(parseConfigCookie(null)).toBeNull()
    expect(parseConfigCookie('')).toBeNull()
    expect(parseConfigCookie('other=1; another=2')).toBeNull()
  })

  it('returns null on malformed or incomplete payloads', () => {
    expect(parseConfigCookie(`${COOKIE_NAME}=not-json`)).toBeNull()
    expect(parseConfigCookie(`${COOKIE_NAME}=${enc('https://x', '')}`)).toBeNull()
    expect(parseConfigCookie(`${COOKIE_NAME}=${enc('', 'k')}`)).toBeNull()
  })
})
