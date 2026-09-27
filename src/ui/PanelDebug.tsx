import { useEffect, useRef, useState } from 'react'
import { detectPanels, scanImage } from '../pages/panels'
import type { PanelRect } from '../pages/panels'

// Desktop-only sweep tool for the panel detector: draws the detected rects over
// a flat copy of each visible page so the hit rate on real Komga pages can be
// eyeballed. Mounted by App only with `?panels=debug` in the URL; never part of
// normal use. Page with the arrow keys as usual; the tally at the top counts
// how many distinct pages split vs showed no panels.
const THUMB_H = 380

interface Result {
  rects: PanelRect[]
  ms: number
  scanMs: number
  scanW: number
  scanH: number
}

export function isPanelDebug(): boolean {
  return new URLSearchParams(window.location.search).get('panels') === 'debug'
}

function PageThumb({
  url,
  index,
  onResult,
}: {
  url: string
  index: number
  onResult: (index: number, r: Result) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [res, setRes] = useState<Result | null>(null)

  useEffect(() => {
    let cancelled = false
    setRes(null)
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      if (cancelled) return
      // Time the two halves apart: the canvas downscale + getImageData is the
      // part that varies by device (GPU readback), the cut is pure CPU.
      const t0 = performance.now()
      const scan = scanImage(img)
      const t1 = performance.now()
      const rects = detectPanels(scan)
      const ms = performance.now() - t0
      const scanMs = t1 - t0
      const c = canvasRef.current
      if (!c) return
      const scale = THUMB_H / scan.height
      c.width = Math.round(scan.width * scale)
      c.height = THUMB_H
      const ctx = c.getContext('2d')!
      ctx.drawImage(img, 0, 0, c.width, c.height)
      ctx.lineWidth = 2
      ctx.font = 'bold 14px system-ui, sans-serif'
      rects.forEach((r, k) => {
        const x = r.x * c.width
        const y = r.y * c.height
        const w = r.w * c.width
        const h = r.h * c.height
        ctx.strokeStyle = '#e2483a'
        ctx.strokeRect(x, y, w, h)
        ctx.fillStyle = '#e2483a'
        ctx.fillRect(x, y, 20, 18)
        ctx.fillStyle = '#fff'
        ctx.fillText(String(k + 1), x + 4, y + 14)
      })
      const r = { rects, ms, scanMs, scanW: scan.width, scanH: scan.height }
      setRes(r)
      onResult(index, r)
    }
    img.onerror = () => {
      if (!cancelled) console.error('[Panel] debug: page failed to load', url)
    }
    img.src = url
    return () => {
      cancelled = true
    }
  }, [url, index, onResult])

  return (
    <div className="panel-debug-page">
      <canvas ref={canvasRef} height={THUMB_H} />
      <div className="panel-debug-meta">
        {`p${index + 1} · `}
        {res
          ? res.rects.length
            ? `${res.rects.length} panels · ${res.ms.toFixed(1)}ms (scan ${res.scanMs.toFixed(1)}) · ${res.scanW}×${res.scanH}`
            : `no panels (full page) · ${res.ms.toFixed(1)}ms (scan ${res.scanMs.toFixed(1)})`
          : 'scanning…'}
      </div>
    </div>
  )
}

export function PanelDebug({ urls, indices }: { urls: string[]; indices: number[] }) {
  // per-page verdicts, keyed by page index, so the tally counts each page once
  const [seen, setSeen] = useState<Map<number, number>>(() => new Map())
  const onResult = useRef((index: number, r: Result) => {
    setSeen((m) => {
      const n = new Map(m)
      n.set(index, r.rects.length)
      return n
    })
  }).current
  const total = seen.size
  const hits = [...seen.values()].filter((n) => n > 0).length

  return (
    <div className="panel-debug">
      <div className="panel-debug-head">
        {`panel detector · ${hits}/${total} pages split`}
        {total ? ` (${Math.round((hits / total) * 100)}%)` : ''}
        {' · ← → to sweep'}
      </div>
      <div className="panel-debug-row">
        {indices.map((i) => (
          <PageThumb key={i} url={urls[i]} index={i} onResult={onResult} />
        ))}
      </div>
    </div>
  )
}
