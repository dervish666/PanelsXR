import { useState } from 'react'
import { Text } from '@react-three/drei'
import * as THREE from 'three'

const H = 0.11
const KEYLINE = 0.014 // black border around the face
const SHADOW = 0.018 // hard-offset "print misregistration" shadow (down-right)

const INK_BLACK = '#120d0b'
const SURFACE = '#241d1a'
const ACCENT = '#b02c22'
const ACCENT_HI = '#e2483a'

export interface UIButtonProps {
  position: [number, number, number]
  width: number
  label: string
  accent?: boolean
  onClick: () => void
}

// A 3D sticker button — the in-VR twin of the 2D `.btn`: a dark (or red) plate
// with a heavy black keyline and a hard-offset shadow, red on hover. Layered
// planes give the shadow/keyline the same "printed sticker" look the front
// screen has. Point-and-trigger to press.
export function UIButton({ position, width, label, accent = false, onClick }: UIButtonProps) {
  const [hover, setHover] = useState(false)
  const face = hover ? ACCENT_HI : accent ? ACCENT : SURFACE
  // hover lifts the plate toward the viewer and reddens the shadow — the 3D
  // equivalent of the 2D hover (translate up-left + red box-shadow).
  const shadowColor = hover ? ACCENT_HI : INK_BLACK
  const lift = hover ? 0.006 : 0

  return (
    <group position={position}>
      {/* hard-offset shadow */}
      <mesh position={[SHADOW, -SHADOW, -0.006]}>
        <planeGeometry args={[width, H]} />
        <meshBasicMaterial color={shadowColor} toneMapped={false} />
      </mesh>
      {/* black keyline */}
      <mesh position={[0, 0, -0.003 + lift]}>
        <planeGeometry args={[width + KEYLINE, H + KEYLINE]} />
        <meshBasicMaterial color={INK_BLACK} toneMapped={false} />
      </mesh>
      {/* face — the interactive plate */}
      <mesh
        position={[0, 0, lift]}
        onPointerOver={(e) => {
          e.stopPropagation()
          setHover(true)
        }}
        onPointerOut={() => setHover(false)}
        // swallow the press so a trigger-press here can't start a page grab
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation()
          onClick()
        }}
      >
        <planeGeometry args={[width, H]} />
        <meshBasicMaterial color={face} toneMapped={false} side={THREE.DoubleSide} />
      </mesh>
      <Text
        raycast={() => null}
        position={[0, 0, lift + 0.004]}
        fontSize={0.042}
        color={hover ? '#1a0f0d' : '#f2eeea'}
        anchorX="center"
        anchorY="middle"
        maxWidth={width * 0.94}
      >
        {label}
      </Text>
    </group>
  )
}
