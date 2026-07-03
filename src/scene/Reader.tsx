import { useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { Handle } from '@react-three/handle'
import {
  XROrigin,
  useXR,
  useXRControllerLocomotion,
  useXRInputSourceState,
} from '@react-three/xr'
import { Group, Vector3 } from 'three'
import { PageSurface } from './PageSurface'
import type { PageAmbience } from './PageSurface'
import { XRPageInput } from './XRPageInput'
import { UIButton } from './UIButton'
import { exitVR } from '../xr/store'

export interface ReaderProps {
  pages: string[]
  indices: number[] // visible page indices (1 = single, 2 = spread)
  onNext: () => void
  onPrev: () => void
  spread: boolean
  onToggleSpread: () => void
  onOpenLibrary: () => void
}

// Where the page sits when you enter VR / on desktop.
const INITIAL_PAGE_POS: [number, number, number] = [0, 1.35, -1.6]
const MOVE_SPEED = 1.2 // metres/sec for left-stick locomotion (gentle, seated-friendly)
const MOVE_DEADZONE = 0.15 // the locomotion hook applies no deadzone, so filter stick drift here

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
}: ReaderProps) {
  const inXR = useXR((s) => s.session != null)
  const pageRef = useRef<Group>(null)
  const originRef = useRef<Group>(null)
  const [ambience, setAmbience] = useState<PageAmbience | null>(null)

  const page = (
    <group ref={pageRef} position={INITIAL_PAGE_POS}>
      <PageSurface urls={pages} indices={indices} onAmbience={setAmbience} />
      {/* In-VR control bar under the comic — rides along when you grab it. */}
      {inXR && (
        <group position={[0, -0.92, 0.02]}>
          <UIButton position={[-0.72, 0, 0]} width={0.26} label="‹ Prev" onClick={onPrev} />
          <UIButton position={[-0.42, 0, 0]} width={0.26} label="Next ›" onClick={onNext} />
          <UIButton
            position={[-0.03, 0, 0]}
            width={0.42}
            label={spread ? 'Single page' : 'Two-page'}
            onClick={onToggleSpread}
          />
          <UIButton
            position={[0.36, 0, 0]}
            width={0.3}
            label="Library"
            accent
            onClick={onOpenLibrary}
          />
          <UIButton position={[0.71, 0, 0]} width={0.3} label="Exit VR" onClick={exitVR} />
        </group>
      )}
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

      <XRPageInput onNext={onNext} onPrev={onPrev} />

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
