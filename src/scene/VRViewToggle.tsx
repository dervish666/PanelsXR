import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { useXRInputSourceState } from '@react-three/xr'

// Left controller Y button toggles the 3D library (X is recenter, see Reader).
export function VRViewToggle({ onToggle }: { onToggle: () => void }) {
  const left = useXRInputSourceState('controller', 'left')
  const was = useRef(false)

  useFrame(() => {
    const pressed =
      (left?.gamepad?.['y-button'] as { state?: string } | undefined)?.state === 'pressed'
    if (pressed && !was.current) onToggle()
    was.current = pressed
  })

  return null
}
