import { useState } from 'react'
import { Text } from '@react-three/drei'

const H = 0.11

export interface UIButtonProps {
  position: [number, number, number]
  width: number
  label: string
  accent?: boolean
  onClick: () => void
}

// Minimal 3D pill button for in-VR (and desktop 3D-view) controls: pulp-dark
// plate, red on hover/accent, point-and-trigger to press.
export function UIButton({ position, width, label, accent = false, onClick }: UIButtonProps) {
  const [hover, setHover] = useState(false)
  const bg = hover ? '#e2483a' : accent ? '#b02c22' : '#241d1a'

  return (
    <group position={position}>
      <mesh
        onPointerOver={(e) => {
          e.stopPropagation()
          setHover(true)
        }}
        onPointerOut={() => setHover(false)}
        // swallow the press: without this, a trigger-press on a button inside
        // the grab <Handle> starts a grab and drags the whole comic around
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation()
          onClick()
        }}
      >
        <planeGeometry args={[width, H]} />
        <meshBasicMaterial color={bg} toneMapped={false} />
      </mesh>
      <Text
        position={[0, 0, 0.004]}
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
