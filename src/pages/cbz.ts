import JSZip from 'jszip'

export const IMAGE_RE = /\.(png|jpe?g|gif|webp|avif|bmp)$/i

// macOS Finder-zipped archives (the owner is on a Mac) carry an AppleDouble
// resource fork per file — "__MACOSX/._page01.png" — which passes the
// extension test but isn't a real image. Left in, it inflates the page count
// ~2× with entries that fail to decode (phantom dark pages).
function isMacJunk(name: string): boolean {
  const base = name.split('/').pop() ?? name
  return name.startsWith('__MACOSX/') || base.startsWith('._')
}

// Pick the image entries from a .cbz's file list and order them the way a reader
// expects: image files only, natural-sorted so "page2" comes before "page10".
// Extracted as a pure function so the page-ordering — the regression-prone bit —
// is unit-testable without a File/JSZip/browser (see cbz.test.ts).
export function orderCbzImageNames(names: string[]): string[] {
  return names
    .filter((name) => IMAGE_RE.test(name) && !isMacJunk(name))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
}

// Guards against a hostile (or just enormous) archive exhausting browser memory
// — everything is decompressed eagerly into object URLs before reading starts,
// which is worst on the memory-constrained Quest browser.
const MAX_PAGES = 2000
const MAX_TOTAL_BYTES = 600 * 1024 * 1024 // 600 MB uncompressed

// Load a local .cbz (a ZIP of images) so you can read a comic without a server
// (Komga serves page images directly, so this is only the local-file path).
export async function loadCbz(file: File): Promise<string[]> {
  const zip = await JSZip.loadAsync(file)

  const nameOrder = orderCbzImageNames(
    Object.values(zip.files)
      .filter((f) => !f.dir)
      .map((f) => f.name),
  )
  if (nameOrder.length > MAX_PAGES) {
    throw new Error(`That archive has ${nameOrder.length} images — too many to open safely.`)
  }
  const byName = new Map(Object.values(zip.files).map((f) => [f.name, f]))
  const entries = nameOrder.map((name) => byName.get(name)!)

  const urls: string[] = []
  let total = 0
  for (const entry of entries) {
    const blob = await entry.async('blob')
    total += blob.size
    if (total > MAX_TOTAL_BYTES) {
      urls.forEach((u) => URL.revokeObjectURL(u)) // don't leak what we already made
      throw new Error('That archive is too large to open safely.')
    }
    urls.push(URL.createObjectURL(blob))
  }
  return urls
}
