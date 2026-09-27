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

// ---- panel mode -----------------------------------------------------------
//
// Panel ("exploded") reading steps through the detected panels of the visible
// pages one A-press at a time and rolls over to the next page at the end. The
// position is an index into the *slots* of the current view: one slot per
// detected panel, or a single whole-page slot (panel: null) for a page whose
// detector returned nothing. A spread lists the left page's slots then the
// right's. Detection is async, so an index may be resolved against a slot list
// that grows a moment later; -1 means "the last slot", used when stepping
// backwards onto a page whose panels may not be counted yet.

export interface PanelSlot {
  page: number
  panel: number | null // null = show the whole page (no lens)
}

export function panelSlots(visible: number[], countOf: (page: number) => number): PanelSlot[] {
  return visible.flatMap((page): PanelSlot[] => {
    const n = countOf(page)
    return n > 0
      ? Array.from({ length: n }, (_, panel) => ({ page, panel }))
      : [{ page, panel: null }]
  })
}

// Clamp a stored slot index to the current slot list (-1 = last).
export function resolveSlot(idx: number, total: number): number {
  if (total <= 0) return 0
  return idx < 0 ? total - 1 : Math.min(idx, total - 1)
}

// One step within the slots, or the page turn it spills into.
export function stepSlot(idx: number, total: number, dir: 1 | -1): { idx: number } | { turn: 1 | -1 } {
  const n = idx + dir
  if (n < 0) return { turn: -1 }
  if (n >= total) return { turn: 1 }
  return { idx: n }
}
