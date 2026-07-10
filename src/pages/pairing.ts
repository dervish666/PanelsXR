// Page-pairing + turn arithmetic for the reader. Pure and headset-independent,
// so it's unit-tested (see pairing.test.ts) — this is the logic behind the
// resume/progress behaviour, and a regression here is a silent reader bug.
//
// Spread pairing: the cover stands alone, then pages pair 2-3, 4-5, …
// (0-indexed: [0], [1,2], [3,4] …). `pairStart` maps any index to its pair's
// first page.

export function pairStart(i: number): number {
  return i === 0 ? 0 : i - ((i - 1) % 2)
}

// The visible page indices for the current position: 1 page in single mode (or
// on the cover), 2 in spread mode. Always clamped to the available pages.
export function visiblePages(index: number, pageCount: number, spread: boolean): number[] {
  if (pageCount <= 0) return []
  const i = Math.max(0, Math.min(index, pageCount - 1))
  if (!spread || i === 0) return [i]
  const s = pairStart(i)
  return s + 1 < pageCount ? [s, s + 1] : [s]
}

// Next reading position (index of the first visible page), clamped to the last
// page. In spread mode we step a whole pair at a time.
export function nextIndex(index: number, pageCount: number, spread: boolean): number {
  if (pageCount <= 0) return 0
  const last = pageCount - 1
  if (!spread) return Math.min(index + 1, last)
  return Math.min(index === 0 ? 1 : pairStart(index) + 2, last)
}

// Previous reading position, clamped to 0.
export function prevIndex(index: number, spread: boolean): number {
  if (!spread) return Math.max(index - 1, 0)
  const s = pairStart(index)
  return Math.max(s <= 1 ? 0 : s - 2, 0)
}
