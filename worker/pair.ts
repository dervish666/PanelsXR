// Device pairing — the "TV code" handoff so nobody types a Komga URL + API key on
// the Quest virtual keyboard. The headset displays a short code and polls; the
// user finishes setup on their phone/laptop at /pair. Config is brokered through
// a single-use, short-TTL KV slot (no accounts, no persistent key storage — the
// slot auto-expires). This is a few-minutes-at-rest version of the same trust the
// per-request proxy already carries (the key transits the Worker every page turn).
import type { Env } from './index'
import { checkUpstream } from './guard'

const CREATE_TTL_SECONDS = 300 // a code lives 5 min before the phone submits
const CLAIM_TTL_SECONDS = 180 // once config is submitted, the headset has 3 min to claim
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789' // no I/L/O/0/1 — unambiguous on a screen
const CODE_LEN = 6

interface Slot {
  token: string
  config: { url: string; key: string } | null
}

export async function handlePairing(request: Request, url: URL, env: Env): Promise<Response> {
  const path = url.pathname
  if (request.method === 'POST' && path === '/api/pair/create') return createPair(env)
  if (request.method === 'POST' && path === '/api/pair/submit') return submitPair(request, env)
  if (request.method === 'GET' && path === '/api/pair/claim') return claimPair(url, env)
  return json({ error: 'not found' }, 404)
}

// Headset asks for a fresh code. It gets back the code (to display) and a secret
// token (kept private) — only a claimer holding the token can read the config, so
// someone who merely shoulder-surfs the code off the screen can't hoover it.
async function createPair(env: Env): Promise<Response> {
  const token = randomHex(16)
  let code = ''
  for (let attempt = 0; attempt < 6; attempt++) {
    const candidate = randomCode()
    const existing = await env.PANEL_PAIR.get(kvKey(candidate))
    if (!existing) {
      code = candidate
      break
    }
  }
  if (!code) return json({ error: 'Could not allocate a code — try again.' }, 503)

  const slot: Slot = { token, config: null }
  await env.PANEL_PAIR.put(kvKey(code), JSON.stringify(slot), { expirationTtl: CREATE_TTL_SECONDS })
  return json({ code: formatCode(code), token, expiresIn: CREATE_TTL_SECONDS })
}

// Phone submits the code (typed by the user) plus their Komga URL + key. We
// validate the URL here so the phone — with its real keyboard — gets the legible
// error, not the headset.
async function submitPair(request: Request, env: Env): Promise<Response> {
  let body: { code?: unknown; url?: unknown; key?: unknown }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return json({ error: 'Bad request.' }, 400)
  }
  const code = normalizeCode(String(body.code ?? ''))
  const cfgUrl = String(body.url ?? '').trim()
  const cfgKey = String(body.key ?? '').trim()

  if (code.length !== CODE_LEN) return json({ error: 'Enter the code shown on your headset.' }, 400)
  if (!cfgUrl || !cfgKey) return json({ error: 'Server URL and API key are both required.' }, 400)
  const up = checkUpstream(cfgUrl)
  if (!up.ok) return json({ error: `That Komga URL ${up.reason}.` }, 400)

  const rawSlot = await env.PANEL_PAIR.get(kvKey(code))
  if (!rawSlot) return json({ error: 'That code has expired — start again on the headset.' }, 404)

  const slot = JSON.parse(rawSlot) as Slot
  slot.config = { url: cfgUrl, key: cfgKey }
  await env.PANEL_PAIR.put(kvKey(code), JSON.stringify(slot), { expirationTtl: CLAIM_TTL_SECONDS })
  return json({ ok: true })
}

// Headset polls with its code + secret token. Pending until the phone submits;
// then it gets the config exactly once (the slot is burned on hand-over).
async function claimPair(url: URL, env: Env): Promise<Response> {
  const code = normalizeCode(url.searchParams.get('code') ?? '')
  const token = url.searchParams.get('token') ?? ''
  if (!code || !token) return json({ error: 'Bad request.' }, 400)

  const rawSlot = await env.PANEL_PAIR.get(kvKey(code))
  if (!rawSlot) return json({ status: 'expired' }, 404)

  const slot = JSON.parse(rawSlot) as Slot
  if (slot.token !== token) return json({ error: 'forbidden' }, 403)
  if (!slot.config) return json({ status: 'pending' })

  await env.PANEL_PAIR.delete(kvKey(code)) // single-use
  return json({ status: 'ready', url: slot.config.url, key: slot.config.key })
}

function randomCode(): string {
  const bytes = new Uint8Array(CODE_LEN)
  crypto.getRandomValues(bytes)
  let s = ''
  for (const b of bytes) s += CODE_ALPHABET[b % CODE_ALPHABET.length]
  return s
}

function randomHex(nBytes: number): string {
  const bytes = new Uint8Array(nBytes)
  crypto.getRandomValues(bytes)
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function normalizeCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

function kvKey(code: string): string {
  return `pair:${normalizeCode(code)}`
}

function formatCode(code: string): string {
  return code.length === 6 ? `${code.slice(0, 3)}-${code.slice(3)}` : code
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}
