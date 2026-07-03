// Canvas-drawn placeholder comic pages, so v0 has a multi-page "book" to read
// with zero network and zero auth. Comic aspect ratio (2:3), with text at a
// range of sizes so we can judge legibility / sharpness in the headset.

const PALETTE = ['#e63946', '#457b9d', '#2a9d8f', '#e9c46a', '#8d5524', '#6d597a']

export function makeSyntheticPages(count = 20): string[] {
  const W = 1600
  const H = 2400
  const pages: string[] = []

  for (let p = 1; p <= count; p++) {
    const canvas = document.createElement('canvas')
    canvas.width = W
    canvas.height = H
    const ctx = canvas.getContext('2d')!

    // Paper + outer frame
    ctx.fillStyle = '#f5f0e6'
    ctx.fillRect(0, 0, W, H)
    ctx.strokeStyle = '#1a1a1a'
    ctx.lineWidth = 10
    ctx.strokeRect(40, 40, W - 80, H - 80)

    // Big page-number header
    ctx.fillStyle = '#1a1a1a'
    ctx.font = 'bold 120px Georgia, serif'
    ctx.fillText(`Page ${p}`, 80, 170)

    // A grid of panels with faint colour washes
    const gutter = 40
    const cols = 2
    const rows = 3
    const pw = (W - 160 - gutter * (cols - 1)) / cols
    const ph = (H - 480 - gutter * (rows - 1)) / rows
    let panel = 0
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = 80 + c * (pw + gutter)
        const y = 220 + r * (ph + gutter)

        ctx.globalAlpha = 0.18
        ctx.fillStyle = PALETTE[(p + panel) % PALETTE.length]
        ctx.fillRect(x, y, pw, ph)
        ctx.globalAlpha = 1

        ctx.strokeStyle = '#1a1a1a'
        ctx.lineWidth = 6
        ctx.strokeRect(x, y, pw, ph)

        // Caption text — size varies per panel to probe legibility.
        ctx.fillStyle = '#1a1a1a'
        ctx.font = `${30 + panel * 8}px Georgia, serif`
        ctx.fillText(`Panel ${panel + 1}: the quick brown fox.`, x + 24, y + 56)
        panel++
      }
    }

    // Small footer — the sharpness torture test.
    ctx.fillStyle = '#1a1a1a'
    ctx.font = '24px Georgia, serif'
    ctx.fillText(
      'Panel — WebXR comic reader · synthetic test page · small-text legibility check',
      80,
      H - 70,
    )

    pages.push(canvas.toDataURL('image/png'))
  }

  return pages
}
