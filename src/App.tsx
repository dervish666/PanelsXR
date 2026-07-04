import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { Canvas } from '@react-three/fiber'
import { XR } from '@react-three/xr'
import { xrStore } from './xr/store'
import { Reader } from './scene/Reader'
import { LibrarySphere } from './scene/LibrarySphere'
import { VRViewToggle } from './scene/VRViewToggle'
import { makeSyntheticPages } from './pages/synthetic'
import { loadCbz } from './pages/cbz'
import { Library } from './ui/Library'
import { bookPageUrls, bookThumbUrl, getBook, saveProgress } from './komga/client'
import type { KomgaBook } from './komga/types'

const LAST_BOOK_KEY = 'panel.lastBookId'
const SPREAD_KEY = 'panel.spread'

export function App() {
  const [pages, setPages] = useState<string[]>(() => makeSyntheticPages(20))
  const [index, setIndex] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [showLibrary, setShowLibrary] = useState(false)
  const [view, setView] = useState<'read' | 'sphere'>('read')
  // chrome: the 2D shell. 'marquee' = the landing placard (the front door that
  // pops); 'hud' = the compact working strip once you've started. Collapses on
  // first real interaction so zero-friction resume is never gated.
  const [chrome, setChrome] = useState<'marquee' | 'hud'>('marquee')
  const [book, setBook] = useState<KomgaBook | null>(null)
  const [spread, setSpread] = useState(() => localStorage.getItem(SPREAD_KEY) === '1')
  const fileRef = useRef<HTMLInputElement>(null)

  // Spread pairing: the cover stands alone, then pages pair 2-3, 4-5, …
  // (0-indexed: [0], [1,2], [3,4] …). `pairStart` maps any index to its pair.
  const pairStart = (i: number) => (i === 0 ? 0 : i - ((i - 1) % 2))

  const visible = useMemo(() => {
    if (!spread || index === 0) return [index]
    const s = pairStart(index)
    return s + 1 < pages.length ? [s, s + 1] : [s]
  }, [spread, index, pages.length])

  const next = useCallback(
    () =>
      setIndex((i) => {
        const last = pages.length - 1
        if (!spread) return Math.min(i + 1, last)
        return Math.min(i === 0 ? 1 : pairStart(i) + 2, last)
      }),
    [pages.length, spread],
  )
  const prev = useCallback(
    () =>
      setIndex((i) => {
        if (!spread) return Math.max(i - 1, 0)
        const s = pairStart(i)
        return Math.max(s <= 1 ? 0 : s - 2, 0)
      }),
    [spread],
  )

  // Open a Komga book: pages stream straight from the server through the dev
  // proxy, and we resume at the server-side read progress (iPad → headset).
  // `collapseChrome` folds the placard away when a book is picked deliberately;
  // startup auto-resume passes false so the landing shows the warm shelf.
  const openBook = useCallback((b: KomgaBook, collapseChrome = true) => {
    const urls = bookPageUrls(b)
    setPages((prev) => {
      prev.forEach((u) => u.startsWith('blob:') && URL.revokeObjectURL(u))
      return urls
    })
    const rp = b.readProgress
    setIndex(rp && !rp.completed ? Math.min(rp.page - 1, urls.length - 1) : 0)
    setBook(b)
    setShowLibrary(false)
    setView('read')
    setError(null)
    if (collapseChrome) setChrome('hud')
    localStorage.setItem(LAST_BOOK_KEY, b.id)
  }, [])

  // On startup, reopen the last book (fresh from the server, so the resume
  // point reflects reading done elsewhere — e.g. on the iPad). Quietly falls
  // back to the synthetic pages if Komga is unreachable. Keeps the marquee up.
  useEffect(() => {
    const id = localStorage.getItem(LAST_BOOK_KEY)
    if (!id) return
    getBook(id)
      .then((b) => openBook(b, false))
      .catch(() => localStorage.removeItem(LAST_BOOK_KEY))
  }, [openBook])

  // Push read progress on page turn (debounced so flick-throughs don't spam).
  // In spread mode, report the furthest visible page.
  useEffect(() => {
    if (!book) return
    const furthest = Math.max(...visible) + 1
    const t = setTimeout(() => {
      void saveProgress(book.id, furthest, furthest >= book.media.pagesCount)
    }, 800)
    return () => clearTimeout(t)
  }, [book, visible])

  // Desktop fallback: arrow keys / space turn pages (and start reading).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (['ArrowRight', 'ArrowDown', ' '].includes(e.key)) {
        e.preventDefault()
        setChrome('hud')
        next()
      } else if (['ArrowLeft', 'ArrowUp'].includes(e.key)) {
        e.preventDefault()
        setChrome('hud')
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
      setIndex(0)
      setBook(null)
      setChrome('hud')
    } catch (err) {
      console.error('[Panel] CBZ load failed', err)
      setError(err instanceof Error ? err.message : 'Could not load that file.')
    } finally {
      if (fileRef.current) fileRef.current.value = ''
    }
  }, [])

  const toggleSpread = useCallback(
    () =>
      setSpread((v) => {
        localStorage.setItem(SPREAD_KEY, v ? '0' : '1')
        return !v
      }),
    [],
  )

  const enterVR = useCallback(() => {
    setChrome('hud')
    void xrStore.enterVR()
  }, [])

  const counter =
    visible.length === 2 ? `${visible[0] + 1}–${visible[1] + 1}` : `${visible[0] + 1}`
  const progress = pages.length > 0 ? (Math.max(...visible) + 1) / pages.length : 0

  return (
    <>
      {chrome === 'marquee' ? (
        <div className="marquee">
          <div className="brand">PANEL</div>
          <div className="halftone-rule" />
          <div className="kicker">Komga → WebXR</div>

          {book ? (
            <div className="now-reading">
              <span className="nr-label">Now reading</span>
              <img
                className="nr-cover"
                src={bookThumbUrl(book.id)}
                alt=""
                onError={(e) => (e.currentTarget.style.visibility = 'hidden')}
              />
              <div className="nr-meta">
                <span className="nr-series">{book.seriesTitle}</span>
                {book.name && !book.name.startsWith(book.seriesTitle) && (
                  <span className="nr-issue">{book.name}</span>
                )}
                <div className="nr-foot">
                  <span className="nr-page">
                    pg {Math.max(...visible) + 1} / {pages.length}
                  </span>
                  <span className="nr-bar">
                    <i style={{ width: `${Math.round(progress * 100)}%` }} />
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <div className="new-here">
              <b>New here?</b> Press Enter VR to read in the headset, or open the Library to
              pick a book.
            </div>
          )}

          <button className="burst hero" onClick={enterVR}>
            ENTER&nbsp;VR
          </button>

          <div className="marquee-actions">
            <button
              className="btn"
              onClick={() => {
                setChrome('hud')
                setShowLibrary(true)
              }}
            >
              Library
            </button>
            <button
              className="btn"
              onClick={() => {
                setChrome('hud')
                setView('sphere')
              }}
            >
              3D Library
            </button>
            <label className="btn-ghost file">
              Load .cbz
              <input ref={fileRef} type="file" accept=".cbz,.zip" onChange={onPickCbz} hidden />
            </label>
          </div>

          {error && <div className="error">{error}</div>}
        </div>
      ) : (
        <div className="hud">
          <div className="controls">
            <button className="panel-chip" onClick={() => setChrome('marquee')} title="Back to the front page">
              PANEL
            </button>
            <button className="btn-ghost sm icon" onClick={() => prev()} disabled={index === 0}>
              ‹
            </button>
            <span className="counter">
              {counter} / {pages.length}
            </span>
            <button
              className="btn-ghost sm icon"
              onClick={() => next()}
              disabled={index >= pages.length - 1}
            >
              ›
            </button>
            <button className="btn-ghost sm" onClick={toggleSpread}>
              {spread ? 'Single' : 'Two-page'}
            </button>
            <button className="btn sm" onClick={() => setShowLibrary((v) => !v)}>
              Library
            </button>
            <button
              className="btn sm"
              onClick={() => setView((v) => (v === 'sphere' ? 'read' : 'sphere'))}
            >
              {view === 'sphere' ? 'Back to book' : '3D Library'}
            </button>
            <label className="btn-ghost sm file">
              Load .cbz
              <input ref={fileRef} type="file" accept=".cbz,.zip" onChange={onPickCbz} hidden />
            </label>
            <button className="burst sm" onClick={enterVR}>
              ENTER&nbsp;VR
            </button>
          </div>
          {book && (
            <div className="reading">
              Reading <b>{book.seriesTitle}</b> — {book.name}
            </div>
          )}
          {error && <div className="error">{error}</div>}
          <div className="hint">
            Turn: right stick / ← → · Grab: trigger (two to resize) · Walk: left stick · X
            recenters · Y opens the 3D library
          </div>
        </div>
      )}

      {showLibrary && (
        <Library onOpenBook={(b) => openBook(b)} onClose={() => setShowLibrary(false)} />
      )}

      <Canvas camera={{ position: [0, 1.4, 0.35], fov: 60 }} gl={{ antialias: true }}>
        <XR store={xrStore}>
          <VRViewToggle onToggle={() => setView((v) => (v === 'sphere' ? 'read' : 'sphere'))} />
          {view === 'sphere' ? (
            <LibrarySphere onOpenBook={(b) => openBook(b)} onClose={() => setView('read')} />
          ) : (
            <Reader
              pages={pages}
              indices={visible}
              onNext={next}
              onPrev={prev}
              spread={spread}
              onToggleSpread={toggleSpread}
              onOpenLibrary={() => setView('sphere')}
            />
          )}
        </XR>
      </Canvas>
    </>
  )
}
