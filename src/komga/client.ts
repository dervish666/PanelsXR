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

// Page images are 1-indexed in Komga.
export function pageUrl(bookId: string, page: number): string {
  return `${BASE}/books/${bookId}/pages/${page}`
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
