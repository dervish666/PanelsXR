import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { useXRInputSourceState } from '@react-three/xr'

export interface XRPageInputProps {
  onNext: () => void
  onPrev: () => void
}

const FIRE = 0.6 // thumbstick deflection that triggers a page turn
const RESET = 0.3 // must return inside this before another turn can fire

// Reads the RIGHT thumbstick (and the right A/B buttons) to turn pages, with
// edge detection so one flick = exactly one page. The left stick is reserved
// for locomotion, so paging is deliberately right-hand only.
export function XRPageInput({ onNext, onPrev }: XRPageInputProps) {
  const right = useXRInputSourceState('controller', 'right')
  const armed = useRef(true)

  useFrame(() => {
    const stick = right?.gamepad?.['xr-standard-thumbstick'] as
      | { xAxis?: number }
      | undefined
    const x = stick?.xAxis ?? 0

    const a =
      (right?.gamepad?.['a-button'] as { state?: string } | undefined)?.state === 'pressed'
    const b =
      (right?.gamepad?.['b-button'] as { state?: string } | undefined)?.state === 'pressed'

    if (armed.current) {
      if (x > FIRE || a) {
        onNext()
        armed.current = false
      } else if (x < -FIRE || b) {
        onPrev()
        armed.current = false
      }
    } else if (Math.abs(x) < RESET && !a && !b) {
      armed.current = true
    }
  })

  return null
}
