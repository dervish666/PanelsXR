import { describe, expect, it } from 'vitest'
import { detectPanels, estimateBackground, MAX_PANELS } from './panels'
import type { PanelRect, ScanImage } from './panels'

// Synthetic pages: a flat background with solid panel blocks. Detection only
// reads luminance/chroma so flat grey "art" is enough to stand in for ink.
type RGB = [number, number, number]
const WHITE: RGB = [255, 255, 255]
const BLACK: RGB = [0, 0, 0]
const ART: RGB = [110, 110, 110]

function page(width: number, height: number, bg: RGB): ScanImage {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let p = 0; p < width * height; p++) data.set([...bg, 255], p * 4)
  return { width, height, data }
}

function fill(img: ScanImage, x: number, y: number, w: number, h: number, rgb: RGB) {
  for (let yy = y; yy < y + h; yy++) {
    for (let xx = x; xx < x + w; xx++) {
      if (xx < 0 || yy < 0 || xx >= img.width || yy >= img.height) continue
      img.data.set([...rgb, 255], (yy * img.width + xx) * 4)
    }
  }
}

// Panel rect back in pixels, rounded, for readable assertions.
function px(img: ScanImage, r: PanelRect) {
  return {
    x: Math.round(r.x * img.width),
    y: Math.round(r.y * img.height),
    w: Math.round(r.w * img.width),
    h: Math.round(r.h * img.height),
  }
}

// A W x H page with margin m and gutter g, cols x rows grid of ART panels.
function grid(cols: number, rows: number, bg: RGB, ink: RGB, W = 200, H = 300, m = 10, g = 6) {
  const img = page(W, H, bg)
  const pw = (W - 2 * m - g * (cols - 1)) / cols
  const ph = (H - 2 * m - g * (rows - 1)) / rows
  const cells: Array<{ x: number; y: number; w: number; h: number }> = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cell = {
        x: Math.round(m + c * (pw + g)),
        y: Math.round(m + r * (ph + g)),
        w: Math.round(pw),
        h: Math.round(ph),
      }
      fill(img, cell.x, cell.y, cell.w, cell.h, ink)
      cells.push(cell)
    }
  }
  return { img, cells }
}

describe('estimateBackground', () => {
  it('reads white paper from the border', () => {
    expect(estimateBackground(page(50, 50, WHITE))).toBeCloseTo(1, 2)
  })
  it('reads a black-gutter page from the border', () => {
    expect(estimateBackground(page(50, 50, BLACK))).toBeCloseTo(0, 2)
  })
})

describe('detectPanels', () => {
  it('finds a clean 2x3 grid, hugging each panel, in reading order', () => {
    const { img, cells } = grid(2, 3, WHITE, ART)
    const found = detectPanels(img).map((r) => px(img, r))
    expect(found).toHaveLength(6)
    found.forEach((f, k) => {
      expect(Math.abs(f.x - cells[k].x)).toBeLessThanOrEqual(1)
      expect(Math.abs(f.y - cells[k].y)).toBeLessThanOrEqual(1)
      expect(Math.abs(f.w - cells[k].w)).toBeLessThanOrEqual(1)
      expect(Math.abs(f.h - cells[k].h)).toBeLessThanOrEqual(1)
    })
  })

  it('handles staggered tiers (2 panels over 3) in reading order', () => {
    const img = page(200, 300, WHITE)
    // tier 1: two panels, tier 2: three panels, different column gutters
    fill(img, 10, 10, 87, 130, ART)
    fill(img, 103, 10, 87, 130, ART)
    fill(img, 10, 150, 56, 140, ART)
    fill(img, 72, 150, 56, 140, ART)
    fill(img, 134, 150, 56, 140, ART)
    const found = detectPanels(img).map((r) => px(img, r))
    expect(found.map((f) => [f.x, f.y])).toEqual([
      [10, 10],
      [103, 10],
      [10, 150],
      [72, 150],
      [134, 150],
    ])
  })

  it('finds panels separated by black gutters', () => {
    const { img } = grid(2, 2, BLACK, ART)
    expect(detectPanels(img)).toHaveLength(4)
  })

  it('returns [] for a full-bleed page (no gutters)', () => {
    const img = page(200, 300, WHITE)
    fill(img, 0, 0, 200, 300, ART)
    expect(detectPanels(img)).toEqual([])
  })

  it('returns [] for a splash page (one bordered panel)', () => {
    const img = page(200, 300, WHITE)
    fill(img, 10, 10, 180, 280, ART)
    expect(detectPanels(img)).toEqual([])
  })

  it('returns [] when one panel fills most of the page (a merge the lens would barely lift)', () => {
    const img = page(200, 300, WHITE)
    fill(img, 10, 10, 180, 230, ART) // 83% of the ink extent
    fill(img, 10, 246, 180, 40, ART)
    expect(detectPanels(img)).toEqual([])
  })

  it('returns [] for a blank page', () => {
    expect(detectPanels(page(200, 300, WHITE))).toEqual([])
  })

  it('merges two panels when a blob crosses their gutter, keeps the rest', () => {
    const { img, cells } = grid(2, 2, WHITE, ART)
    // a "balloon" spanning the horizontal gutter in the left column
    const left = cells[0]
    fill(img, left.x + 20, left.y + left.h - 4, 40, 16, ART)
    const found = detectPanels(img).map((r) => px(img, r))
    expect(found).toHaveLength(3)
    // the merged left column spans the full page height of both cells
    const merged = found.find((f) => f.x === left.x)!
    expect(merged.h).toBeGreaterThanOrEqual(cells[2].y + cells[2].h - left.y - 1)
  })

  it('still cuts a gutter nicked by a thin mark (within the ink-pixel budget)', () => {
    const { img, cells } = grid(1, 2, WHITE, ART)
    // 1px-wide line across the gutter: 1 ink px per row, under MAX_INK_PX.
    // Blacksad p13/p51 gutters carry 2-3 px from a balloon outline.
    fill(img, cells[0].x + 30, cells[0].y + cells[0].h, 1, 6, ART)
    expect(detectPanels(img)).toHaveLength(2)
  })

  it('does not cut a gutter a thick mark crosses (over the budget)', () => {
    const { img, cells } = grid(1, 2, WHITE, ART)
    fill(img, cells[0].x + 30, cells[0].y + cells[0].h, 5, 6, ART)
    expect(detectPanels(img)).toEqual([])
  })

  // Pale-art regressions from Blacksad p50/p51: a lavender sky (lum ~0.92) and
  // white balloons used to read as gutter, which trimmed balloons off panel
  // edges and cut panels through the sky.
  const PALE: RGB = [232, 228, 246]
  const FRAME = 2

  // A framed panel with a pale interior.
  function palePanel(img: ScanImage, x: number, y: number, w: number, h: number) {
    fill(img, x, y, w, h, BLACK)
    fill(img, x + FRAME, y + FRAME, w - 2 * FRAME, h - 2 * FRAME, PALE)
  }

  // A white balloon with a 1px outline and a few lines of "text".
  function balloon(img: ScanImage, x: number, y: number, w: number, h: number) {
    fill(img, x, y, w, h, BLACK)
    fill(img, x + 1, y + 1, w - 2, h - 2, WHITE)
    for (let ty = y + 5; ty < y + h - 4; ty += 4) fill(img, x + 6, ty, w - 12, 1, BLACK)
  }

  it('keeps a white balloon that hangs off a pale panel edge inside the rect', () => {
    const img = page(400, 600, WHITE)
    palePanel(img, 20, 20, 360, 250)
    palePanel(img, 20, 290, 360, 250)
    // balloon straddling the top frame of panel 1, and one hanging below panel 2
    balloon(img, 60, 8, 140, 50)
    balloon(img, 200, 520, 150, 60)
    const found = detectPanels(img).map((r) => px(img, r))
    expect(found).toHaveLength(2)
    expect(found[0].y).toBe(8) // top balloon kept
    expect(found[1].y + found[1].h).toBe(580) // bottom balloon kept
  })

  it('does not cut a pale panel through a white balloon and pale sky', () => {
    const img = page(400, 600, WHITE)
    palePanel(img, 20, 20, 360, 250)
    palePanel(img, 20, 290, 360, 250)
    // a white column of "sky" plus a balloon inside panel 2: every column
    // through it still crosses the frame, so it is not a gutter
    fill(img, 200, 292, 60, 246, WHITE)
    balloon(img, 190, 320, 80, 60)
    const found = detectPanels(img).map((r) => px(img, r))
    expect(found).toHaveLength(2)
    expect(found[1].w).toBe(360)
  })

  it('never drops a thin cut piece: it merges into its neighbour', () => {
    const img = page(400, 600, WHITE)
    palePanel(img, 20, 20, 360, 250)
    // tier 2: a wide panel and a strip too narrow to be a panel on its own
    palePanel(img, 20, 290, 320, 250)
    palePanel(img, 350, 290, 30, 250)
    const found = detectPanels(img).map((r) => px(img, r))
    expect(found).toHaveLength(2)
    expect(found[1].x + found[1].w).toBe(380) // strip is inside panel 2's rect
  })

  it('drops a page number in the margin rather than merging it', () => {
    const { img } = grid(2, 2, WHITE, ART, 200, 300, 10, 6)
    fill(img, 96, 294, 6, 4, BLACK)
    const found = detectPanels(img).map((r) => px(img, r))
    expect(found).toHaveLength(4)
    expect(Math.max(...found.map((f) => f.y + f.h))).toBe(290)
  })

  it('cuts a thin European-album gutter (0.7% of the page height)', () => {
    // Blacksad: 21px gutters on a 3056px scan. At a 600px scan that is 4px;
    // the first cut of the detector (300px, 1.2% min gutter) missed every page.
    const { img } = grid(2, 3, WHITE, ART, 460, 600, 12, 4)
    expect(detectPanels(img)).toHaveLength(6)
  })

  it('cuts a 1px gutter between thick black borders (US floppy at scan scale)', () => {
    // Harley Quinn 045 p6: 8-9px gutters on a 3057px scan land as ONE clean row
    // at SCAN_EDGE 600, with a blended grey row either side. Top panel full
    // width, two below, 6px black borders, 1px white gutters, grey neighbours.
    const img = page(390, 600, WHITE)
    const GREY: RGB = [180, 180, 180]
    function bordered(x: number, y: number, w: number, h: number) {
      fill(img, x, y, w, h, BLACK)
      fill(img, x + 6, y + 6, w - 12, h - 12, ART)
    }
    bordered(20, 20, 350, 320)
    bordered(20, 343, 170, 237)
    bordered(193, 343, 177, 237)
    // the blended rows/cols that the downscale leaves either side of the gutter
    fill(img, 20, 340, 350, 1, GREY)
    fill(img, 20, 342, 350, 1, GREY)
    fill(img, 190, 343, 1, 237, GREY)
    fill(img, 192, 343, 1, 237, GREY)
    const found = detectPanels(img).map((r) => px(img, r))
    // the grey row/col on the far side of the cut stays with its panel
    expect(found.map((f) => [f.x, f.y])).toEqual([
      [20, 20],
      [20, 342],
      [192, 342],
    ])
  })

  // Newspaper-strip collection (Calvin and Hobbes): two small 4-panel strips
  // floating on a mostly white page, 27% of its area, with open (frameless)
  // panels whose text and figures just sit in white space.
  function strip(img: ScanImage, y: number, frames: boolean[]) {
    const xs = [60, 150, 240, 330]
    xs.forEach((x, k) => {
      if (frames[k]) {
        fill(img, x, y, 80, 100, BLACK)
        fill(img, x + 2, y + 2, 76, 96, WHITE)
      }
      // a figure and two lines of lettering, inside the panel's footprint
      fill(img, x + 20, y + 40, 30, 50, ART)
      fill(img, x + 8, y + 10, 60, 2, BLACK)
      fill(img, x + 8, y + 16, 50, 2, BLACK)
    })
  }

  it('finds two small strips on a big white page (coverage is relative to ink)', () => {
    const img = page(464, 600, WHITE)
    strip(img, 175, [true, true, true, true])
    strip(img, 315, [true, true, true, true])
    const found = detectPanels(img).map((r) => px(img, r))
    expect(found).toHaveLength(8)
    expect(found.map((f) => [f.x, f.y])).toEqual([
      [60, 175], [150, 175], [240, 175], [330, 175],
      [60, 315], [150, 315], [240, 315], [330, 315],
    ])
  })

  it('boxes a frameless panel around its text and figure', () => {
    const img = page(464, 600, WHITE)
    strip(img, 175, [true, true, false, true])
    strip(img, 315, [true, false, true, true])
    // a signature in the gutter under the top strip, like WATTERSON
    fill(img, 300, 282, 40, 3, BLACK)
    const found = detectPanels(img).map((r) => px(img, r))
    expect(found).toHaveLength(8)
    // the open panel's box hugs its lettering (x+8, y+10) and figure
    expect(found[2]).toEqual({ x: 248, y: 185, w: 60, h: 80 })
    expect(found[5]).toEqual({ x: 158, y: 325, w: 60, h: 80 })
  })

  it('returns [] above the panel cap', () => {
    const { img } = grid(4, 5, WHITE, ART, 400, 600, 8, 6)
    expect(20).toBeGreaterThan(MAX_PANELS)
    expect(detectPanels(img)).toEqual([])
  })

  it('ignores a coloured wash as gutter (chroma is ink)', () => {
    // a saturated red page whose luminance is close to grey ART: still one region
    const img = page(200, 300, [200, 30, 30])
    expect(detectPanels(img)).toEqual([])
  })
})
