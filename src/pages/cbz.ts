import JSZip from 'jszip'

const IMAGE_RE = /\.(png|jpe?g|gif|webp|avif|bmp)$/i

// Dev-only convenience: load a local .cbz (a ZIP of images) so you can read a
// real comic on the desktop without a server. Komga makes this unnecessary in
// v1 — it serves page images directly, so the client never unzips anything.
export async function loadCbz(file: File): Promise<string[]> {
  const zip = await JSZip.loadAsync(file)

  const entries = Object.values(zip.files)
    .filter((f) => !f.dir && IMAGE_RE.test(f.name))
    // Natural sort so "page2" comes before "page10".
    .sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }),
    )

  const urls: string[] = []
  for (const entry of entries) {
    const blob = await entry.async('blob')
    urls.push(URL.createObjectURL(blob))
  }
  return urls
}
