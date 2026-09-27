// Panel detection for "exploded" reading: find the rectangles of a comic page's
// panels by reading the gutters between them. Pure and browser-independent (an
// RGBA buffer in, normalised rects out) so it's unit-tested on synthetic pages
// (see panels.test.ts). `scanImage` at the bottom is the one browser helper
// that turns a decoded page into that buffer.
//
// Method: recursive XY-cut. Estimate the gutter colour from the page border,
// mask pixels that match it, then look for rows that are almost entirely
// gutter (a horizontal cut), split there, and repeat on columns inside each
// piece, alternating until nothing cuts. Rows-first recursion yields reading
// order for free: tiers top to bottom, panels left to right within a tier.
//
// It returns [] whenever it isn't confident: one region (splash or full-bleed
// art), more than MAX_PANELS (noise), or panels covering too little of the page.
// The reader then shows the whole page exactly as it does today. There is
// deliberately no tile/quarter fallback.

export interface PanelRect {
  x: number // left, 0..1 of page width
  y: number // top, 0..1 of page height (y grows downward, image convention)
  w: number
  h: number
}

export interface ScanImage {
  width: number
  height: number
  data: Uint8ClampedArray // RGBA, row-major, like ImageData.data
}

// ---- thresholds -----------------------------------------------------------

// Long edge of the downscaled page the detector reads. European albums
// (Blacksad: 21px gutters on a 3056px scan, 0.7%) need 600 for a gutter to
// survive the downscale as 3+ clean px; 300 missed every page of it. Same
// result as 800 at half the cost (~4ms).
export const SCAN_EDGE = 600
// How far (in 0..1 luminance) a pixel may sit from the gutter colour and still
// count as gutter. Tight on purpose: a pale lavender sky (lum 0.92) must read
// as ink, or a column through it and a white balloon cuts a panel in two.
const BG_TOLERANCE = 0.06
// Pixels with more chroma than this are ink even if their luminance matches.
const BG_MAX_CHROMA = 0.08
// Ridge rule for gutters thinner than a scan pixel: US floppies (Harley
// Quinn: 8px gutters on a 1988px scan) blend to a single grey pixel (lum ~0.7
// to 0.94) between two black borders at SCAN_EDGE 600. Such a pixel counts as
// gutter along an axis when it sits within RIDGE_TOL of the gutter colour and
// both its flanks (1 to 2px away along that axis) are RIDGE_FAR from it. The
// flanks are what panel frames provide and pale sky or a white balloon never do.
const RIDGE_TOL = 0.4
const RIDGE_MAX_CHROMA = 0.15
const RIDGE_FAR = 0.55
// A row/column is a gutter only when it is clean across the FULL span of the
// region: at most MAX_INK_PX stray ink pixels, and fewer on short spans (one
// per INK_PX_PER px, so a 1px-tall piece such as a balloon outline needs zero
// and cannot be trimmed away). An absolute count, not a fraction: a column
// through a framed panel crosses two frame lines (4+ px at SCAN_EDGE 600),
// which is what stops white balloons over pale art reading as gutters, while a
// real gutter nicked by a balloon outline carries 2 or 3 (Blacksad p13, p51).
const MAX_INK_PX = 3
const INK_PX_PER = 50
// Minimum gutter thickness in scan pixels. One clean row is enough: US
// floppies (Harley Quinn: 8-9px gutters on a 3057px scan, 0.29%) shrink to a
// single clean row at SCAN_EDGE 600 between two blended grey rows, and stay a
// single row up to 900. The full-span ink budget is what makes a 1px run safe:
// a row through a framed panel can never be clean.
const MIN_GUTTER_PX = 1
// Minimum panel edge, as a fraction of the page dimension it lies along. A cut
// piece thinner than this is not dropped: it merges into its neighbour.
const MIN_PANEL_FRAC = 0.1
// Border band sampled for the gutter colour, as a fraction of each dimension.
const BORDER_FRAC = 0.02
// The detected panels must cover at least this much of the page's INK EXTENT
// (the page trimmed of its margins, not the whole page) or the result is noise.
// Relative to the ink extent because a newspaper-strip collection floats two
// small strips on a mostly white page (Calvin and Hobbes: 27% of the page).
const MIN_COVERAGE = 0.35
// Recursion guard; real pages cut 2 to 4 levels deep.
const MAX_DEPTH = 10
export const MAX_PANELS = 12

// ---- pixel helpers --------------------------------------------------------

interface Region {
  x0: number
  y0: number
  x1: number // exclusive
  y1: number // exclusive
}

function luminance(data: Uint8ClampedArray, i: number): number {
  return (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255
}

function chroma(data: Uint8ClampedArray, i: number): number {
  const r = data[i]
  const g = data[i + 1]
  const b = data[i + 2]
  return (Math.max(r, g, b) - Math.min(r, g, b)) / 255
}

// Median luminance of the border band: comic gutters share the page's margin
// colour, whether that's white paper, yellowed scan or the black of a
// dark-gutter book. Sampled every other pixel; it's a median, not a census.
export function estimateBackground(img: ScanImage): number {
  const { width, height, data } = img
  const bx = Math.max(1, Math.round(width * BORDER_FRAC))
  const by = Math.max(1, Math.round(height * BORDER_FRAC))
  const samples: number[] = []
  for (let y = 0; y < height; y += 2) {
    const edgeRow = y < by || y >= height - by
    for (let x = 0; x < width; x += 2) {
      if (!edgeRow && x >= bx && x < width - bx) continue
      samples.push(luminance(data, (y * width + x) * 4))
    }
  }
  samples.sort((a, b) => a - b)
  return samples.length ? samples[samples.length >> 1] : 1
}

// Two ink masks (1 = ink), one per test axis: `rows` is read when judging a
// row (horizontal gutter), `cols` when judging a column. They differ only by
// the ridge rule, whose flanks lie along the axis being tested.
interface InkMasks {
  rows: Uint8Array
  cols: Uint8Array
}

function inkMasks(img: ScanImage, bg: number): InkMasks {
  const { width, height, data } = img
  const n = width * height
  const lum = new Float32Array(n)
  const chr = new Float32Array(n)
  for (let p = 0; p < n; p++) {
    lum[p] = luminance(data, p * 4)
    chr[p] = chroma(data, p * 4)
  }
  // 1 = far from the gutter colour (a frame line), precomputed so the ridge
  // test below is four array reads rather than four closure calls.
  const far = new Uint8Array(n)
  for (let p = 0; p < n; p++) if (Math.abs(lum[p] - bg) >= RIDGE_FAR) far[p] = 1
  const rows = new Uint8Array(n)
  const cols = new Uint8Array(n)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x
      const d = Math.abs(lum[p] - bg)
      if (d <= BG_TOLERANCE && chr[p] <= BG_MAX_CHROMA) continue // gutter on both axes
      let ridgeY = false
      let ridgeX = false
      if (d <= RIDGE_TOL && chr[p] <= RIDGE_MAX_CHROMA) {
        ridgeY =
          y >= 2 && y < height - 2 &&
          (far[p - width] | far[p - 2 * width]) === 1 &&
          (far[p + width] | far[p + 2 * width]) === 1
        ridgeX =
          x >= 2 && x < width - 2 &&
          (far[p - 1] | far[p - 2]) === 1 &&
          (far[p + 1] | far[p + 2]) === 1
      }
      if (!ridgeY) rows[p] = 1
      if (!ridgeX) cols[p] = 1
    }
  }
  return { rows, cols }
}

// Ink pixel count per row (axis 'y') or column (axis 'x') inside the region.
function profile(m: InkMasks, width: number, r: Region, axis: 'x' | 'y'): Uint32Array {
  const mask = axis === 'y' ? m.rows : m.cols
  const counts = new Uint32Array(axis === 'y' ? r.y1 - r.y0 : r.x1 - r.x0)
  for (let y = r.y0; y < r.y1; y++) {
    const row = y * width
    for (let x = r.x0; x < r.x1; x++) {
      if (mask[row + x]) counts[axis === 'y' ? y - r.y0 : x - r.x0]++
    }
  }
  return counts
}

const isGutter = (ink: number, span: number) => ink <= Math.min(MAX_INK_PX, Math.floor(span / INK_PX_PER))

// Strip only strict gutter rows/columns from the outside in, so margins never
// read as gutters and a leaf's rect hugs its panel. Uses the same full-span
// test as a cut: a row through a white balloon at a panel's edge still holds
// the balloon's outline and text, so it stays. null = the region is all gutter.
function trim(mask: InkMasks, width: number, r: Region): Region | null {
  let { x0, y0, x1, y1 } = r
  const rows = profile(mask, width, r, 'y')
  while (y0 < y1 && isGutter(rows[y0 - r.y0], x1 - x0)) y0++
  while (y1 > y0 && isGutter(rows[y1 - 1 - r.y0], x1 - x0)) y1--
  if (y0 >= y1) return null
  const cols = profile(mask, width, { x0, y0, x1, y1 }, 'x')
  while (x0 < x1 && isGutter(cols[x0 - r.x0], y1 - y0)) x0++
  while (x1 > x0 && isGutter(cols[x1 - 1 - r.x0], y1 - y0)) x1--
  if (x0 >= x1) return null
  return { x0, y0, x1, y1 }
}

// Centres of gutter runs strictly inside the (trimmed) span, at least minRun thick.
function gutterCentres(prof: Uint32Array, span: number, minRun: number): number[] {
  const cuts: number[] = []
  let start = -1
  for (let k = 0; k <= prof.length; k++) {
    const clear = k < prof.length && isGutter(prof[k], span)
    if (clear && start < 0) start = k
    if (!clear && start >= 0) {
      const len = k - start
      if (len >= minRun && start > 0 && k < prof.length) cuts.push(start + (len >> 1))
      start = -1
    }
  }
  return cuts
}

function union(a: Region, b: Region): Region {
  return {
    x0: Math.min(a.x0, b.x0),
    y0: Math.min(a.y0, b.y0),
    x1: Math.max(a.x1, b.x1),
    y1: Math.max(a.y1, b.y1),
  }
}

interface Ctx {
  mask: InkMasks
  img: ScanImage
  minRun: number
  minW: number
  minH: number
  out: Region[]
  left: number // panel budget
}

// A stray mark smaller than a panel in both directions (a page number in the
// margin, a speck) is the only ink that may be dropped.
function isSpeck(c: Ctx, r: Region): boolean {
  return r.x1 - r.x0 < c.minW && r.y1 - r.y0 < c.minH
}

// Split a trimmed region along one axis at its gutters. Every piece of ink ends
// up in some segment: a piece too thin to be a panel merges into its neighbour
// rather than vanishing (that dropped the right half of a row once). Returns
// null when the axis yields fewer than two segments, i.e. no cut.
function segmentsAlong(c: Ctx, r: Region, axis: 'x' | 'y'): Region[] | null {
  const span = axis === 'y' ? r.x1 - r.x0 : r.y1 - r.y0
  const cuts = gutterCentres(profile(c.mask, c.img.width, r, axis), span, c.minRun)
  if (cuts.length === 0) return null
  const lo0 = axis === 'y' ? r.y0 : r.x0
  const hi = axis === 'y' ? r.y1 : r.x1
  const minAlong = axis === 'y' ? c.minH : c.minW
  const kept: Region[] = []
  let thin: Region | null = null
  let lo = lo0
  for (const cut of [...cuts.map((k) => k + lo0), hi]) {
    const seg: Region = axis === 'y' ? { ...r, y0: lo, y1: cut } : { ...r, x0: lo, x1: cut }
    lo = cut
    const t = trim(c.mask, c.img.width, seg)
    if (!t) continue // pure gutter
    if (isSpeck(c, t)) continue
    const along = axis === 'y' ? t.y1 - t.y0 : t.x1 - t.x0
    if (along < minAlong) {
      // a strip: join the panel before it, or hold it for the panel after
      if (kept.length) kept[kept.length - 1] = union(kept[kept.length - 1], t)
      else thin = thin ? union(thin, t) : t
      continue
    }
    kept.push(thin ? union(thin, t) : t)
    thin = null
  }
  if (thin) {
    if (kept.length) kept[kept.length - 1] = union(kept[kept.length - 1], thin)
    else kept.push(thin)
  }
  return kept.length >= 2 ? kept : null
}

function xyCut(c: Ctx, region: Region, axis: 'y' | 'x', depth: number): void {
  if (c.left <= 0) return
  const r = trim(c.mask, c.img.width, region)
  if (!r || isSpeck(c, r)) return
  if (depth < MAX_DEPTH) {
    // Try the requested axis first, then the other; a leaf cuts on neither.
    const order: Array<'y' | 'x'> = axis === 'y' ? ['y', 'x'] : ['x', 'y']
    for (const a of order) {
      const segs = segmentsAlong(c, r, a)
      if (!segs) continue
      const next = a === 'y' ? 'x' : 'y'
      for (const s of segs) xyCut(c, s, next, depth + 1)
      return
    }
  }
  c.out.push(r)
  c.left--
}

// The panels of a page in reading order (left-to-right, top-to-bottom), or []
// when the page doesn't split cleanly. Callers treat [] as "show the whole page".
export function detectPanels(img: ScanImage): PanelRect[] {
  if (img.width < 8 || img.height < 8) return []
  const bg = estimateBackground(img)
  const mask = inkMasks(img, bg)
  const leaves: Region[] = []
  const c: Ctx = {
    mask,
    img,
    minRun: MIN_GUTTER_PX,
    minW: img.width * MIN_PANEL_FRAC,
    minH: img.height * MIN_PANEL_FRAC,
    out: leaves,
    // One over the cap so "too many" is distinguishable from "exactly the cap".
    left: MAX_PANELS + 1,
  }
  const page: Region = { x0: 0, y0: 0, x1: img.width, y1: img.height }
  const extent = trim(mask, img.width, page)
  if (!extent) return []
  xyCut(c, extent, 'y', 0)
  if (leaves.length < 2 || leaves.length > MAX_PANELS) return []
  const area = leaves.reduce((s, r) => s + (r.x1 - r.x0) * (r.y1 - r.y0), 0)
  if (area / ((extent.x1 - extent.x0) * (extent.y1 - extent.y0)) < MIN_COVERAGE) return []
  return leaves.map((r) => ({
    x: r.x0 / img.width,
    y: r.y0 / img.height,
    w: (r.x1 - r.x0) / img.width,
    h: (r.y1 - r.y0) / img.height,
  }))
}

// Browser helper: downscale a decoded page to SCAN_EDGE on its long side and
// hand back the RGBA buffer the detector reads. Same canvas pattern PageSurface
// uses for the ambience colour. No `willReadFrequently`: that hint makes the
// canvas CPU-backed, so the downscale of a 13MP scan costs 9-12ms instead of
// 2-5ms (measured in Chrome on Calvin and Hobbes p40), and we read it once.
// The first drawImage of an image also decodes it (100-250ms for a big PNG);
// in the reader that decode is shared with the texture upload.
export function scanImage(img: HTMLImageElement | HTMLCanvasElement, edge = SCAN_EDGE): ScanImage {
  const iw = img.width
  const ih = img.height
  const scale = Math.min(1, edge / Math.max(iw, ih))
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(iw * scale))
  c.height = Math.max(1, Math.round(ih * scale))
  const ctx = c.getContext('2d')!
  ctx.drawImage(img, 0, 0, c.width, c.height)
  const { data } = ctx.getImageData(0, 0, c.width, c.height)
  return { width: c.width, height: c.height, data }
}
