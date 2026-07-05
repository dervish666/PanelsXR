import { useRef } from 'react'
import type { ThreeEvent } from '@react-three/fiber'
import * as THREE from 'three'

const INK_BLACK = '#120d0b'
const TRACK = '#2a2320'
const ACCENT = '#b02c22'
const ACCENT_HI = '#e2483a'
const TRACK_H = 0.035
const HIT_H = 0.16 // taller invisible target so the ray lands easily
const THUMB_W = 0.05
const THUMB_H = 0.1

export interface Slider3DProps {
  position: [number, number, number]
  width: number
  value: number // 0..1
  onChange: (v: number) => void
}

// A point-and-drag slider for VR. The hit plane's UV.x (0 at the left edge, 1 at
// the right) is read directly as the value, so you can point anywhere on the
// track to jump there, or hold the trigger and drag. It's a sibling of the page
// (in the control bar), so the trigger drives the slider, not a page grab.
export function Slider3D({ position, width, value, onChange }: Slider3DProps) {
  const pressed = useRef(false)
  const v = Math.max(0, Math.min(1, value))
  const thumbX = (v - 0.5) * width

  const setFromEvent = (e: ThreeEvent<PointerEvent>) => {
    if (e.uv) onChange(Math.max(0, Math.min(1, e.uv.x)))
  }

  return (
    <group position={position}>
      {/* keyline behind the track */}
      <mesh position={[0, 0, -0.003]}>
        <planeGeometry args={[width + 0.02, TRACK_H + 0.02]} />
        <meshBasicMaterial color={INK_BLACK} toneMapped={false} />
      </mesh>
      {/* track */}
      <mesh>
        <planeGeometry args={[width, TRACK_H]} />
        <meshBasicMaterial color={TRACK} toneMapped={false} />
      </mesh>
      {/* filled portion (left edge → thumb) */}
      {v > 0.01 && (
        <mesh position={[-width / 2 + (v * width) / 2, 0, 0.001]}>
          <planeGeometry args={[v * width, TRACK_H]} />
          <meshBasicMaterial color={ACCENT} toneMapped={false} />
        </mesh>
      )}
      {/* thumb — a little sticker plate */}
      <group position={[thumbX, 0, 0.004]}>
        <mesh position={[0.012, -0.012, -0.004]}>
          <planeGeometry args={[THUMB_W, THUMB_H]} />
          <meshBasicMaterial color={INK_BLACK} toneMapped={false} />
        </mesh>
        <mesh position={[0, 0, -0.002]}>
          <planeGeometry args={[THUMB_W + 0.012, THUMB_H + 0.012]} />
          <meshBasicMaterial color={INK_BLACK} toneMapped={false} />
        </mesh>
        <mesh>
          <planeGeometry args={[THUMB_W, THUMB_H]} />
          <meshBasicMaterial color={ACCENT_HI} toneMapped={false} side={THREE.DoubleSide} />
        </mesh>
      </group>
      {/* invisible hit area — UV drives the value; wider/taller for easy aiming */}
      <mesh
        position={[0, 0, 0.008]}
        onPointerDown={(e) => {
          e.stopPropagation()
          pressed.current = true
          ;(e.target as unknown as { setPointerCapture?: (id: number) => void }).setPointerCapture?.(
            e.pointerId,
          )
          setFromEvent(e)
        }}
        onPointerMove={(e) => {
          if (!pressed.current) return
          e.stopPropagation()
          setFromEvent(e)
        }}
        onPointerUp={(e) => {
          pressed.current = false
          ;(
            e.target as unknown as { releasePointerCapture?: (id: number) => void }
          ).releasePointerCapture?.(e.pointerId)
        }}
      >
        <planeGeometry args={[width, HIT_H]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
    </group>
  )
}
