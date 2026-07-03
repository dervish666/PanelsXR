import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { OrbitControls, Text } from '@react-three/drei'
import { useXR, useXRInputSourceState } from '@react-three/xr'
import * as THREE from 'three'
import { UIButton } from './UIButton'
import { exitVR } from '../xr/store'
import {
  bookThumbUrl,
  firstUnreadBook,
  listInProgress,
  listOnDeck,
  listSeries,
  seriesThumbUrl,
} from '../komga/client'
import type { KomgaBook } from '../komga/types'

const MAX_ITEMS = 72
const RADIUS = 3.4 // roomy — use the space
const HEAD = 1.5 // sphere centred at head height
const CARD_W = 0.52
const CARD_H = 0.76
const FLY_MS = 1600 // slower, more cinematic approach
const STAGGER_MS = 26
const HOVER_SCALE = 1.5

interface SphereItem {
  key: string
  title: string
  subtitle: string
  thumb: string
  resolve: () => Promise<KomgaBook | null>
}

// Distribute items on a band of a sphere around the user: full 360° azimuth,
// elevation from a little below eye level to comfortably above — centred on
// the horizon so the band is in view without craning.
function bandPosition(i: number, n: number): THREE.Vector3 {
  const golden = Math.PI * (3 - Math.sqrt(5))
  const t = n === 1 ? 0.5 : i / (n - 1)
  // wide vertical spread — a dome from below eye level to well overhead,
  // not a belt round the middle (but nothing under the floor)
  const elevation = THREE.MathUtils.lerp(-0.45, 0.9, t) // radians above horizon
  const azimuth = i * golden
  return new THREE.Vector3(
    RADIUS * Math.cos(elevation) * Math.sin(azimuth),
    HEAD + RADIUS * Math.sin(elevation),
    -RADIUS * Math.cos(elevation) * Math.cos(azimuth),
  )
}

// Throttle cover loads: 72 simultaneous image decodes + GPU uploads in one
// burst can lose the WebGL context (observed on desktop Chrome). A small
// queue keeps the pipeline smooth, and downscaling to ≤256px via canvas keeps
// 72 covers cheap on Quest memory.
const MAX_CONCURRENT = 5
let active = 0
const waiting: (() => void)[] = []
function acquire(): Promise<void> {
  if (active < MAX_CONCURRENT) {
    active++
    return Promise.resolve()
  }
  return new Promise((r) => waiting.push(r))
}
function release() {
  const next = waiting.shift()
  if (next) next()
  else active--
}

async function loadThumb(url: string): Promise<THREE.Texture> {
  await acquire()
  try {
    return await new Promise((resolve, reject) => {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => {
        const scale = Math.min(1, 256 / img.height)
        const c = document.createElement('canvas')
        c.width = Math.max(1, Math.round(img.width * scale))
        c.height = Math.max(1, Math.round(img.height * scale))
        c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
        const tex = new THREE.CanvasTexture(c)
        tex.colorSpace = THREE.SRGBColorSpace
        tex.generateMipmaps = false
        tex.minFilter = THREE.LinearFilter
        resolve(tex)
      }
      img.onerror = () => reject(new Error(`thumb failed: ${url}`))
      img.src = url
    })
  } finally {
    release()
  }
}

function Cover({
  item,
  target,
  delay,
  onPick,
}: {
  item: SphereItem
  target: THREE.Vector3
  delay: number
  onPick: (item: SphereItem) => void
}) {
  const group = useRef<THREE.Group>(null)
  const [tex, setTex] = useState<THREE.Texture | null>(null)
  const [hover, setHover] = useState(false)
  const born = useRef<number | null>(null)

  // Fly-in start: well outside the sphere and a bit low, so covers sweep in
  // from the distance and rise into place — never through the user's face.
  const start = useMemo(
    () => new THREE.Vector3(target.x * 3.4, target.y - 2.2, target.z * 3.4),
    [target],
  )

  useEffect(() => {
    let dead = false
    loadThumb(item.thumb)
      .then((t) => {
        if (dead) t.dispose()
        else setTex(t)
      })
      .catch(() => {})
    return () => {
      dead = true
      setTex((t) => {
        t?.dispose()
        return null
      })
    }
  }, [item.thumb])

  useFrame(({ clock }) => {
    const g = group.current
    if (!g) return
    if (born.current === null) born.current = clock.elapsedTime * 1000
    const t = Math.min(Math.max((clock.elapsedTime * 1000 - born.current - delay) / FLY_MS, 0), 1)
    const e = 1 - Math.pow(1 - t, 5) // ease-out-quint
    g.position.lerpVectors(start, target, e)
    g.lookAt(0, HEAD, 0) // Object3D.lookAt points +z at the target → cover faces the user
    const s = THREE.MathUtils.lerp(g.scale.x, hover ? HOVER_SCALE : 1, 0.18)
    g.scale.setScalar(s)
  })

  return (
    <group ref={group}>
      {/* backing frame */}
      <mesh position={[0, 0, -0.006]}>
        <planeGeometry args={[CARD_W + 0.02, CARD_H + 0.02]} />
        <meshBasicMaterial
          color={hover ? '#e2483a' : '#1a1411'}
          toneMapped={false}
          side={THREE.DoubleSide}
        />
      </mesh>
      <mesh
        onPointerOver={(e) => {
          e.stopPropagation()
          setHover(true)
        }}
        onPointerOut={() => setHover(false)}
        onClick={(e) => {
          e.stopPropagation()
          onPick(item)
        }}
      >
        <planeGeometry args={[CARD_W, CARD_H]} />
        {/* keyed on texture presence: same recompile-miss as the reader pages —
            a map set after first compile is ignored and the plane renders the
            plain (white) color. */}
        <meshBasicMaterial
          key={tex ? tex.uuid : 'placeholder'}
          map={tex}
          color={tex ? '#ffffff' : '#2a2320'}
          toneMapped={false}
          side={THREE.DoubleSide}
        />
      </mesh>
      {hover && (
        <group position={[0, -(CARD_H / 2) - 0.05, 0]}>
          <Text
            fontSize={0.038}
            maxWidth={CARD_W * 1.9}
            textAlign="center"
            anchorY="top"
            color="#f2eeea"
            outlineWidth={0.003}
            outlineColor="#141010"
          >
            {item.title}
          </Text>
          <Text
            position={[0, -0.1, 0]}
            fontSize={0.026}
            maxWidth={CARD_W * 1.9}
            textAlign="center"
            anchorY="top"
            color="#c9beb8"
            outlineWidth={0.002}
            outlineColor="#141010"
          >
            {item.subtitle}
          </Text>
        </group>
      )}
    </group>
  )
}

export interface LibrarySphereProps {
  onOpenBook: (book: KomgaBook) => void
  onClose?: () => void
}

// The in-VR library: covers fly up and surround you; point at one to grow it
// and read its title; select to open. Shelf books first, then series covers.
function azimuthOf(p: THREE.Vector3): number {
  return Math.atan2(p.x, -p.z)
}

export function LibrarySphere({ onOpenBook, onClose }: LibrarySphereProps) {
  const [items, setItems] = useState<SphereItem[] | null>(null)
  const inXR = useXR((s) => s.session != null)
  const rotGroup = useRef<THREE.Group>(null)
  // drag-to-spin state: track the pointer's azimuth and how far it has pulled,
  // so a real pull spins the sphere and a stationary press still counts as a click
  const drag = useRef<{ az: number; moved: number } | null>(null)
  const suppressClick = useRef(false)
  const right = useXRInputSourceState('controller', 'right')

  useFrame((_, dt) => {
    // right thumbstick spins the library — the easy seated option
    const stick = right?.gamepad?.['xr-standard-thumbstick'] as
      | { xAxis?: number }
      | undefined
    const x = stick?.xAxis ?? 0
    if (Math.abs(x) > 0.2 && rotGroup.current) {
      rotGroup.current.rotation.y -= x * dt * 1.6
    }
  })

  useEffect(() => {
    let dead = false
    Promise.allSettled([listInProgress(), listOnDeck(), listSeries()]).then(
      ([inProg, onDeck, series]) => {
        if (dead) return
        const out: SphereItem[] = []
        const seen = new Set<string>()
        const addBook = (b: KomgaBook, sub: string) => {
          if (seen.has(b.id) || out.length >= MAX_ITEMS) return
          seen.add(b.id)
          out.push({
            key: `b:${b.id}`,
            title: b.seriesTitle,
            subtitle: sub,
            thumb: bookThumbUrl(b.id),
            resolve: () => Promise.resolve(b),
          })
        }
        if (inProg.status === 'fulfilled')
          inProg.value.forEach((b) =>
            addBook(b, `continue · p${b.readProgress?.page ?? 1}/${b.media.pagesCount}`),
          )
        if (onDeck.status === 'fulfilled') onDeck.value.forEach((b) => addBook(b, 'on deck'))
        if (series.status === 'fulfilled') {
          for (const s of series.value) {
            if (out.length >= MAX_ITEMS) break
            out.push({
              key: `s:${s.id}`,
              title: s.name,
              subtitle: `${s.booksCount} book${s.booksCount === 1 ? '' : 's'}`,
              thumb: seriesThumbUrl(s.id),
              resolve: () => firstUnreadBook(s.id),
            })
          }
        }
        setItems(out)
      },
    )
    return () => {
      dead = true
    }
  }, [])

  const targets = useMemo(
    () => (items ? items.map((_, i) => bandPosition(i, items.length)) : []),
    [items],
  )

  const pick = (item: SphereItem) => {
    if (suppressClick.current) return // that "click" was the tail end of a pull
    void item.resolve().then((b) => {
      if (b) onOpenBook(b)
    })
  }

  if (!items) return null
  return (
    <group>
      {/* the rotating shell: click-and-pull any cover sideways to spin it
          (VR only — desktop already orbits with the mouse) */}
      <group
        ref={rotGroup}
        onPointerDown={
          inXR
            ? (e) => {
                drag.current = { az: azimuthOf(e.point), moved: 0 }
                suppressClick.current = false
              }
            : undefined
        }
        onPointerMove={
          inXR
            ? (e) => {
                const d = drag.current
                const g = rotGroup.current
                if (!d || !g) return
                const az = azimuthOf(e.point)
                let delta = az - d.az
                if (delta > Math.PI) delta -= Math.PI * 2
                if (delta < -Math.PI) delta += Math.PI * 2
                g.rotation.y += delta
                d.az = az
                d.moved += Math.abs(delta)
                if (d.moved > 0.05) suppressClick.current = true
              }
            : undefined
        }
        onPointerUp={
          inXR
            ? () => {
                drag.current = null
                // let the click that ends this gesture see the flag, then clear
                setTimeout(() => (suppressClick.current = false), 80)
              }
            : undefined
        }
      >
        {items.map((item, i) => (
          <Cover
            key={item.key}
            item={item}
            target={targets[i]}
            delay={i * STAGGER_MS}
            onPick={pick}
          />
        ))}
      </group>
      {/* In VR: a close button floating low in front (Y also toggles).
          On desktop: orbit so the mouse can look around the band. */}
      {inXR && onClose && (
        <>
          <UIButton
            position={[-0.24, HEAD - 0.85, -1.2]}
            width={0.42}
            label="✕ Back to book"
            onClick={onClose}
          />
          <UIButton
            position={[0.2, HEAD - 0.85, -1.2]}
            width={0.3}
            label="Exit VR"
            onClick={exitVR}
          />
        </>
      )}
      {!inXR && (
        <OrbitControls target={[0, HEAD, -0.01]} enablePan={false} enableZoom={false} />
      )}
    </group>
  )
}
