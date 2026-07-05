import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { useXRInputSourceState } from '@react-three/xr'

export interface XRHandPageInputProps {
  onNext: () => void
  onPrev: () => void
  enabled?: boolean
}

// Turn pages by waving a hand across the page (Quest hand tracking). We read the
// wrist joint's world position each frame, smooth its horizontal velocity, and
// fire a page turn when a swipe is fast enough and clearly horizontal — a
// right-to-left sweep advances (the physical "flip the page over" direction),
// left-to-right goes back. Wrist (not fingertip) so finger wiggles don't count.
//
// NOTE: hand tracking cannot be exercised in the desktop emulator — the gesture
// thresholds below are first-pass and meant to be tuned on the real Quest.
const SWIPE_VEL = 0.9 // m/s — smoothed horizontal hand speed that counts as a swipe
const H_DOMINANCE = 1.4 // the motion must be this much more horizontal than vertical
const COOLDOWN = 0.6 // s — one wave = one page; also swallows the return stroke
const SMOOTH = 0.5 // velocity smoothing (0..1, higher = snappier/noisier)

interface HandTrack {
  lastX: number
  lastY: number
  vx: number
  vy: number
  cooldownUntil: number
  tracking: boolean
}

const freshTrack = (): HandTrack => ({
  lastX: 0,
  lastY: 0,
  vx: 0,
  vy: 0,
  cooldownUntil: 0,
  tracking: false,
})

export function XRHandPageInput({ onNext, onPrev, enabled = true }: XRHandPageInputProps) {
  const right = useXRInputSourceState('hand', 'right')
  const left = useXRInputSourceState('hand', 'left')
  const tracks = useRef({ left: freshTrack(), right: freshTrack() })

  useFrame((state, dt, frame: XRFrame | undefined) => {
    if (!enabled || !frame) return
    const refSpace = state.gl.xr.getReferenceSpace()
    if (!refSpace || !frame.getJointPose) return
    const now = state.clock.elapsedTime

    const hands: Array<[HandTrack, typeof left]> = [
      [tracks.current.left, left],
      [tracks.current.right, right],
    ]
    for (const [t, hand] of hands) {
      const wrist = hand?.inputSource?.hand?.get('wrist')
      const pose = wrist ? frame.getJointPose(wrist, refSpace) : undefined
      if (!pose) {
        t.tracking = false
        continue
      }
      const x = pose.transform.position.x
      const y = pose.transform.position.y
      if (!t.tracking) {
        t.lastX = x
        t.lastY = y
        t.vx = 0
        t.vy = 0
        t.tracking = true
        continue
      }
      const d = Math.max(dt, 0.001)
      t.vx = t.vx * (1 - SMOOTH) + ((x - t.lastX) / d) * SMOOTH
      t.vy = t.vy * (1 - SMOOTH) + ((y - t.lastY) / d) * SMOOTH
      t.lastX = x
      t.lastY = y

      if (now < t.cooldownUntil) continue
      if (Math.abs(t.vx) > SWIPE_VEL && Math.abs(t.vx) > H_DOMINANCE * Math.abs(t.vy)) {
        if (t.vx < 0) onNext()
        else onPrev()
        t.cooldownUntil = now + COOLDOWN
      }
    }
  })

  return null
}
