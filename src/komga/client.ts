import type { KomgaBook, KomgaPage, KomgaSeries } from './types'

// All requests go through the dev-server proxy at /komga, which injects the
// X-API-Key header server-side (see vite.config.ts). Same-origin, so page
// image URLs work directly in <img>/textures — no fetch→blob dance needed.
const BASE = '/komga/api/v1'

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`Komga ${res.status} on ${path}`)
  return res.json() as Promise<T>
}

export async function listSeries(): Promise<KomgaSeries[]> {
  const page = await get<KomgaPage<KomgaSeries>>('/series?size=200&sort=metadata.titleSort,asc')
  return page.content
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
  const res = await fetch(`${BASE}/books/list?size=12&sort=readProgress.readDate,desc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      condition: { readStatus: { operator: 'is', value: 'IN_PROGRESS' } },
    }),
  })
  if (!res.ok) throw new Error(`Komga ${res.status} on /books/list`)
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
): Promise<void> {
  const res = await fetch(`${BASE}/books/${bookId}/read-progress`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ page, completed }),
  })
  // Progress sync is best-effort; log failures rather than breaking reading.
  if (!res.ok) console.error(`[Panel] progress save failed: ${res.status} on ${bookId}`)
}
