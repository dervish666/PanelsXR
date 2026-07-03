// Minimal shapes for the Komga v1 API — only the fields we actually read.
// Authoritative source: the live Swagger at {KOMGA_URL}/swagger-ui.html.

export interface KomgaPage<T> {
  content: T[]
  totalElements: number
  last: boolean
}

export interface KomgaSeries {
  id: string
  name: string
  booksCount: number
  booksUnreadCount: number
}

export interface KomgaReadProgress {
  page: number // 1-indexed
  completed: boolean
}

export interface KomgaBook {
  id: string
  seriesId: string
  name: string
  number: number
  media: {
    status: string // READY | ERROR | ...
    pagesCount: number
  }
  readProgress: KomgaReadProgress | null
}
