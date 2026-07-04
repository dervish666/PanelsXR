import JSZip from 'jszip'

export const IMAGE_RE = /\.(png|jpe?g|gif|webp|avif|bmp)$/i

// Pick the image entries from a .cbz's file list and order them the way a reader
// expects: image files only, natural-sorted so "page2" comes before "page10".
// Extracted as a pure function so the page-ordering — the regression-prone bit —
// is unit-testable without a File/JSZip/browser (see cbz.test.ts).
export function orderCbzImageNames(names: string[]): string[] {
  return names
    .filter((name) => IMAGE_RE.test(name))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
}

// Dev-only convenience: load a local .cbz (a ZIP of images) so you can read a
// real comic on the desktop without a server. Komga makes this unnecessary in
// v1 — it serves page images directly, so the client never unzips anything.
export async function loadCbz(file: File): Promise<string[]> {
  const zip = await JSZip.loadAsync(file)

  const nameOrder = orderCbzImageNames(
    Object.values(zip.files)
      .filter((f) => !f.dir)
      .map((f) => f.name),
  )
  const byName = new Map(Object.values(zip.files).map((f) => [f.name, f]))
  const entries = nameOrder.map((name) => byName.get(name)!)

  const urls: string[] = []
  for (const entry of entries) {
    const blob = await entry.async('blob')
    urls.push(URL.createObjectURL(blob))
  }
  return urls
}
