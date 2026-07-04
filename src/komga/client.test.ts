import { describe, it, expect } from 'vitest'
import { pageUrl, seriesThumbUrl, bookThumbUrl, bookPageUrls } from './client'
import type { KomgaBook } from './types'

// Komga pages are 1-indexed. An off-by-one here is a silent reader bug — the
// first page is skipped or the last page 404s — so these guard the invariant.
describe('Komga URL builders', () => {
  it('pageUrl is 1-indexed and same-origin via the /komga proxy', () => {
    expect(pageUrl('bk1', 1)).toBe('/komga/api/v1/books/bk1/pages/1')
    expect(pageUrl('bk1', 42)).toBe('/komga/api/v1/books/bk1/pages/42')
  })

  it('thumbnail URLs point at the right resource', () => {
    expect(seriesThumbUrl('s1')).toBe('/komga/api/v1/series/s1/thumbnail')
    expect(bookThumbUrl('bk1')).toBe('/komga/api/v1/books/bk1/thumbnail')
  })

  it('bookPageUrls yields one 1-indexed URL per page, in order', () => {
    const book = { id: 'bk1', media: { pagesCount: 3 } } as KomgaBook
    expect(bookPageUrls(book)).toEqual([
      '/komga/api/v1/books/bk1/pages/1',
      '/komga/api/v1/books/bk1/pages/2',
      '/komga/api/v1/books/bk1/pages/3',
    ])
  })

  it('bookPageUrls is empty for a zero-page book (no phantom page 1)', () => {
    const book = { id: 'bk1', media: { pagesCount: 0 } } as KomgaBook
    expect(bookPageUrls(book)).toEqual([])
  })
})
