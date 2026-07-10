import type { KomgaBook, KomgaPage, KomgaSeries } from './types'

// All requests go through the dev-server proxy at /komga, which injects the
// X-API-Key header server-side (see vite.config.ts). Same-origin, so page
// image URLs work directly in <img>/textures — no fetch→blob dance needed.
const BASE = '/komga/api/v1'

// A Komga request that failed, carrying enough to show the user something
// actionable (status + the human message) rather than a raw internal string.
// status 0 = the request never reached Komga (network / CORS / tunnel down).
export class KomgaError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'KomgaError'
    this.status = status
  }
}

// Turn a status (and the server's response body, when present) into a line a
// human can act on. The container's fail-closed gate returns a helpful 503 body
// ("Set PANEL_PASSWORD…"); surface it instead of throwing it away.
export function humanKomgaError(status: number, body?: string): string {
  const trimmed = body?.trim()
  if (status === 0) return 'Couldn’t reach Komga — check the server is up and the connection.'
  if (status === 401 || status === 403) return 'Komga rejected the request — check the API key.'
  if (status === 503) {
    // The gate's own message is the most useful thing we can show.
    if (trimmed && trimmed.length < 400 && !trimmed.startsWith('<')) return trimmed
    return 'Panel isn’t unlocked yet — set PANEL_PASSWORD (or PANEL_AUTH=none) on the container.'
  }
  if (status >= 500) return 'Komga is having a problem (server error) — try again shortly.'
  return `Couldn’t load from Komga (error ${status}).`
}

const TIMEOUT_MS = 12_000 // a hung Komga (cold tunnel) shouldn't spin forever

async function request(path: string, init?: RequestInit): Promise<Response> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  let res: Response
  try {
    res = await fetch(`${BASE}${path}`, { ...init, signal: ctrl.signal })
  } catch (err) {
    // fetch rejects on network-level failure (Wi-Fi blip, tunnel cold, CORS) or
    // on our timeout abort — both are "couldn't reach Komga" to the user.
    const msg =
      err instanceof DOMException && err.name === 'AbortError'
        ? 'Komga didn’t respond in time — check the server and try again.'
        : humanKomgaError(0)
    throw new KomgaError(0, msg)
  } finally {
    clearTimeout(timer)
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new KomgaError(res.status, humanKomgaError(res.status, body))
  }
  return res
}

async function get<T>(path: string): Promise<T> {
  const res = await request(path, { headers: { Accept: 'application/json' } })
  return res.json() as Promise<T>
}

export async function listSeries(): Promise<KomgaSeries[]> {
  // size=500 gives headroom over the ~189 series today; Komga returns all in
  // one page (no client-side paging needed — the sphere paginates the display).
  const page = await get<KomgaPage<KomgaSeries>>('/series?size=500&sort=metadata.titleSort,asc')
  return page.content
}

export interface LetterBucket {
  letter: string // 'A'..'Z' or '#'
  series: KomgaSeries[]
}

// The index letter for a series: first character of the display name,
// uppercased; anything that isn't A–Z (digits, symbols, "2000 AD") → '#'.
export function letterOf(name: string): string {
  const c = (name.trim()[0] ?? '#').toUpperCase()
  return c >= 'A' && c <= 'Z' ? c : '#'
}

// Bucket series into A–Z stacks (+ '#' last) for the alphabetical shelf.
// Preserves the incoming order within each bucket (listSeries is titleSort,asc)
// and omits empty letters. Pure + headset-independent → unit-tested. On Sam's
// live library this yields ~21 buckets, V the fattest (~82, the "Volume NN"
// imports), '#' holding numeric-titled series like "2000 AD".
export function bucketSeriesByFirstLetter(series: KomgaSeries[]): LetterBucket[] {
  const map = new Map<string, KomgaSeries[]>()
  for (const s of series) {
    const k = letterOf(s.name)
    const arr = map.get(k)
    if (arr) arr.push(s)
    else map.set(k, [s])
  }
  return [...map.keys()]
    .sort((a, b) => (a === '#' ? 1 : b === '#' ? -1 : a < b ? -1 : 1))
    .map((letter) => ({ letter, series: map.get(letter)! }))
}

export async function listBooks(seriesId: string): Promise<KomgaBook[]> {
  const page = await get<KomgaPage<KomgaBook>>(
    `/series/${seriesId}/books?size=500&sort=metadata.numberSort,asc`,
  )
  // Only READY books have extracted pages to stream.
  return page.content.filter((b) => b.media.status === 'READY')
}

export function getBook(bookId: string): Promise<KomgaBook> {
  return get<KomgaBook>(`/books/${bookId}`)
}

// Books currently being read, most recently touched first — the "continue
// reading" shelf. Uses the newer POST /books/list search (more reliable than
// GET /books, which is fiddly about filters).
export async function listInProgress(): Promise<KomgaBook[]> {
  const res = await request('/books/list?size=12&sort=readProgress.readDate,desc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      condition: { readStatus: { operator: 'is', value: 'IN_PROGRESS' } },
    }),
  })
  const page = (await res.json()) as KomgaPage<KomgaBook>
  return page.content.filter((b) => b.media.status === 'READY')
}

// Komga's "on deck": the next unread book in series you've been reading.
export async function listOnDeck(): Promise<KomgaBook[]> {
  const page = await get<KomgaPage<KomgaBook>>('/books/ondeck?size=12')
  return page.content.filter((b) => b.media.status === 'READY')
}

// First unread book in a series (or just the first book if all are read) —
// what "open this series" means when picking a cover off the shelf sphere.
export async function firstUnreadBook(seriesId: string): Promise<KomgaBook | null> {
  const unread = await get<KomgaPage<KomgaBook>>(
    `/series/${seriesId}/books?read_status=UNREAD&size=1&sort=metadata.numberSort,asc`,
  )
  if (unread.content.length > 0) return unread.content[0]
  const any = await get<KomgaPage<KomgaBook>>(
    `/series/${seriesId}/books?size=1&sort=metadata.numberSort,asc`,
  )
  return any.content[0] ?? null
}

// Page images are 1-indexed in Komga.
export function pageUrl(bookId: string, page: number): string {
  return `${BASE}/books/${bookId}/pages/${page}`
}

export function seriesThumbUrl(seriesId: string): string {
  return `${BASE}/series/${seriesId}/thumbnail`
}

export function bookThumbUrl(bookId: string): string {
  return `${BASE}/books/${bookId}/thumbnail`
}

export function bookPageUrls(book: KomgaBook): string[] {
  return Array.from({ length: book.media.pagesCount }, (_, i) => pageUrl(book.id, i + 1))
}

export async function saveProgress(
  bookId: string,
  page: number, // 1-indexed
  completed: boolean,
  keepalive = false, // set when flushing on tab-hide so the request outlives the page
): Promise<void> {
  // Progress sync is best-effort; log failures rather than breaking reading.
  // Covers BOTH an HTTP error and a network-level fetch rejection (Wi-Fi blip on
  // the headset is the common case) — the latter used to escape as an unhandled
  // rejection through the fire-and-forget call site.
  try {
    const res = await fetch(`${BASE}/books/${bookId}/read-progress`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ page, completed }),
      keepalive,
    })
    if (!res.ok) console.error(`[Panel] progress save failed: ${res.status} on ${bookId}`)
  } catch (err) {
    console.error(`[Panel] progress save failed (network) on ${bookId}`, err)
  }
}
