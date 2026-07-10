import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { OrbitControls, Text } from '@react-three/drei'
import { useXR, useXRInputSourceState } from '@react-three/xr'
import * as THREE from 'three'
import { UIButton } from './UIButton'
import { exitVR } from '../xr/store'
import {
  bookThumbUrl,
  bucketSeriesByFirstLetter,
  firstUnreadBook,
  letterOf,
  listBooks,
  listInProgress,
  listOnDeck,
  listSeries,
  seriesThumbUrl,
} from '../komga/client'
import type { LetterBucket } from '../komga/client'
import type { KomgaBook, KomgaSeries } from '../komga/types'

const PAGE_SIZE = 72 // covers per surround "page" — >72 concurrent GPU uploads risk WebGL context loss
const RADIUS = 3.4 // roomy — use the space
const ARC_RADIUS = 2.75 // the A–Z index sits a little closer than the cover dome
const HEAD = 1.5 // sphere centred at head height
const CARD_W = 0.52
const CARD_H = 0.76
const FLY_MS = 1600 // slower, more cinematic approach
const STAGGER_MS = 26
const HOVER_SCALE = 1.5
const LETTER_AZ = 0.95 // half-width of the front arc, radians (~±54°)

interface SphereItem {
  key: string
  title: string
  subtitle: string
  thumb: string
  onSelect: () => void
}

// Distribute the covers around the user, WEIGHTED TOWARD THE FRONT so there's
// always something in view when a level opens. Item 0 sits dead ahead (−Z) and
// the rest fan out right/left, so a handful of titles gather in front and only
// larger sets spread to the sides and wrap behind. Azimuth spacing tightens as
// the count grows, so once a set is big enough (~16+) it fills the whole ring
// like before; the elevation band widens from a compact eye-level cluster to
// the full dome on the same schedule. Deterministic per index (a re-entered
// letter lands its covers in the same spots — no reshuffle).
const AZ_STEP = 0.4 // neighbour spacing (rad, ~23°) when there's room to spread
const GOLDEN_FRAC = 0.6180339887 // low-discrepancy elevation order → no stripes
function bandPosition(i: number, n: number): THREE.Vector3 {
  const step = Math.min(AZ_STEP, (2 * Math.PI) / Math.max(n, 1))
  // centre the whole set on the front (−Z): the middle item sits dead ahead and
  // the rest straddle it symmetrically in alphabetical order, left → right.
  const azimuth = (i - (n - 1) / 2) * step
  const fill = Math.min(1, (n * AZ_STEP) / (2 * Math.PI)) // few → 0, fills ring → 1
  const eLo = THREE.MathUtils.lerp(-0.12, -0.45, fill)
  const eHi = THREE.MathUtils.lerp(0.34, 0.9, fill)
  const et = (0.5 + i * GOLDEN_FRAC) % 1
  const elevation = THREE.MathUtils.lerp(eLo, eHi, et)
  return new THREE.Vector3(
    RADIUS * Math.cos(elevation) * Math.sin(azimuth),
    HEAD + RADIUS * Math.sin(elevation),
    -RADIUS * Math.cos(elevation) * Math.cos(azimuth),
  )
}

// The A–Z index is a readable FRONT ARC (Fork 1 — an index you must spin to
// finish is a bad index): two gentle rows spanning ±54°, first half up top so
// reading flows A(top-left)…→…(bottom-right). Spin still nudges it.
function letterArcPosition(i: number, n: number): THREE.Vector3 {
  const perRow = Math.ceil(n / 2)
  const top = i < perRow
  const idx = top ? i : i - perRow
  const count = top ? perRow : n - perRow
  const t = count <= 1 ? 0.5 : idx / (count - 1)
  const az = THREE.MathUtils.lerp(-LETTER_AZ, LETTER_AZ, t)
  const elev = top ? 0.3 : -0.1
  return new THREE.Vector3(
    ARC_RADIUS * Math.cos(elev) * Math.sin(az),
    HEAD + ARC_RADIUS * Math.sin(elev),
    -ARC_RADIUS * Math.cos(elev) * Math.cos(az),
  )
}

// Throttle cover loads: 72 simultaneous image decodes + GPU uploads in one
// burst can lose the WebGL context (observed on desktop Chrome). A small
// queue keeps the pipeline smooth, and downscaling to ≤256px via canvas keeps
// covers cheap on Quest memory.
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
      // img.onload, NOT img.decode() — decode() throws EncodingError on the
      // data-URLs the Quest browser sometimes hands back.
      img.onload = () => {
        const scale = Math.min(1, 256 / img.height)
        const c = document.createElement('canvas')
        c.width = Math.max(1, Math.round(img.width * scale))
        c.height = Math.max(1, Math.round(img.height * scale))
        c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
        const tex = new THREE.CanvasTexture(c)
        tex.colorSpace = THREE.SRGBColorSpace
        // Mipmaps reduce the minification shimmer on covers far back in the dome
        // (WebGL2 on the Quest handles NPOT mipmaps fine).
        tex.generateMipmaps = true
        tex.minFilter = THREE.LinearMipmapLinearFilter
        tex.magFilter = THREE.LinearFilter
        resolve(tex)
      }
      img.onerror = () => reject(new Error(`thumb failed: ${url}`))
      img.src = url
    })
  } finally {
    release()
  }
}

// A single cover in the surround dome: flies in from outside, grows on hover,
// select fires its onSelect. Every textured material is keyed on the texture
// (a map assigned after first compile is ignored → the plane renders flat
// white forever; the project's signature bug, applied preemptively).
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
  const texRef = useRef<THREE.Texture | null>(null)
  const [hover, setHover] = useState(false)
  const born = useRef<number | null>(null)

  const start = useMemo(
    () => new THREE.Vector3(target.x * 3.4, target.y - 2.2, target.z * 3.4),
    [target],
  )

  useEffect(() => {
    let dead = false
    loadThumb(item.thumb)
      .then((t) => {
        if (dead) t.dispose()
        else {
          texRef.current = t
          setTex(t)
        }
      })
      .catch(() => {})
    // Dispose the texture directly via a ref — a setState updater in unmount
    // cleanup isn't reliably run on an unmounted fiber, which leaked one texture
    // per cover on every nav.
    return () => {
      dead = true
      texRef.current?.dispose()
      texRef.current = null
    }
  }, [item.thumb])

  useFrame(({ clock }) => {
    const g = group.current
    if (!g) return
    if (born.current === null) born.current = clock.elapsedTime * 1000
    const t = Math.min(Math.max((clock.elapsedTime * 1000 - born.current - delay) / FLY_MS, 0), 1)
    const e = 1 - Math.pow(1 - t, 5) // ease-out-quint
    g.position.lerpVectors(start, target, e)
    g.lookAt(0, HEAD, 0)
    const scl = THREE.MathUtils.lerp(g.scale.x, hover ? HOVER_SCALE : 1, 0.18)
    g.scale.setScalar(scl)
  })

  return (
    <group ref={group}>
      <mesh position={[0, 0, -0.006]}>
        <planeGeometry args={[CARD_W + 0.02, CARD_H + 0.02]} />
        <meshBasicMaterial color={hover ? '#e2483a' : '#1a1411'} toneMapped={false} side={THREE.DoubleSide} />
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
          <Text raycast={() => null} fontSize={0.038} maxWidth={CARD_W * 1.9} textAlign="center" anchorY="top" color="#f2eeea" outlineWidth={0.003} outlineColor="#141010">
            {item.title}
          </Text>
          <Text raycast={() => null} position={[0, -0.1, 0]} fontSize={0.026} maxWidth={CARD_W * 1.9} textAlign="center" anchorY="top" color="#c9beb8" outlineWidth={0.002} outlineColor="#141010">
            {item.subtitle}
          </Text>
        </group>
      )}
    </group>
  )
}

// One A–Z stack in the index arc: a short fan of cards (misregistration
// offsets — the pulp print vibe), the top card carrying the bucket's first
// real cover, a big outlined letter, and a red count badge. Thickness of the
// pile scales with bucket size so the library's lopsidedness (V=82) reads at a
// glance. Only the top card loads a texture — 21 stacks × 1 thumb, not ×5.
function LetterStack({
  bucket,
  target,
  delay,
  onPick,
}: {
  bucket: LetterBucket
  target: THREE.Vector3
  delay: number
  onPick: (letter: string) => void
}) {
  const group = useRef<THREE.Group>(null)
  const [tex, setTex] = useState<THREE.Texture | null>(null)
  const texRef = useRef<THREE.Texture | null>(null)
  const [hover, setHover] = useState(false)
  const born = useRef<number | null>(null)

  // pile depth scaled by bucket size (clamped) — a fat brick for V, a wafer for singletons
  const depth = THREE.MathUtils.clamp(bucket.series.length / 24, 0.08, 0.55)
  const backs = Math.min(4, 1 + Math.round(depth * 6))

  useEffect(() => {
    let dead = false
    const first = bucket.series[0]
    if (!first) return
    loadThumb(seriesThumbUrl(first.id))
      .then((t) => {
        if (dead) t.dispose()
        else {
          texRef.current = t
          setTex(t)
        }
      })
      .catch(() => {})
    // Dispose via ref, not a setState updater in cleanup (unreliable on unmount).
    return () => {
      dead = true
      texRef.current?.dispose()
      texRef.current = null
    }
  }, [bucket])

  useFrame(({ clock }) => {
    const g = group.current
    if (!g) return
    if (born.current === null) born.current = clock.elapsedTime * 1000
    const t = Math.min(Math.max((clock.elapsedTime * 1000 - born.current - delay) / 520, 0), 1)
    const e = 1 - Math.pow(1 - t, 4)
    g.position.copy(target)
    g.lookAt(0, HEAD, 0)
    const scl = THREE.MathUtils.lerp(g.scale.x, (hover ? 1.16 : 1) * e, 0.2)
    g.scale.setScalar(scl)
  })

  return (
    <group ref={group} scale={0.001}>
      {/* fanned backing cards — offset for the misregistration pile look */}
      {Array.from({ length: backs }, (_, k) => (
        <mesh key={k} position={[(-k - 1) * 0.012, (k + 1) * 0.012, -(k + 1) * 0.01]} rotation={[0, 0, (k % 2 ? 1 : -1) * 0.02]}>
          <planeGeometry args={[CARD_W, CARD_H]} />
          <meshBasicMaterial color={k % 2 ? '#241d1a' : '#171210'} toneMapped={false} side={THREE.DoubleSide} />
        </mesh>
      ))}
      {/* top card — carries the bucket's first real cover */}
      <mesh
        onPointerOver={(e) => {
          e.stopPropagation()
          setHover(true)
        }}
        onPointerOut={() => setHover(false)}
        onClick={(e) => {
          e.stopPropagation()
          onPick(bucket.letter)
        }}
      >
        <planeGeometry args={[CARD_W, CARD_H]} />
        <meshBasicMaterial
          key={tex ? tex.uuid : 'placeholder'}
          map={tex}
          color={tex ? '#8a7d75' : '#2a2320'}
          toneMapped={false}
          side={THREE.DoubleSide}
        />
      </mesh>
      {/* big letter, strongly outlined so it reads on any cover. raycast off
          so pointing dead-centre on the glyph still selects the card beneath. */}
      <Text raycast={() => null} position={[0, 0.02, 0.02]} fontSize={0.34} anchorX="center" anchorY="middle" color={hover ? '#ffffff' : '#f2eeea'} outlineWidth={0.014} outlineColor="#141010">
        {bucket.letter}
      </Text>
      {/* count badge */}
      <Text raycast={() => null} position={[0, -(CARD_H / 2) - 0.07, 0.02]} fontSize={0.06} anchorX="center" anchorY="middle" color="#e2483a" outlineWidth={0.004} outlineColor="#141010">
        {`${bucket.letter} · ${bucket.series.length}`}
      </Text>
    </group>
  )
}

export interface LibrarySphereProps {
  onOpenBook: (book: KomgaBook) => void
  onClose?: () => void
}

// nav state — what's currently surrounding you
type Nav =
  | { kind: 'recent' }
  | { kind: 'letters' }
  | { kind: 'series'; letter: string }
  | { kind: 'books'; letter: string; seriesName: string }

const _q = new THREE.Quaternion()
const _dir = new THREE.Vector3()

// The in-VR library: RECENT (your warm shelf) or A–Z (letter stacks → a
// letter's series → a series' issues), each drill a "surround me with X"
// reveal. A world-fixed control bar (Back / mode / page / Exit) sits low-front,
// OUTSIDE the spinning group so the grab pointer never eats it.
export function LibrarySphere({ onOpenBook, onClose }: LibrarySphereProps) {
  const [recent, setRecent] = useState<SphereItem[] | null>(null)
  const [buckets, setBuckets] = useState<LetterBucket[] | null>(null)
  const [books, setBooks] = useState<KomgaBook[] | null>(null)
  const [busy, setBusy] = useState(false)
  // Distinguish "still loading" from "loaded, empty" from "couldn't reach Komga"
  // (incl. the fail-closed 503) — otherwise every failure looks like an empty
  // library. null = still loading the initial shelf.
  const [loadError, setLoadError] = useState<string | null>(null)
  const [nav, setNav] = useState<Nav>({ kind: 'recent' })
  const [page, setPage] = useState(0)

  const inXR = useXR((s) => s.session != null)
  const rotGroup = useRef<THREE.Group>(null)
  const drag = useRef<{ hand: number; az: number; moved: number } | null>(null)
  const suppressClick = useRef(false)
  const reqRef = useRef(0) // guards drillIntoSeries against out-of-order listBooks
  const right = useXRInputSourceState('controller', 'right')
  const left = useXRInputSourceState('controller', 'left')

  // Re-centre the shell to front on every level/page change. The A–Z index is
  // a readable FRONT arc, but rotGroup keeps whatever spin the user left on the
  // last cover dome — without this, switching to A–Z (or drilling / paging)
  // shows the new content swung off to the side or behind you. (Only fires on
  // nav/page transitions, never mid-spin, so it doesn't fight the gesture.)
  useEffect(() => {
    if (rotGroup.current) rotGroup.current.rotation.y = 0
  }, [nav, page])

  // trigger-drag spin + right-stick spin — tracked at the CONTROLLER level (its
  // pointing azimuth from the XR pose), so pulling works aimed at covers, gaps,
  // or empty void alike, and the ray visuals stay untouched.
  useFrame((state, dt, frame: XRFrame | undefined) => {
    const g = rotGroup.current
    if (!g) return
    const stick = right?.gamepad?.['xr-standard-thumbstick'] as { xAxis?: number } | undefined
    const x = stick?.xAxis ?? 0
    if (Math.abs(x) > 0.2) g.rotation.y -= x * dt * 1.6

    if (!frame) return
    const refSpace = state.gl.xr.getReferenceSpace()
    if (!refSpace) return
    const hands = [right, left]
    for (let i = 0; i < hands.length; i++) {
      const ctrl = hands[i]
      const pressed =
        (ctrl?.gamepad?.['xr-standard-trigger'] as { state?: string } | undefined)?.state === 'pressed'
      const src = ctrl?.inputSource
      if (!src) continue
      if (pressed) {
        const pose = frame.getPose(src.targetRaySpace, refSpace)
        if (!pose) continue
        const o = pose.transform.orientation
        _q.set(o.x, o.y, o.z, o.w)
        _dir.set(0, 0, -1).applyQuaternion(_q)
        const az = Math.atan2(_dir.x, -_dir.z)
        const d = drag.current
        if (d && d.hand === i) {
          let delta = az - d.az
          if (delta > Math.PI) delta -= Math.PI * 2
          if (delta < -Math.PI) delta += Math.PI * 2
          g.rotation.y -= delta
          d.az = az
          d.moved += Math.abs(delta)
          if (d.moved > 0.06) suppressClick.current = true
        } else if (!d) {
          drag.current = { hand: i, az, moved: 0 }
          suppressClick.current = false
        }
      } else if (drag.current?.hand === i) {
        drag.current = null
        setTimeout(() => (suppressClick.current = false), 80)
      }
    }
  })

  // Load the warm shelf (in-progress + on-deck + series) and the A–Z buckets
  // up front — both are single calls; the sphere paginates the display.
  useEffect(() => {
    let dead = false
    Promise.allSettled([listInProgress(), listOnDeck(), listSeries()]).then(([inProg, onDeck, series]) => {
      if (dead) return
      // listSeries is the load-bearing call: if it failed, the whole shelf is
      // unavailable — surface WHY (503 gate / Komga down) instead of "empty".
      if (series.status === 'rejected') {
        setLoadError(
          series.reason instanceof Error ? series.reason.message : 'Couldn’t reach Komga.',
        )
      }
      const seriesList = series.status === 'fulfilled' ? series.value : []
      setBuckets(bucketSeriesByFirstLetter(seriesList))

      const out: SphereItem[] = []
      const seen = new Set<string>()
      const addBook = (b: KomgaBook, sub: string) => {
        if (seen.has(b.id) || out.length >= PAGE_SIZE) return
        seen.add(b.id)
        out.push({
          key: `b:${b.id}`,
          title: b.seriesTitle,
          subtitle: sub,
          thumb: bookThumbUrl(b.id),
          onSelect: () => onOpenBook(b),
        })
      }
      if (inProg.status === 'fulfilled')
        inProg.value.forEach((b) => addBook(b, `continue · p${b.readProgress?.page ?? 1}/${b.media.pagesCount}`))
      if (onDeck.status === 'fulfilled') onDeck.value.forEach((b) => addBook(b, 'on deck'))
      for (const s of seriesList) {
        if (out.length >= PAGE_SIZE) break
        out.push(seriesToItem(s))
      }
      setRecent(out)
    })
    return () => {
      dead = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // A series cover: 1-book series (Sam's "Volume NN" one-shots) open straight
  // to the book — a one-shot must not cost a pointless second tap; multi-issue
  // series drill into their issues.
  function seriesToItem(s: KomgaSeries): SphereItem {
    return {
      key: `s:${s.id}`,
      title: s.name,
      subtitle: `${s.booksCount} book${s.booksCount === 1 ? '' : 's'}`,
      thumb: seriesThumbUrl(s.id),
      onSelect: () => {
        if (s.booksCount <= 1) {
          void firstUnreadBook(s.id).then((b) => b && onOpenBook(b))
        } else {
          drillIntoSeries(s)
        }
      },
    }
  }

  async function drillIntoSeries(s: KomgaSeries) {
    // derive the letter from the series itself (not the current nav) so Back
    // lands on the right bucket even when drilled straight from RECENT, and so
    // there's no stale-nav closure when a recent item triggers this later.
    const req = ++reqRef.current
    setNav({ kind: 'books', letter: letterOf(s.name), seriesName: s.name })
    setPage(0)
    setBooks(null)
    setBusy(true)
    try {
      const bs = await listBooks(s.id)
      // a fast double-drill (A → Back → B) can leave two fetches racing; only
      // the latest wins, so B's issues never get clobbered by A's late reply.
      if (reqRef.current === req) setBooks(bs)
    } finally {
      if (reqRef.current === req) setBusy(false)
    }
  }

  function selectLetter(letter: string) {
    setNav({ kind: 'series', letter })
    setPage(0)
  }

  function goBack() {
    if (nav.kind === 'books') setNav({ kind: 'series', letter: nav.letter })
    else if (nav.kind === 'series') setNav({ kind: 'letters' })
    else if (nav.kind === 'letters') setNav({ kind: 'recent' })
    setPage(0)
  }

  function setMode(mode: 'recent' | 'az') {
    setNav(mode === 'recent' ? { kind: 'recent' } : { kind: 'letters' })
    setPage(0)
  }

  // the full surround set for the current level (before paging)
  const surroundAll = useMemo<SphereItem[]>(() => {
    if (nav.kind === 'recent') return recent ?? []
    if (nav.kind === 'series') {
      const b = buckets?.find((x) => x.letter === nav.letter)
      return b ? b.series.map(seriesToItem) : []
    }
    if (nav.kind === 'books') {
      return (books ?? []).map((b) => ({
        key: `bk:${b.id}`,
        title: b.seriesTitle,
        subtitle: b.name,
        thumb: bookThumbUrl(b.id),
        onSelect: () => onOpenBook(b),
      }))
    }
    return []
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nav, recent, buckets, books])

  const totalPages = Math.max(1, Math.ceil(surroundAll.length / PAGE_SIZE))
  const pageItems = useMemo(
    () => surroundAll.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE),
    [surroundAll, page],
  )
  const targets = useMemo(() => pageItems.map((_, i) => bandPosition(i, pageItems.length)), [pageItems])
  const letterTargets = useMemo(
    () => (buckets ? buckets.map((_, i) => letterArcPosition(i, buckets.length)) : []),
    [buckets],
  )

  const activate = (item: SphereItem) => {
    if (suppressClick.current) return // that "click" was the tail end of a pull
    item.onSelect()
  }
  const activateLetter = (letter: string) => {
    if (suppressClick.current) return
    selectLetter(letter)
  }

  const breadcrumb = useMemo(() => {
    if (nav.kind === 'recent') return 'Recent'
    if (nav.kind === 'letters') return 'Shelves · A–Z'
    if (nav.kind === 'series') return `A–Z · ${nav.letter}`
    return `A–Z · ${nav.letter} · ${nav.seriesName}`
  }, [nav])

  // Still fetching the initial shelf (vs loaded-empty vs failed).
  const initialLoading = recent === null && buckets === null && !loadError

  return (
    <group>
      {/* the rotating shell — spun by trigger-drag or the right stick; desktop
          orbits with the mouse. Content is either the A–Z index arc or the
          surround dome of covers. */}
      <group ref={rotGroup}>
        {nav.kind === 'letters'
          ? (buckets ?? []).map((b, i) => (
              <LetterStack key={`L:${b.letter}`} bucket={b} target={letterTargets[i]} delay={i * 18} onPick={activateLetter} />
            ))
          : pageItems.map((item, i) => (
              <Cover key={`${item.key}#${page}`} item={item} target={targets[i]} delay={i * STAGGER_MS} onPick={activate} />
            ))}
      </group>

      {/* state text for the current surround: error > initial-load > drilling >
          empty. The error case (incl. the fail-closed 503) shows WHY, so a
          brand-new self-hoster isn't staring at a wordless void. */}
      {loadError ? (
        <group position={[0, HEAD, -2]}>
          <Text raycast={() => null} fontSize={0.09} color="#e2483a" anchorX="center" anchorY="bottom" outlineWidth={0.004} outlineColor="#141010">
            Can’t load your library
          </Text>
          <Text raycast={() => null} position={[0, -0.12, 0]} fontSize={0.055} maxWidth={2.6} textAlign="center" color="#c9beb8" anchorX="center" anchorY="top" outlineWidth={0.003} outlineColor="#141010">
            {loadError}
          </Text>
        </group>
      ) : initialLoading || busy ? (
        <Text raycast={() => null} position={[0, HEAD, -2]} fontSize={0.1} color="#c9beb8" anchorX="center" outlineWidth={0.004} outlineColor="#141010">
          Loading…
        </Text>
      ) : nav.kind !== 'letters' && surroundAll.length === 0 ? (
        <Text raycast={() => null} position={[0, HEAD, -2]} fontSize={0.08} color="#c9beb8" anchorX="center" outlineWidth={0.004} outlineColor="#141010">
          Your library is empty
        </Text>
      ) : null}

      {/* world-fixed control bar (sibling of the spinning group → the grab
          pointer can't eat it). Two compact rows: pagination flanks the
          breadcrumb; nav/mode/exit below. Point-and-trigger UIButtons echo
          the 2D system. */}
      <group position={[0, HEAD, -1.7]}>
        {totalPages > 1 && (
          <UIButton position={[-0.86, -0.28, 0]} width={0.16} label="◀" onClick={() => setPage((p) => Math.max(0, p - 1))} />
        )}
        <Text raycast={() => null} position={[0, -0.28, 0]} fontSize={0.056} maxWidth={1.5} textAlign="center" anchorX="center" anchorY="middle" color="#f2eeea" outlineWidth={0.004} outlineColor="#141010">
          {totalPages > 1 ? `${breadcrumb}  ·  page ${page + 1}/${totalPages}` : breadcrumb}
        </Text>
        {totalPages > 1 && (
          <UIButton position={[0.86, -0.28, 0]} width={0.16} label="▶" onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))} />
        )}

        {nav.kind !== 'recent' && (
          <UIButton position={[-0.86, -0.5, 0]} width={0.3} label="◀ Back" onClick={goBack} />
        )}
        <UIButton position={[-0.48, -0.5, 0]} width={0.32} label="Recent" accent={nav.kind === 'recent'} onClick={() => setMode('recent')} />
        <UIButton position={[-0.1, -0.5, 0]} width={0.26} label="A–Z" accent={nav.kind !== 'recent'} onClick={() => setMode('az')} />
        {onClose && <UIButton position={[0.34, -0.5, 0]} width={0.34} label="✕ Close" onClick={onClose} />}
        {inXR && <UIButton position={[0.8, -0.5, 0]} width={0.3} label="Exit VR" onClick={exitVR} />}
      </group>

      {!inXR && <OrbitControls target={[0, HEAD, -0.01]} enablePan={false} enableZoom={false} />}
    </group>
  )
}
