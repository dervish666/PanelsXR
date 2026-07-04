import { describe, it, expect } from 'vitest'
import {
  pageUrl,
  seriesThumbUrl,
  bookThumbUrl,
  bookPageUrls,
  letterOf,
  bucketSeriesByFirstLetter,
} from './client'
import type { KomgaBook, KomgaSeries } from './types'

const s = (name: string): KomgaSeries => ({
  id: name,
  name,
  booksCount: 1,
  booksUnreadCount: 0,
})

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

// The alphabetical shelf buckets by the first letter of the display name. This
// must match what the reader sees (so a stack's letter == the covers' initials)
// and cope with Sam's messy real metadata: numeric titles ("2000 AD"), the
// "Volume NN" clump, mixed case, and stray whitespace.
describe('letterOf', () => {
  it('uppercases the first letter', () => {
    expect(letterOf('Blacksad')).toBe('B')
    expect(letterOf('alice never after')).toBe('A')
  })
  it('trims leading whitespace before reading the letter', () => {
    expect(letterOf('  Dune')).toBe('D')
  })
  it('files digits and symbols under #', () => {
    expect(letterOf('2000 AD (1977)')).toBe('#')
    expect(letterOf('.hack')).toBe('#')
    expect(letterOf('éclair')).toBe('#') // non-ASCII letters aren't A–Z
  })
  it('never throws on an empty name', () => {
    expect(letterOf('')).toBe('#')
    expect(letterOf('   ')).toBe('#')
  })
})

describe('bucketSeriesByFirstLetter', () => {
  it('groups by initial, sorts letters A→Z with # last, omits empty letters', () => {
    const buckets = bucketSeriesByFirstLetter([
      s('2000 AD (1977)'),
      s('Blacksad'),
      s('Alice Never After'),
      s('Volume 01 (2021)'),
      s('Absolute Batman'),
      s('Volume 02 (2021)'),
    ])
    expect(buckets.map((b) => b.letter)).toEqual(['A', 'B', 'V', '#'])
    expect(buckets.find((b) => b.letter === 'A')!.series.map((x) => x.name)).toEqual([
      'Alice Never After',
      'Absolute Batman',
    ])
    // the "Volume NN" imports clump under V, just like Sam's live library
    expect(buckets.find((b) => b.letter === 'V')!.series).toHaveLength(2)
  })

  it('preserves input order within a bucket (listSeries is titleSort,asc)', () => {
    const buckets = bucketSeriesByFirstLetter([s('Dune'), s('Daredevil'), s('DC')])
    expect(buckets).toHaveLength(1)
    expect(buckets[0].series.map((x) => x.name)).toEqual(['Dune', 'Daredevil', 'DC'])
  })

  it('is empty for an empty library', () => {
    expect(bucketSeriesByFirstLetter([])).toEqual([])
  })

  it('every series lands in exactly one bucket (no drops, no dupes)', () => {
    const input = ['Zap', 'zebra', '9 Lives', 'Yorick', 'Yes'].map(s)
    const buckets = bucketSeriesByFirstLetter(input)
    const flat = buckets.flatMap((b) => b.series)
    expect(flat).toHaveLength(input.length)
  })
})
