import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { Canvas } from '@react-three/fiber'
import { XR } from '@react-three/xr'
import { xrStore } from './xr/store'
import { Reader } from './scene/Reader'
import { makeSyntheticPages } from './pages/synthetic'
import { loadCbz } from './pages/cbz'

export function App() {
  const [pages, setPages] = useState<string[]>(() => makeSyntheticPages(20))
  const [index, setIndex] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const next = useCallback(
    () => setIndex((i) => Math.min(i + 1, pages.length - 1)),
    [pages.length],
  )
  const prev = useCallback(() => setIndex((i) => Math.max(i - 1, 0)), [])

  // Reset to the first page whenever the book changes.
  useEffect(() => {
    setIndex(0)
  }, [pages])

  // Desktop fallback: arrow keys / space turn pages.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (['ArrowRight', 'ArrowDown', ' '].includes(e.key)) {
        e.preventDefault()
        next()
      } else if (['ArrowLeft', 'ArrowUp'].includes(e.key)) {
        e.preventDefault()
        prev()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [next, prev])

  const onPickCbz = useCallback(async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setError(null)
    try {
      const urls = await loadCbz(file)
      if (urls.length === 0) throw new Error('No image pages found in that archive.')
      setPages((prevPages) => {
        prevPages.forEach((u) => u.startsWith('blob:') && URL.revokeObjectURL(u))
        return urls
      })
    } catch (err) {
      console.error('[Panel] CBZ load failed', err)
      setError(err instanceof Error ? err.message : 'Could not load that file.')
    } finally {
      if (fileRef.current) fileRef.current.value = ''
    }
  }, [])

  return (
    <>
      <div className="overlay">
        <div className="brand">
          Panel <span>· v0</span>
        </div>
        <div className="controls">
          <button onClick={() => prev()} disabled={index === 0}>
            ‹ Prev
          </button>
          <span className="counter">
            {index + 1} / {pages.length}
          </span>
          <button onClick={() => next()} disabled={index >= pages.length - 1}>
            Next ›
          </button>
          <label className="file">
            Load .cbz
            <input
              ref={fileRef}
              type="file"
              accept=".cbz,.zip"
              onChange={onPickCbz}
              hidden
            />
          </label>
          <button className="enter" onClick={() => xrStore.enterVR()}>
            Enter VR
          </button>
        </div>
        {error && <div className="error">{error}</div>}
        <div className="hint">
          Turn pages: right stick / arrows · VR: hold the trigger to grab &amp; move the
          page (both triggers to resize), left stick to walk, X to recenter · Desktop:
          drag to look
        </div>
      </div>

      <Canvas camera={{ position: [0, 1.4, 0.35], fov: 60 }} gl={{ antialias: true }}>
        <color attach="background" args={['#0e0e12']} />
        <XR store={xrStore}>
          <Reader pages={pages} index={index} onNext={next} onPrev={prev} />
        </XR>
      </Canvas>
    </>
  )
}
