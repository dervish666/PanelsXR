import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { useXRInputSourceState } from '@react-three/xr'

export interface XRHandPageInputProps {
  onNext: () => void
  onPrev: () => void
  enabled?: boolean
}

// The optional "wave" gesture: wave a hand horizontally across the page to turn
// it — right-to-left advances, left-to-right goes back. Discrete tapping (the
// three page zones) and the controller are the primary paths; this is off by
// default because a swipe is inherently twitchy.
//
// It reads the wrist's world position each frame, smooths the horizontal
// velocity, and needs a fast, clearly-horizontal motion to fire. Crucially it
// then won't fire again until the hand SLOWS below RESET_VEL (velocity re-arm),
// so the return stroke can never retrigger it — the bug in the first cut, which
// used a time cooldown that a slow return stroke simply outlived.
//
// NOTE: hand tracking can't be exercised in the desktop emulator — the
// thresholds are meant to be tuned on the real Quest.
const SWIPE_VEL = 1.7 // m/s — smoothed horizontal speed to count as a swipe
const RESET_VEL = 0.4 // m/s — hand must slow below this to re-arm
const H_DOMINANCE = 1.5 // motion must be this much more horizontal than vertical
const SMOOTH = 0.5

interface HandTrack {
  lastX: number
  lastY: number
  vx: number
  vy: number
  armed: boolean
  tracking: boolean
}

const freshTrack = (): HandTrack => ({
  lastX: 0,
  lastY: 0,
  vx: 0,
  vy: 0,
  armed: true,
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

      if (t.armed) {
        if (Math.abs(t.vx) > SWIPE_VEL && Math.abs(t.vx) > H_DOMINANCE * Math.abs(t.vy)) {
          if (t.vx < 0) onNext()
          else onPrev()
          t.armed = false
        }
      } else if (Math.abs(t.vx) < RESET_VEL) {
        t.armed = true
      }
    }
  })

  return null
}
