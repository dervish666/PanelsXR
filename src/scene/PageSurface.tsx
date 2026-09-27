import { useEffect, useMemo, useReducer, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Text } from '@react-three/drei'
import * as THREE from 'three'
import { detectPanels, scanImage } from '../pages/panels'
import type { PanelRect, ScanImage } from '../pages/panels'
import type { PanelSlot } from '../pages/pairing'

// Keep the visible pages plus this many neighbours resident; dispose the rest.
// Quest RAM is finite and full-res comic pages are large.
const WINDOW = 2
const PAGE_HEIGHT = 1.5
const SPREAD_GAP = 0.012 // slim gutter between pages in spread mode
const CURVE_SEG = 48 // horizontal subdivisions for a smooth bend
const PHI_MAX = 1.4 // rad — the full arc angle across the page at curve = 1 (~80°)

// Build a plane slice [xStart, xEnd] (in the surround's global x, so a two-page
// spread lands on ONE continuous arc) displaced onto a vertical cylinder that
// curves the far edges TOWARD the viewer (+z). radius = null → flat. UVs run
// 0..1 across the slice so the page texture maps normally.
function curvedSlice(
  xStart: number,
  xEnd: number,
  height: number,
  radius: number | null,
): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry()
  const cols = CURVE_SEG + 1
  const pos: number[] = []
  const uv: number[] = []
  const idx: number[] = []
  for (let r = 0; r < 2; r++) {
    const y = (0.5 - r) * height // r=0 top (+h/2), r=1 bottom (-h/2)
    for (let c = 0; c < cols; c++) {
      const t = c / CURVE_SEG
      const x = xStart + (xEnd - xStart) * t
      let px = x
      let pz = 0
      if (radius) {
        const theta = x / radius
        px = radius * Math.sin(theta)
        pz = radius * (1 - Math.cos(theta)) // 0 at centre, >0 (toward viewer) at edges
      }
      pos.push(px, y, pz)
      uv.push(t, 1 - r)
    }
  }
  for (let c = 0; c < CURVE_SEG; c++) {
    const a = c
    const b = c + 1
    const d = cols + c
    const e = cols + c + 1
    idx.push(a, d, b, b, d, e)
  }
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  g.setIndex(idx)
  return g
}

// Clamp very large scans: covers already downscale to ≤256px, but full pages
// were uncapped, so a library of 4000px scans could hold several at full res in
// the resident window and exhaust Quest VRAM. 2048 on the long edge stays sharp
// for reading while bounding memory. Downscaled pages become a CanvasTexture;
// smaller pages keep the plain image path unchanged.
const MAX_PAGE_EDGE = 2048

function tuneTexture(tex: THREE.Texture): THREE.Texture {
  tex.colorSpace = THREE.SRGBColorSpace
  tex.generateMipmaps = true
  tex.minFilter = THREE.LinearMipmapLinearFilter
  tex.magFilter = THREE.LinearFilter
  tex.needsUpdate = true
  return tex
}

function makeTexture(img: HTMLImageElement): THREE.Texture {
  const longEdge = Math.max(img.width, img.height)
  if (longEdge > MAX_PAGE_EDGE) {
    const scale = MAX_PAGE_EDGE / longEdge
    const c = document.createElement('canvas')
    c.width = Math.max(1, Math.round(img.width * scale))
    c.height = Math.max(1, Math.round(img.height * scale))
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
    return tuneTexture(new THREE.CanvasTexture(c))
  }
  return tuneTexture(new THREE.Texture(img))
}

function loadTexture(url: string): Promise<THREE.Texture> {
  // Gate on `load`, NOT img.decode(): decode() is unreliable on the Quest browser
  // (it rejects data-URLs with EncodingError even when the image is fine). The
  // white-page recompile race is handled separately by keying the material below.
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(makeTexture(img))
    img.onerror = () => reject(new Error(`Failed to load page image: ${url}`))
    img.src = url
  })
}

export interface PageAmbience {
  color: THREE.Color // darkened dominant colour of the current page
}

// Dominant CHROMATIC colour, not the mean: comic pages are mostly white paper
// and black ink, so a plain average is always murky grey-brown. Instead we
// sample the page's scan buffer (the same one the panel detector reads, so the
// image is drawn to a canvas once), discard paper/ink/near-grey pixels, bucket
// the rest by hue (weighted by saturation), and take the winning bucket's
// average — a red-wash page reads as red. The result is pinned to a fixed
// dark-but-saturated level so the room visibly shifts page to page while
// staying headset-dim.
function makeAmbience(scan: ScanImage): PageAmbience {
  // stride down to roughly the 32x44 grid the original canvas sample used
  const stride = Math.max(1, Math.round(Math.max(scan.width, scan.height) / 44))
  const data = scan.data
  const rowStep = scan.width * 4 * stride
  const colStep = 4 * stride

  const BUCKETS = 12
  const wSum = new Array(BUCKETS).fill(0)
  const rSum = new Array(BUCKETS).fill(0)
  const gSum = new Array(BUCKETS).fill(0)
  const bSum = new Array(BUCKETS).fill(0)
  let meanR = 0
  let meanG = 0
  let meanB = 0
  let n = 0
  const hsl = { h: 0, s: 0, l: 0 }
  const px = new THREE.Color()

  for (let row = 0; row < data.length; row += rowStep) {
    const end = row + scan.width * 4
    for (let i = row; i < end; i += colStep) {
      const r = data[i] / 255
      const g = data[i + 1] / 255
      const b = data[i + 2] / 255
      meanR += r
      meanG += g
      meanB += b
      n++
      px.setRGB(r, g, b).getHSL(hsl)
      // skip paper (bright), ink (dark) and near-greys — they aren't "the colour"
      if (hsl.l > 0.88 || hsl.l < 0.07 || hsl.s < 0.18) continue
      const k = Math.min(BUCKETS - 1, Math.floor(hsl.h * BUCKETS))
      const w = hsl.s * (1 - Math.abs(hsl.l - 0.5)) // saturated mid-tones count most
      wSum[k] += w
      rSum[k] += r * w
      gSum[k] += g * w
      bSum[k] += b * w
    }
  }

  const best = wSum.indexOf(Math.max(...wSum))
  const color = new THREE.Color()
  if (wSum[best] > 1.5) {
    color.setRGB(rSum[best] / wSum[best], gSum[best] / wSum[best], bSum[best] / wSum[best])
    // pin to a consistent dark-saturated level so the shift is visible
    color.getHSL(hsl)
    color.setHSL(hsl.h, Math.min(hsl.s * 1.4, 0.8), 0.11)
  } else {
    // effectively monochrome page: fall back to a very dim mean
    color.setRGB(meanR / Math.max(1, n), meanG / Math.max(1, n), meanB / Math.max(1, n)).multiplyScalar(0.14)
  }
  return { color }
}

// Per-page derived data, computed once from a single canvas draw of the decoded
// image and cached beside the texture (evicted with it).
interface PageMeta {
  rects: PanelRect[] // [] = the detector wasn't confident: show the whole page
  ambience: PageAmbience
}

// Warn (once per session) when a page's detect runs long: the cut is meant to
// be a few ms, and a silent hitch on every page load is the kind of thing only
// the headset would otherwise reveal. The scan (canvas draw + readback) is
// timed apart from the cut because its first draw of an <img> also decodes it
// (100-400ms for a big page); that decode is paid once either way, since the
// GPU upload needs it too, so only the cut is held to the budget.
const SLOW_DETECT_MS = 16
let warnedSlow = false

function makeMeta(img: HTMLImageElement, url: string): PageMeta {
  const t0 = performance.now()
  const scan = scanImage(img)
  const t1 = performance.now()
  const rects = detectPanels(scan)
  const cutMs = performance.now() - t1
  if (cutMs > SLOW_DETECT_MS && !warnedSlow) {
    warnedSlow = true
    console.warn(
      `[Panel] panel cut took ${cutMs.toFixed(1)}ms (scan ${(t1 - t0).toFixed(1)}ms, ${img.width}×${img.height}) for ${url}`,
    )
  }
  return { rects, ambience: makeAmbience(scan) }
}

export interface PageSurfaceProps {
  urls: string[]
  indices: number[] // 1 page (single) or 2 (spread), ascending
  curve?: number // 0 = flat, 1 = full bend toward the viewer at the edges
  onAmbience?: (a: PageAmbience) => void
  onLayout?: (width: number, height: number) => void // actual page bounds, for the tap zones
  // Panel mode: the slot to focus. A slot with panel: null (or a page whose
  // rects aren't known yet) shows the whole page, no lens, no dim.
  focus?: PanelSlot | null
  onPanels?: (page: number, count: number) => void // detected panel count per page
}

// ---- the lens -------------------------------------------------------------

const LENS_LIFT = 0.25 // metres in front of the page
const LENS_FILL = 0.85 // the panel's long edge as a fraction of PAGE_HEIGHT
const LENS_MAX_SCALE = 4 // cap for thin strips so a sliver doesn't fill the room
const LENS_LAMBDA = 22 // damp rate: ~180ms to settle
const DIM = new THREE.Color('#4a4a4a')
const BRIGHT = new THREE.Color('#ffffff')

// A plane the size of the panel on the page, with UVs cropped to the panel so
// it reads straight off the page's texture (no clone, no offset/repeat, so the
// page behind is untouched). Rebuilt when the panel or page size changes.
function cropPlane(pw: number, ph: number, r: PanelRect): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(pw, ph)
  // three's PlaneGeometry UVs run (0,1) top-left → (1,0) bottom-right; the page
  // texture has v=1 at the top (flipY), matching curvedSlice.
  const u0 = r.x
  const u1 = r.x + r.w
  const v1 = 1 - r.y
  const v0 = 1 - (r.y + r.h)
  g.setAttribute('uv', new THREE.Float32BufferAttribute([u0, v1, u1, v1, u0, v0, u1, v0], 2))
  return g
}

interface PanelLensProps {
  tex: THREE.Texture
  rect: PanelRect
  pageX: number // left edge of the page slice in surface space
  pageWidth: number
}

function PanelLens({ tex, rect, pageX, pageWidth }: PanelLensProps) {
  const ref = useRef<THREE.Mesh>(null)
  const pw = rect.w * pageWidth
  const ph = rect.h * PAGE_HEIGHT
  // where the panel sits on the page: the lens animates out from here
  const cx = pageX + (rect.x + rect.w / 2) * pageWidth
  const cy = PAGE_HEIGHT * (0.5 - (rect.y + rect.h / 2))
  const target = Math.min(LENS_MAX_SCALE, (LENS_FILL * PAGE_HEIGHT) / Math.max(pw, ph))
  const geom = useMemo(() => cropPlane(pw, ph, rect), [pw, ph, rect])
  useEffect(() => () => geom.dispose(), [geom])
  // Start from the panel's own spot at scale 1 whenever the focus changes.
  const key = `${tex.uuid}:${rect.x},${rect.y},${rect.w},${rect.h}`
  const started = useRef<string | null>(null)
  useFrame((_, dt) => {
    const m = ref.current
    if (!m) return
    if (started.current !== key) {
      started.current = key
      m.position.set(cx, cy, 0.01)
      m.scale.setScalar(1)
    }
    const d = Math.min(dt, 0.05)
    m.position.x = THREE.MathUtils.damp(m.position.x, 0, LENS_LAMBDA, d)
    m.position.y = THREE.MathUtils.damp(m.position.y, 0, LENS_LAMBDA, d)
    m.position.z = THREE.MathUtils.damp(m.position.z, LENS_LIFT, LENS_LAMBDA, d)
    const s = THREE.MathUtils.damp(m.scale.x, target, LENS_LAMBDA, d)
    m.scale.setScalar(s)
  })
  return (
    // raycast off: the lens sits in front of the tap zones and must not eat
    // their pointer events (or the grab, which comes off the page's border)
    <mesh ref={ref} geometry={geom} raycast={() => null} renderOrder={2}>
      <meshBasicMaterial key={tex.uuid} map={tex} toneMapped={false} />
    </mesh>
  )
}

// NOTE: a WebXR quad layer (<XRLayer quality="text-optimized">) was tried here
// for compositor-sharp text, but rendered BLACK on the real Quest (works in the
// IWER emulator only because IWER lacks layer support and silently used the
// mesh fallback). Needs a dedicated on-device debugging session — see the
// project note. The plain mesh below is the proven-readable path.
export function PageSurface({
  urls,
  indices,
  curve = 0,
  onAmbience,
  onLayout,
  focus = null,
  onPanels,
}: PageSurfaceProps) {
  const { gl } = useThree()
  const maxAnisotropy = useMemo(() => gl.capabilities.getMaxAnisotropy(), [gl])
  const cache = useRef<Map<number, THREE.Texture>>(new Map())
  const meta = useRef<Map<number, PageMeta>>(new Map())
  const cacheUrls = useRef<string[] | null>(null)
  // Page materials, collected so the dim can lerp them each frame without
  // re-rendering (they remount when their texture changes, hence a Set).
  const pageMats = useRef<Set<THREE.MeshBasicMaterial>>(new Set())
  // Textures live in the cache ref; bump forces a re-render when one arrives.
  const [, bump] = useReducer((c: number) => c + 1, 0)
  // Page indices whose image failed to load, and how many times we've tried —
  // so a 404/network drop shows a visible label instead of a silent dark plane,
  // and auto-retries a bounded number of times (no pointer handler: this mesh is
  // inside the grab Handle, where the grab pointer eats clicks on real hardware).
  const failed = useRef<Set<number>>(new Set())
  const attempts = useRef<Map<number, number>>(new Map())
  const [retryNonce, retry] = useReducer((c: number) => c + 1, 0)
  const MAX_ATTEMPTS = 4

  useEffect(() => {
    let cancelled = false

    // If the book itself changed, drop the previous book's textures first so we
    // never show stale pages at the same index.
    if (cacheUrls.current !== urls) {
      for (const tex of cache.current.values()) tex.dispose()
      cache.current.clear()
      meta.current.clear()
      cacheUrls.current = urls
    }

    const want = new Set<number>()
    for (const idx of indices) {
      for (let d = -WINDOW; d <= WINDOW; d++) {
        const i = idx + d
        if (i >= 0 && i < urls.length) want.add(i)
      }
    }

    // Dispose anything outside the window.
    for (const [i, tex] of cache.current) {
      if (!want.has(i)) {
        tex.dispose()
        cache.current.delete(i)
        meta.current.delete(i)
      }
    }

    // Load whatever is missing (preloads neighbours so turns are instant).
    for (const i of want) {
      if (cache.current.has(i)) continue
      loadTexture(urls[i])
        .then((tex) => {
          if (cancelled) {
            tex.dispose()
            return
          }
          tex.anisotropy = maxAnisotropy
          cache.current.set(i, tex)
          // Panel rects + ambience from one canvas draw of the decoded image.
          // Runs here, during the neighbour preload, so a page turn never waits
          // on it. `tex.image` is the original <img> (or the ≤2048 canvas for
          // huge scans; the detector is scale-independent).
          const m = makeMeta(tex.image as HTMLImageElement, urls[i])
          meta.current.set(i, m)
          onPanels?.(i, m.rects.length)
          failed.current.delete(i)
          attempts.current.delete(i)
          bump()
        })
        .catch((err) => {
          if (cancelled) return
          console.error('[Panel]', err)
          const n = (attempts.current.get(i) ?? 0) + 1
          attempts.current.set(i, n)
          failed.current.add(i)
          bump()
          if (n < MAX_ATTEMPTS) {
            // back off 1s, 2s, 3s… then re-run the effect to try again
            setTimeout(() => {
              if (!cancelled) {
                failed.current.delete(i)
                retry()
              }
            }, n * 1000)
          }
        })
    }

    bump()
    return () => {
      cancelled = true
    }
    // onPanels is a stable callback from App; not a reason to reload pages
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [indices, urls, maxAnisotropy, retryNonce])

  // Emit the room ambience for the first visible page once it's resident.
  const ambienceFor = useRef<string | null>(null)
  useEffect(() => {
    if (!onAmbience) return
    const m = meta.current.get(indices[0])
    const key = urls[indices[0]]
    if (!m || ambienceFor.current === key) return
    ambienceFor.current = key
    onAmbience(m.ambience)
  })

  // The focused panel, if its page is resident and the detector found panels.
  const lens = (() => {
    if (!focus || focus.panel === null) return null
    const tex = cache.current.get(focus.page)
    const rect = meta.current.get(focus.page)?.rects[focus.panel]
    return tex && rect ? { tex, rect, page: focus.page } : null
  })()

  // Dim the page while a lens is up. Lerped per frame on the live materials so
  // no re-render (and no shader recompile) is involved.
  useFrame((_, dt) => {
    const target = lens ? DIM : BRIGHT
    const k = 1 - Math.exp(-LENS_LAMBDA * Math.min(dt, 0.05))
    for (const mat of pageMats.current) {
      if (!mat.map) continue // the placeholder tint stays as it is
      mat.color.lerp(target, k)
    }
  })

  // Dispose everything when the surface unmounts.
  useEffect(() => {
    const c = cache.current
    const m = meta.current
    return () => {
      for (const tex of c.values()) tex.dispose()
      c.clear()
      m.clear()
    }
  }, [])

  // Lay the visible pages out side by side, centred as a unit. Each page keeps
  // its own aspect ratio at a common height.
  const pages = indices.map((i) => {
    const tex = cache.current.get(i) ?? null
    const img = tex?.image as HTMLImageElement | undefined
    const aspect = img && img.width ? img.width / img.height : 2 / 3
    return { i, tex, width: PAGE_HEIGHT * aspect }
  })
  const totalWidth =
    pages.reduce((sum, p) => sum + p.width, 0) + SPREAD_GAP * (pages.length - 1)

  // Curve geometry: one cylinder arc shared across the whole surface (so a
  // spread bends as a single sheet). Each page + the backing board get a slice
  // of that arc; rebuilt only when the layout or curve changes (not per texture
  // load), and disposed to keep Quest VRAM honest.
  const widthKey = pages.map((p) => p.width.toFixed(3)).join(',')
  const geomRef = useRef<THREE.BufferGeometry[]>([])
  const { pageGeoms, boardGeom, pageX } = useMemo(() => {
    geomRef.current.forEach((g) => g.dispose())
    const radius = curve > 0.001 ? totalWidth / (curve * PHI_MAX) : null
    let x = -totalWidth / 2
    const pageX: number[] = []
    const pageGeoms = pages.map((p) => {
      pageX.push(x)
      const g = curvedSlice(x, x + p.width, PAGE_HEIGHT, radius)
      x += p.width + SPREAD_GAP
      return g
    })
    const bw = totalWidth + 0.06
    const boardGeom = curvedSlice(-bw / 2, bw / 2, PAGE_HEIGHT + 0.06, radius)
    geomRef.current = [...pageGeoms, boardGeom]
    return { pageGeoms, boardGeom, pageX }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [widthKey, curve])
  useEffect(() => () => geomRef.current.forEach((g) => g.dispose()), [])

  // Report the real page bounds so the tap zones cover the actual page (its
  // width varies per comic + doubles in spread mode). Height is fixed.
  useEffect(() => {
    onLayout?.(totalWidth, PAGE_HEIGHT)
  }, [totalWidth, onLayout])

  // Physical presence: a paper stack + backing board behind the page. In VR
  // this is real geometry, so stereo + head tracking give genuine depth — the
  // comic reads as an object, not a floating poster. (The thin stack stays flat
  // behind the curved board — it never pokes through, and the difference is
  // invisible at any comfortable curve.)
  const stack = [
    { z: -0.006, s: 0.995, rot: 0.004, color: '#d9d2c3' },
    { z: -0.012, s: 0.988, rot: -0.007, color: '#c8c1b1' },
    { z: -0.018, s: 0.98, rot: 0.01, color: '#b5ae9f' },
  ]

  return (
    <group>
      {stack.map((l) => (
        <mesh key={l.z} position={[0, 0, l.z]} rotation={[0, 0, l.rot]} scale={l.s}>
          <planeGeometry args={[totalWidth, PAGE_HEIGHT]} />
          <meshBasicMaterial color={l.color} toneMapped={false} />
        </mesh>
      ))}
      <mesh position={[0, 0, -0.03]} geometry={boardGeom}>
        <meshBasicMaterial color="#1a1411" toneMapped={false} side={THREE.DoubleSide} />
      </mesh>
      {pages.map((p, k) => (
        <mesh key={p.i} geometry={pageGeoms[k]}>
          {/* key on the texture so the material remounts (and its shader
              recompiles with USE_MAP) when the page changes — otherwise a map
              added after the first compile is silently ignored and the plane
              renders flat white. */}
          <meshBasicMaterial
            key={p.tex ? p.tex.uuid : 'placeholder'}
            ref={(mat) => {
              if (!mat) return
              pageMats.current.add(mat)
              return () => {
                pageMats.current.delete(mat)
              }
            }}
            map={p.tex}
            color={p.tex ? '#ffffff' : '#1a1a22'}
            toneMapped={false}
            side={THREE.DoubleSide}
          />
        </mesh>
      ))}
      {lens && (
        <PanelLens
          tex={lens.tex}
          rect={lens.rect}
          pageX={pageX[pages.findIndex((p) => p.i === lens.page)] ?? -totalWidth / 2}
          pageWidth={pages.find((p) => p.i === lens.page)?.width ?? totalWidth}
        />
      )}
      {/* A failed page would otherwise be an unexplained dark plane in-headset
          (the console is invisible there). Say so, and note it's auto-retrying. */}
      {pages.some((p) => !p.tex && failed.current.has(p.i)) && (
        <Text
          raycast={() => null}
          position={[0, 0, 0.02]}
          fontSize={0.09}
          maxWidth={totalWidth * 0.8}
          textAlign="center"
          anchorX="center"
          anchorY="middle"
          color="#e2483a"
          outlineWidth={0.005}
          outlineColor="#141010"
        >
          Page didn’t load — retrying…
        </Text>
      )}
    </group>
  )
}
