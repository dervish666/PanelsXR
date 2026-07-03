import { useRef } from 'react'
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
import { XRPageInput } from './XRPageInput'

export interface ReaderProps {
  pages: string[]
  indices: number[] // visible page indices (1 = single, 2 = spread)
  onNext: () => void
  onPrev: () => void
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
export function Reader({ pages, indices, onNext, onPrev }: ReaderProps) {
  const inXR = useXR((s) => s.session != null)
  const pageRef = useRef<Group>(null)
  const originRef = useRef<Group>(null)

  const page = (
    <group ref={pageRef} position={INITIAL_PAGE_POS}>
      <PageSurface urls={pages} indices={indices} />
    </group>
  )

  return (
    <>
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
