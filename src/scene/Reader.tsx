import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { OrbitControls, Text } from '@react-three/drei'
import { Handle } from '@react-three/handle'
import {
  XROrigin,
  useXR,
  useXRControllerLocomotion,
  useXRInputSourceState,
} from '@react-three/xr'
import * as THREE from 'three'
import { Group, Matrix4, Vector3 } from 'three'
import { PageSurface } from './PageSurface'
import type { PageAmbience } from './PageSurface'
import { XRPageInput } from './XRPageInput'
import { XRHandPageInput } from './XRHandPageInput'
import { UIButton } from './UIButton'
import { Slider3D } from './Slider3D'
import { exitVR } from '../xr/store'

export interface ReaderProps {
  pages: string[]
  indices: number[] // visible page indices (1 = single, 2 = spread)
  onNext: () => void
  onPrev: () => void
  spread: boolean
  onToggleSpread: () => void
  onOpenLibrary: () => void
  curve: number // 0 = flat … 1 = full bend toward the viewer
  onCurveChange: (v: number) => void
  handGestures: boolean // wave-to-turn-page (Quest hand tracking)
}

// Where the page sits when you enter VR / on desktop.
const INITIAL_PAGE_POS: [number, number, number] = [0, 1.35, -1.6]
const MOVE_SPEED = 1.2 // metres/sec for left-stick locomotion (gentle, seated-friendly)
const MOVE_DEADZONE = 0.15 // the locomotion hook applies no deadzone, so filter stick drift here
const BAR_OFFSET = new Matrix4().makeTranslation(0, -0.92, 0.02)

// The in-VR control bar lives OUTSIDE the grab <Handle> (buttons inside it get
// picked up by the grab pointer on real hardware) and follows the comic by
// copying its world transform each frame — rides along, but can't be grabbed.
function ControlBar({
  pageRef,
  children,
}: {
  pageRef: React.RefObject<Group | null>
  children: React.ReactNode
}) {
  const barRef = useRef<Group>(null)
  const m = useRef(new Matrix4())
  useFrame(() => {
    const page = pageRef.current
    const bar = barRef.current
    if (!page || !bar) return
    page.updateWorldMatrix(true, false)
    m.current.multiplyMatrices(page.matrixWorld, BAR_OFFSET)
    m.current.decompose(bar.position, bar.quaternion, bar.scale)
  })
  return <group ref={barRef}>{children}</group>
}

// A rounded-rect shape centred on the origin — the base for the control tray.
function roundedRectShape(w: number, h: number, r: number): THREE.Shape {
  const s = new THREE.Shape()
  const x = -w / 2
  const y = -h / 2
  s.moveTo(x + r, y)
  s.lineTo(x + w - r, y)
  s.quadraticCurveTo(x + w, y, x + w, y + r)
  s.lineTo(x + w, y + h - r)
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  s.lineTo(x + r, y + h)
  s.quadraticCurveTo(x, y + h, x, y + h - r)
  s.lineTo(x, y + r)
  s.quadraticCurveTo(x, y, x + r, y)
  return s
}

// The control tray: a rounded dark plate with a black keyline and a hard-offset
// shadow — the 3D twin of the front-screen placard, so the in-VR controls read
// as part of the same app.
function Tray({ width, height }: { width: number; height: number }) {
  const geoms = useMemo(() => {
    const surf = new THREE.ShapeGeometry(roundedRectShape(width, height, 0.035))
    const key = new THREE.ShapeGeometry(roundedRectShape(width + 0.024, height + 0.024, 0.04))
    const shadow = new THREE.ShapeGeometry(roundedRectShape(width, height, 0.035))
    return { surf, key, shadow }
  }, [width, height])
  useEffect(
    () => () => {
      geoms.surf.dispose()
      geoms.key.dispose()
      geoms.shadow.dispose()
    },
    [geoms],
  )
  return (
    <group>
      <mesh geometry={geoms.shadow} position={[0.022, -0.022, -0.028]}>
        <meshBasicMaterial color="#120d0b" toneMapped={false} />
      </mesh>
      <mesh geometry={geoms.key} position={[0, 0, -0.024]}>
        <meshBasicMaterial color="#120d0b" toneMapped={false} />
      </mesh>
      <mesh geometry={geoms.surf} position={[0, 0, -0.02]}>
        <meshBasicMaterial color="#2a2320" toneMapped={false} />
      </mesh>
    </group>
  )
}

// Left-stick smooth locomotion + a left-X recenter. Right stick stays free for
// paging, so we drive locomotion via the callback form and ignore its rotation.
function VRMovement({
  pageRef,
  originRef,
}: {
  pageRef: React.RefObject<Group | null>
  originRef: React.RefObject<Group | null>
}) {
  useXRControllerLocomotion(
    (velocity: Vector3, _rotationY: number, delta: number) => {
      const origin = originRef.current
      if (!origin) return
      // The hook reuses one velocity vector and applies no deadzone; ignore tiny
      // values so stick drift doesn't creep the view (and so a right-stick page
      // flick can't nudge us via a stale vector).
      if (Math.hypot(velocity.x, velocity.z) < MOVE_DEADZONE) return
      origin.position.x += velocity.x * delta
      origin.position.z += velocity.z * delta
    },
    { speed: MOVE_SPEED },
    // No stick-turn: the right stick is for paging, not rotating the view. This
    // also stops the right-stick flick from driving locomotion at all.
    false,
  )

  const left = useXRInputSourceState('controller', 'left')
  const wasPressed = useRef(false)
  useFrame(() => {
    const pressed =
      (left?.gamepad?.['x-button'] as { state?: string } | undefined)?.state === 'pressed'
    if (pressed && !wasPressed.current) {
      const page = pageRef.current
      if (page) {
        page.position.set(...INITIAL_PAGE_POS)
        page.quaternion.identity()
        page.scale.setScalar(1)
      }
      const origin = originRef.current
      if (origin) {
        origin.position.set(0, 0, 0)
        origin.quaternion.identity()
      }
    }
    wasPressed.current = pressed
  })

  return <XROrigin ref={originRef} />
}

// Three tap zones over the page — the comic-reader standard: left third pages
// back, right third pages forward, middle opens/closes the controls. A sibling
// of the page (follows its world matrix, sits just in front) so it's outside
// the grab <Handle>; a controller trigger OR a hand pinch both "click" a zone.
// The zone you point at tints red and shows a hint. stopPropagation keeps a tap
// from also grabbing the page — grab/resize still works off the page's border.
const ZONE_OFFSET = new Matrix4().makeTranslation(0, 0, 0.05)
type ZoneId = 'prev' | 'mid' | 'next'

function TapZone({
  id,
  x,
  width,
  height,
  hover,
  setHover,
  onTap,
  hint,
}: {
  id: ZoneId
  x: number
  width: number
  height: number
  hover: ZoneId | null
  setHover: (fn: (h: ZoneId | null) => ZoneId | null) => void
  onTap: () => void
  hint: string
}) {
  const on = hover === id
  return (
    <group position={[x, 0, 0]}>
      <mesh
        onPointerOver={(e) => {
          e.stopPropagation()
          setHover(() => id)
        }}
        onPointerOut={() => setHover((h) => (h === id ? null : h))}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation()
          onTap()
        }}
      >
        <planeGeometry args={[width, height]} />
        <meshBasicMaterial color="#e2483a" transparent opacity={on ? 0.14 : 0} depthWrite={false} />
      </mesh>
      {on && (
        <Text
          raycast={() => null}
          position={[0, 0, 0.006]}
          fontSize={0.16}
          color="#f2eeea"
          outlineWidth={0.005}
          outlineColor="#141010"
          anchorX="center"
          anchorY="middle"
        >
          {hint}
        </Text>
      )}
    </group>
  )
}

function TapZones({
  pageRef,
  spread,
  onPrev,
  onNext,
  onToggleControls,
}: {
  pageRef: React.RefObject<Group | null>
  spread: boolean
  onPrev: () => void
  onNext: () => void
  onToggleControls: () => void
}) {
  const groupRef = useRef<Group>(null)
  const m = useRef(new Matrix4())
  const [hover, setHover] = useState<ZoneId | null>(null)
  useFrame(() => {
    const page = pageRef.current
    const g = groupRef.current
    if (!page || !g) return
    page.updateWorldMatrix(true, false)
    m.current.multiplyMatrices(page.matrixWorld, ZONE_OFFSET)
    m.current.decompose(g.position, g.quaternion, g.scale)
  })
  const w = spread ? 1.95 : 0.95
  const h = 1.5
  const zw = w / 3
  return (
    <group ref={groupRef}>
      <TapZone id="prev" x={-zw} width={zw} height={h} hover={hover} setHover={setHover} onTap={onPrev} hint="‹" />
      <TapZone id="mid" x={0} width={zw} height={h} hover={hover} setHover={setHover} onTap={onToggleControls} hint="•••" />
      <TapZone id="next" x={zw} width={zw} height={h} hover={hover} setHover={setHover} onTap={onNext} hint="›" />
    </group>
  )
}

// The reading scene. In VR the page is a grab handle (move / rotate / two-handed
// scale) and the left stick moves you around; on desktop we fall back to orbit.
export function Reader({
  pages,
  indices,
  onNext,
  onPrev,
  spread,
  onToggleSpread,
  onOpenLibrary,
  curve,
  onCurveChange,
  handGestures,
}: ReaderProps) {
  const inXR = useXR((s) => s.session != null)
  const pageRef = useRef<Group>(null)
  const originRef = useRef<Group>(null)
  const [ambience, setAmbience] = useState<PageAmbience | null>(null)
  // the middle tap zone shows/hides the control bar (the "options" zone)
  const [controlsVisible, setControlsVisible] = useState(true)

  const page = (
    <group ref={pageRef} position={INITIAL_PAGE_POS}>
      <PageSurface urls={pages} indices={indices} curve={curve} onAmbience={setAmbience} />
    </group>
  )

  return (
    <>
      {/* Room atmosphere: the void takes the page's dominant colour. (A big
          blurred page copy was tried behind it too — Sam judged it worse than
          colour alone, so it's just the wash now.) */}
      {ambience && <color attach="background" args={[ambience.color]} />}
      {inXR ? (
        // Grab the page with the trigger to move/rotate it; grab with both
        // controllers and pull apart to resize.
        <Handle translate rotate scale multitouch>
          {page}
        </Handle>
      ) : (
        page
      )}

      {inXR && (
        <TapZones
          pageRef={pageRef}
          spread={spread}
          onPrev={onPrev}
          onNext={onNext}
          onToggleControls={() => setControlsVisible((v) => !v)}
        />
      )}

      {inXR && controlsVisible && (
        <ControlBar pageRef={pageRef}>
          <Tray width={1.74} height={0.44} />
          {/* row 1 — paging + modes */}
          <UIButton position={[-0.61, 0.1, 0]} width={0.24} label="‹ Prev" onClick={onPrev} />
          <UIButton position={[-0.35, 0.1, 0]} width={0.24} label="Next ›" onClick={onNext} />
          <UIButton
            position={[-0.04, 0.1, 0]}
            width={0.34}
            label={spread ? 'Single' : 'Two-page'}
            onClick={onToggleSpread}
          />
          <UIButton position={[0.29, 0.1, 0]} width={0.28} label="Library" accent onClick={onOpenLibrary} />
          <UIButton position={[0.59, 0.1, 0]} width={0.28} label="Exit VR" onClick={exitVR} />
          {/* row 2 — curve comfort slider */}
          <Text
            raycast={() => null}
            position={[-0.68, -0.11, 0.004]}
            fontSize={0.045}
            anchorX="left"
            anchorY="middle"
            color="#c9beb8"
          >
            Curve
          </Text>
          <Slider3D position={[0.04, -0.11, 0]} width={0.82} value={curve} onChange={onCurveChange} />
          <Text
            raycast={() => null}
            position={[0.56, -0.11, 0.004]}
            fontSize={0.045}
            anchorX="left"
            anchorY="middle"
            color="#f2eeea"
          >
            {`${Math.round(curve * 100)}%`}
          </Text>
        </ControlBar>
      )}

      <XRPageInput onNext={onNext} onPrev={onPrev} />
      <XRHandPageInput onNext={onNext} onPrev={onPrev} enabled={handGestures} />

      {inXR ? (
        <VRMovement pageRef={pageRef} originRef={originRef} />
      ) : (
        <OrbitControls
          target={INITIAL_PAGE_POS}
          enablePan={false}
          minDistance={0.4}
          maxDistance={4}
        />
      )}
    </>
  )
}
