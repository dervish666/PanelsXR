import { describe, it, expect } from 'vitest'
import { pairStart, visiblePages, nextIndex, prevIndex } from './pairing'

// Cover alone, then pairs 2-3, 4-5, … (0-indexed [0], [1,2], [3,4]).
describe('pairStart', () => {
  it('keeps the cover on its own', () => {
    expect(pairStart(0)).toBe(0)
  })
  it('pairs 1&2, 3&4, 5&6 to their first page', () => {
    expect(pairStart(1)).toBe(1)
    expect(pairStart(2)).toBe(1)
    expect(pairStart(3)).toBe(3)
    expect(pairStart(4)).toBe(3)
    expect(pairStart(5)).toBe(5)
    expect(pairStart(6)).toBe(5)
  })
})

describe('visiblePages', () => {
  it('single mode shows exactly one page', () => {
    expect(visiblePages(0, 10, false)).toEqual([0])
    expect(visiblePages(5, 10, false)).toEqual([5])
  })
  it('spread mode: cover alone, then pairs', () => {
    expect(visiblePages(0, 10, true)).toEqual([0])
    expect(visiblePages(1, 10, true)).toEqual([1, 2])
    expect(visiblePages(2, 10, true)).toEqual([1, 2])
    expect(visiblePages(3, 10, true)).toEqual([3, 4])
  })
  it('spread mode: a trailing odd page shows alone (no phantom page)', () => {
    // 4 pages [0,1,2,3]: pair starting at 3 has no partner
    expect(visiblePages(3, 4, true)).toEqual([3])
  })
  it('clamps an out-of-range index instead of returning junk', () => {
    expect(visiblePages(99, 10, false)).toEqual([9])
    expect(visiblePages(-5, 10, false)).toEqual([0])
  })
  it('is empty for a 0-page book (no phantom page)', () => {
    expect(visiblePages(0, 0, false)).toEqual([])
    expect(visiblePages(0, 0, true)).toEqual([])
  })
})

describe('nextIndex', () => {
  it('single mode advances one and clamps at the last page', () => {
    expect(nextIndex(0, 3, false)).toBe(1)
    expect(nextIndex(2, 3, false)).toBe(2) // already last
  })
  it('spread mode steps a whole pair', () => {
    expect(nextIndex(0, 10, true)).toBe(1) // cover → first pair
    expect(nextIndex(1, 10, true)).toBe(3) // pair 1-2 → 3-4
    expect(nextIndex(3, 10, true)).toBe(5)
  })
  it('never exceeds the last page in spread mode', () => {
    expect(nextIndex(3, 4, true)).toBe(3)
  })
  it('never returns a negative or NaN index for an empty book', () => {
    expect(nextIndex(0, 0, false)).toBe(0)
    expect(nextIndex(0, 0, true)).toBe(0)
  })
})

describe('prevIndex', () => {
  it('single mode steps back one and clamps at 0', () => {
    expect(prevIndex(1, false)).toBe(0)
    expect(prevIndex(0, false)).toBe(0)
  })
  it('spread mode steps back a pair, landing on the cover from the first pair', () => {
    expect(prevIndex(1, true)).toBe(0) // first pair → cover
    expect(prevIndex(3, true)).toBe(1) // 3-4 → 1-2
    expect(prevIndex(5, true)).toBe(3)
  })
  it('never goes negative', () => {
    expect(prevIndex(0, true)).toBe(0)
  })
})
