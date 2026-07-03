import { useEffect, useMemo, useRef, useState } from 'react'
import { useThree } from '@react-three/fiber'
import { XRLayer, useXR } from '@react-three/xr'
import * as THREE from 'three'

// Keep the current page plus this many neighbours resident; dispose the rest.
// Quest RAM is finite and full-res comic pages are large.
const WINDOW = 2

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
  index: number
}

export function PageSurface({ urls, index }: PageSurfaceProps) {
  const { gl } = useThree()
  const maxAnisotropy = useMemo(() => gl.capabilities.getMaxAnisotropy(), [gl])
  const cache = useRef<Map<number, THREE.Texture>>(new Map())
  const cacheUrls = useRef<string[] | null>(null)
  const [current, setCurrent] = useState<THREE.Texture | null>(null)

  useEffect(() => {
    let cancelled = false

    // If the book itself changed, drop the previous book's textures first so we
    // never show stale pages at the same index.
    if (cacheUrls.current !== urls) {
      for (const tex of cache.current.values()) tex.dispose()
      cache.current.clear()
      cacheUrls.current = urls
      setCurrent(null)
    }

    const want = new Set<number>()
    for (let d = -WINDOW; d <= WINDOW; d++) {
      const i = index + d
      if (i >= 0 && i < urls.length) want.add(i)
    }

    // Dispose anything outside the window.
    for (const [i, tex] of cache.current) {
      if (!want.has(i)) {
        tex.dispose()
        cache.current.delete(i)
      }
    }

    // Show the current page immediately if it's already resident.
    const cached = cache.current.get(index)
    if (cached) setCurrent(cached)

    // Load whatever is missing (this preloads neighbours so turns are instant).
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
          if (i === index) setCurrent(tex)
        })
        .catch((err) => console.error('[Panel]', err))
    }

    return () => {
      cancelled = true
    }
  }, [index, urls, maxAnisotropy])

  // Dispose everything when the surface unmounts.
  useEffect(() => {
    const c = cache.current
    return () => {
      for (const tex of c.values()) tex.dispose()
      c.clear()
    }
  }, [])

  const inSession = useXR((s) => s.session != null)
  const img = current?.image as HTMLImageElement | undefined
  const aspect = img && img.width ? img.width / img.height : 2 / 3
  const height = 1.5
  const width = height * aspect

  // In an XR session, composite the page via a WebXR quad layer: the compositor
  // samples the image at native resolution instead of through the eye buffer
  // (the double-resample that makes VR text mushy). Keyed on the image so the
  // layer is recreated per page. Falls back to a plain mesh automatically in
  // sessions without layer support.
  if (inSession && img) {
    return (
      <XRLayer
        key={current!.uuid}
        shape="quad"
        quality="text-optimized"
        src={img}
        scale={[width, height, 1]}
      />
    )
  }

  // Positioned at local origin; the parent group (in Reader) places it in the
  // room and, in VR, is the grab target.
  return (
    <mesh>
      <planeGeometry args={[width, height]} />
      {/* key on the texture so the material remounts (and its shader recompiles
          with USE_MAP) when the page changes — otherwise a map added after the
          first compile is silently ignored and the plane renders flat white. */}
      <meshBasicMaterial
        key={current ? current.uuid : 'placeholder'}
        map={current ?? null}
        color={current ? '#ffffff' : '#1a1a22'}
        toneMapped={false}
      />
    </mesh>
  )
}
