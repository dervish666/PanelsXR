import { useEffect, useMemo, useReducer, useRef } from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'

// Keep the visible pages plus this many neighbours resident; dispose the rest.
// Quest RAM is finite and full-res comic pages are large.
const WINDOW = 2
const PAGE_HEIGHT = 1.5
const SPREAD_GAP = 0.012 // slim gutter between pages in spread mode

function makeTexture(img: HTMLImageElement): THREE.Texture {
  const tex = new THREE.Texture(img)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.generateMipmaps = true
  tex.minFilter = THREE.LinearMipmapLinearFilter
  tex.magFilter = THREE.LinearFilter
  tex.needsUpdate = true
  return tex
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
// downsample, discard paper/ink/near-grey pixels, bucket the rest by hue
// (weighted by saturation), and take the winning bucket's average — a red-wash
// page reads as red. The result is pinned to a fixed dark-but-saturated level
// so the room visibly shifts page to page while staying headset-dim.
function makeAmbience(img: HTMLImageElement): PageAmbience {
  const c = document.createElement('canvas')
  c.width = 32
  c.height = 44
  const ctx = c.getContext('2d')!
  ctx.drawImage(img, 0, 0, c.width, c.height)
  const data = ctx.getImageData(0, 0, c.width, c.height).data

  const BUCKETS = 12
  const wSum = new Array(BUCKETS).fill(0)
  const rSum = new Array(BUCKETS).fill(0)
  const gSum = new Array(BUCKETS).fill(0)
  const bSum = new Array(BUCKETS).fill(0)
  let meanR = 0
  let meanG = 0
  let meanB = 0
  const n = data.length / 4
  const hsl = { h: 0, s: 0, l: 0 }
  const px = new THREE.Color()

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i] / 255
    const g = data[i + 1] / 255
    const b = data[i + 2] / 255
    meanR += r
    meanG += g
    meanB += b
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

  const best = wSum.indexOf(Math.max(...wSum))
  const color = new THREE.Color()
  if (wSum[best] > 1.5) {
    color.setRGB(rSum[best] / wSum[best], gSum[best] / wSum[best], bSum[best] / wSum[best])
    // pin to a consistent dark-saturated level so the shift is visible
    color.getHSL(hsl)
    color.setHSL(hsl.h, Math.min(hsl.s * 1.4, 0.8), 0.11)
  } else {
    // effectively monochrome page: fall back to a very dim mean
    color.setRGB(meanR / n, meanG / n, meanB / n).multiplyScalar(0.14)
  }
  return { color }
}

export interface PageSurfaceProps {
  urls: string[]
  indices: number[] // 1 page (single) or 2 (spread), ascending
  onAmbience?: (a: PageAmbience) => void
}

// NOTE: a WebXR quad layer (<XRLayer quality="text-optimized">) was tried here
// for compositor-sharp text, but rendered BLACK on the real Quest (works in the
// IWER emulator only because IWER lacks layer support and silently used the
// mesh fallback). Needs a dedicated on-device debugging session — see the
// project note. The plain mesh below is the proven-readable path.
export function PageSurface({ urls, indices, onAmbience }: PageSurfaceProps) {
  const { gl } = useThree()
  const maxAnisotropy = useMemo(() => gl.capabilities.getMaxAnisotropy(), [gl])
  const cache = useRef<Map<number, THREE.Texture>>(new Map())
  const cacheUrls = useRef<string[] | null>(null)
  // Textures live in the cache ref; bump forces a re-render when one arrives.
  const [, bump] = useReducer((c: number) => c + 1, 0)

  useEffect(() => {
    let cancelled = false

    // If the book itself changed, drop the previous book's textures first so we
    // never show stale pages at the same index.
    if (cacheUrls.current !== urls) {
      for (const tex of cache.current.values()) tex.dispose()
      cache.current.clear()
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
          bump()
        })
        .catch((err) => console.error('[Panel]', err))
    }

    bump()
    return () => {
      cancelled = true
    }
  }, [indices, urls, maxAnisotropy])

  // Emit the room ambience for the first visible page once it's resident.
  const ambienceFor = useRef<string | null>(null)
  useEffect(() => {
    if (!onAmbience) return
    const tex = cache.current.get(indices[0])
    const img = tex?.image as HTMLImageElement | undefined
    const key = urls[indices[0]]
    if (!img || ambienceFor.current === key) return
    ambienceFor.current = key
    onAmbience(makeAmbience(img))
  })

  // Dispose everything when the surface unmounts.
  useEffect(() => {
    const c = cache.current
    return () => {
      for (const tex of c.values()) tex.dispose()
      c.clear()
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

  // Physical presence: a paper stack + backing board behind the page. In VR
  // this is real geometry, so stereo + head tracking give genuine depth — the
  // comic reads as an object, not a floating poster.
  const stack = [
    { z: -0.006, s: 0.995, rot: 0.004, color: '#d9d2c3' },
    { z: -0.012, s: 0.988, rot: -0.007, color: '#c8c1b1' },
    { z: -0.018, s: 0.98, rot: 0.01, color: '#b5ae9f' },
  ]

  let x = -totalWidth / 2
  return (
    <group>
      {stack.map((l) => (
        <mesh key={l.z} position={[0, 0, l.z]} rotation={[0, 0, l.rot]} scale={l.s}>
          <planeGeometry args={[totalWidth, PAGE_HEIGHT]} />
          <meshBasicMaterial color={l.color} toneMapped={false} />
        </mesh>
      ))}
      <mesh position={[0, 0, -0.03]}>
        <planeGeometry args={[totalWidth + 0.06, PAGE_HEIGHT + 0.06]} />
        <meshBasicMaterial color="#1a1411" toneMapped={false} />
      </mesh>
      {pages.map((p) => {
        const cx = x + p.width / 2
        x += p.width + SPREAD_GAP
        return (
          <mesh key={p.i} position={[cx, 0, 0]}>
            <planeGeometry args={[p.width, PAGE_HEIGHT]} />
            {/* key on the texture so the material remounts (and its shader
                recompiles with USE_MAP) when the page changes — otherwise a map
                added after the first compile is silently ignored and the plane
                renders flat white. */}
            <meshBasicMaterial
              key={p.tex ? p.tex.uuid : 'placeholder'}
              map={p.tex}
              color={p.tex ? '#ffffff' : '#1a1a22'}
              toneMapped={false}
            />
          </mesh>
        )
      })}
    </group>
  )
}
