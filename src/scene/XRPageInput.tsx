import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { useXRInputSourceState } from '@react-three/xr'

export interface XRPageInputProps {
  onNext: () => void // right stick flick: always a whole page
  onPrev: () => void
  onA?: () => void // A/B: a panel step in panel mode, else a page (default)
  onB?: () => void
  onStickClick?: () => void // right thumbstick press: toggle panel mode
}

const FIRE = 0.6 // thumbstick deflection that triggers a page turn
const RESET = 0.3 // must return inside this before another turn can fire

type Btn = { state?: string } | undefined
const pressed = (b: Btn) => b?.state === 'pressed'

// Reads the RIGHT thumbstick (and the right A/B buttons) to turn pages, with
// edge detection so one flick = exactly one page. The left stick is reserved
// for locomotion, so paging is deliberately right-hand only. The stick click
// toggles panel mode (left Y is the library, left X recenters).
export function XRPageInput({ onNext, onPrev, onA, onB, onStickClick }: XRPageInputProps) {
  const right = useXRInputSourceState('controller', 'right')
  const armed = useRef(true)
  const clickWas = useRef(false)

  useFrame(() => {
    const stick = right?.gamepad?.['xr-standard-thumbstick'] as
      | { xAxis?: number; state?: string }
      | undefined
    const x = stick?.xAxis ?? 0

    const a = pressed(right?.gamepad?.['a-button'] as Btn)
    const b = pressed(right?.gamepad?.['b-button'] as Btn)

    if (armed.current) {
      if (x > FIRE) {
        onNext()
        armed.current = false
      } else if (x < -FIRE) {
        onPrev()
        armed.current = false
      } else if (a) {
        ;(onA ?? onNext)()
        armed.current = false
      } else if (b) {
        ;(onB ?? onPrev)()
        armed.current = false
      }
    } else if (Math.abs(x) < RESET && !a && !b) {
      armed.current = true
    }

    const click = pressed(stick)
    if (click && !clickWas.current) onStickClick?.()
    clickWas.current = click
  })

  return null
}
