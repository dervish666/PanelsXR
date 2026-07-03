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

export interface PageSurfaceProps {
  urls: string[]
  indices: number[] // 1 page (single) or 2 (spread), ascending
}

// NOTE: a WebXR quad layer (<XRLayer quality="text-optimized">) was tried here
// for compositor-sharp text, but rendered BLACK on the real Quest (works in the
// IWER emulator only because IWER lacks layer support and silently used the
// mesh fallback). Needs a dedicated on-device debugging session — see the
// project note. The plain mesh below is the proven-readable path.
export function PageSurface({ urls, indices }: PageSurfaceProps) {
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

  let x = -totalWidth / 2
  return (
    <group>
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
