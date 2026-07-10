import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, KeyboardEvent as ReactKeyboardEvent } from 'react'
import { Canvas } from '@react-three/fiber'
import { XR } from '@react-three/xr'
import { xrStore } from './xr/store'
import { Reader } from './scene/Reader'
import { LibrarySphere } from './scene/LibrarySphere'
import { VRViewToggle } from './scene/VRViewToggle'
import { loadCbz } from './pages/cbz'
import { visiblePages, nextIndex, prevIndex } from './pages/pairing'
import { storageGet, storageSet, storageRemove } from './storage'
import { Library } from './ui/Library'
import { bookPageUrls, bookThumbUrl, getBook, saveProgress, KomgaError } from './komga/client'
import type { KomgaBook } from './komga/types'

const LAST_BOOK_KEY = 'panel.lastBookId'
const SPREAD_KEY = 'panel.spread'
const CURVE_KEY = 'panel.curve'
const HANDS_KEY = 'panel.handGestures'

export function App() {
  // No comic until one is opened (resume / library / .cbz) — the landing must
  // not show a placeholder page behind it, and the Reader only mounts once
  // there are real pages.
  const [pages, setPages] = useState<string[]>([])
  const [index, setIndex] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [showLibrary, setShowLibrary] = useState(false)
  const [view, setView] = useState<'read' | 'sphere'>('read')
  // chrome: the 2D shell. 'marquee' = the landing placard (the front door that
  // pops); 'hud' = the compact working strip once you've started. Collapses on
  // first real interaction so zero-friction resume is never gated.
  const [chrome, setChrome] = useState<'marquee' | 'hud'>('marquee')
  const [book, setBook] = useState<KomgaBook | null>(null)
  const [spread, setSpread] = useState(() => storageGet(SPREAD_KEY) === '1')
  const [curve, setCurveState] = useState(() => {
    const v = parseFloat(storageGet(CURVE_KEY) ?? '0')
    return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0
  })
  const fileRef = useRef<HTMLInputElement>(null)

  const setCurve = useCallback((v: number) => {
    const c = Math.max(0, Math.min(1, v))
    storageSet(CURVE_KEY, String(c))
    setCurveState(c)
  }, [])

  // Hand mode (Quest hand tracking): shows the page tap zones + enables the wave
  // gesture. OFF = controller mode (trigger-hold grabs the page, A/B pages, no
  // zones). Default OFF so controllers work out of the box; opt in for hands.
  const [handGestures, setHandGestures] = useState(() => storageGet(HANDS_KEY) === '1')
  const toggleHands = useCallback(
    () =>
      setHandGestures((v) => {
        storageSet(HANDS_KEY, v ? '0' : '1')
        return !v
      }),
    [],
  )

  // Set once the user actually turns a page in the current book. Gates the
  // read-progress push (below) so merely *opening* a book — especially a
  // completed one, which resets the reader to page 1 — never writes progress
  // back to Komga and silently un-completes it. Cleared in openBook / onPickCbz.
  const interacted = useRef(false)
  // Set once the user deliberately opens a book or loads a .cbz, so a slow
  // startup-resume that resolves late can't clobber what they chose.
  const userOpened = useRef(false)

  // Spread pairing + page-turn arithmetic lives in ./pages/pairing (pure + unit
  // tested — it's the logic behind resume/progress, so a regression is silent).
  const visible = useMemo(
    () => visiblePages(index, pages.length, spread),
    [spread, index, pages.length],
  )

  const next = useCallback(() => {
    interacted.current = true
    setIndex((i) => nextIndex(i, pages.length, spread))
  }, [pages.length, spread])
  const prev = useCallback(() => {
    interacted.current = true
    setIndex((i) => prevIndex(i, spread))
  }, [spread])

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
    interacted.current = false // opening a book is not a page turn — don't sync
    // A deliberate open (from the library/marquee, collapseChrome=true) means the
    // user chose this; a late startup-resume must not overwrite it.
    if (collapseChrome) userOpened.current = true
    setBook(b)
    setShowLibrary(false)
    setView('read')
    setError(null)
    if (collapseChrome) setChrome('hud')
    storageSet(LAST_BOOK_KEY, b.id)
  }, [])

  // On startup, reopen the last book (fresh from the server, so the resume
  // point reflects reading done elsewhere — e.g. on the iPad). Keeps the marquee
  // up. A transient failure (Wi-Fi still connecting after headset wake, Komga
  // rebooting, cold tunnel) must NOT forget the book — only a definitive 404
  // (the book was deleted from Komga) clears the resume pointer.
  useEffect(() => {
    const id = storageGet(LAST_BOOK_KEY)
    if (!id) return
    let stale = false
    getBook(id)
      .then((b) => {
        // Skip if unmounted, or the user already opened something themselves.
        if (!stale && !userOpened.current) openBook(b, false)
      })
      .catch((err) => {
        if (stale) return
        if (err instanceof KomgaError && err.status === 404) {
          storageRemove(LAST_BOOK_KEY) // the book is genuinely gone
        } else {
          console.error('[Panel] resume failed', err)
          setError('Couldn’t reach Komga to resume your last book — it’ll be here when the connection is back.')
        }
      })
    // Ignore a late resolve/reject once the user has opened something else.
    return () => {
      stale = true
    }
  }, [openBook])

  // Push read progress on page turn (debounced so flick-throughs don't spam).
  // In spread mode, report the furthest visible page. Only fires once the user
  // has actually turned a page in this book (interacted) — opening a book, and
  // especially reopening a *completed* one (which resets to page 1), must never
  // write progress back and silently un-complete it on the server.
  const pendingSave = useRef<{ page: number; completed: boolean } | null>(null)
  useEffect(() => {
    if (!book || !interacted.current || visible.length === 0) return
    const furthest = Math.max(...visible) + 1
    const completed = furthest >= book.media.pagesCount
    pendingSave.current = { page: furthest, completed }
    const t = setTimeout(() => {
      void saveProgress(book.id, furthest, completed)
      pendingSave.current = null
    }, 800)
    return () => clearTimeout(t)
  }, [book, visible])

  // Flush a still-pending (debounced) save the instant the tab is hidden or
  // closing — taking the headset off backgrounds the tab, and that last page
  // turn is exactly the one you want on the iPad. keepalive lets it outlive the
  // page. (The 800ms debounce would otherwise lose it.)
  useEffect(() => {
    const flush = () => {
      const p = pendingSave.current
      if (book && p) {
        pendingSave.current = null
        void saveProgress(book.id, p.page, p.completed, true)
      }
    }
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush()
    }
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [book])

  // Desktop fallback: arrow keys / space turn pages. Only when a comic is open,
  // and never while typing — otherwise Space in the Library search box turns the
  // page instead of inserting a space, and arrows are stolen from any control.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return
      if (pages.length === 0) return
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
  }, [next, prev, pages.length])

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
      interacted.current = false
      userOpened.current = true // don't let a late startup-resume clobber the .cbz
      setChrome('hud')
    } catch (err) {
      console.error('[Panel] CBZ load failed', err)
      setError(err instanceof Error ? err.message : 'Could not load that file.')
    } finally {
      if (fileRef.current) fileRef.current.value = ''
    }
  }, [])

  // The .cbz picker is a hidden file input inside a styled <label>. A label
  // isn't focusable, so keyboard users couldn't reach it — make the label
  // focusable (it already gets the shared .file focus ring) and open the picker
  // on Enter/Space.
  const onCbzKey = useCallback((e: ReactKeyboardEvent<HTMLLabelElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      fileRef.current?.click()
    }
  }, [])

  const toggleSpread = useCallback(
    () =>
      setSpread((v) => {
        storageSet(SPREAD_KEY, v ? '0' : '1')
        return !v
      }),
    [],
  )

  const hasComic = pages.length > 0

  const enterVR = useCallback(async () => {
    setChrome('hud')
    // Feature-detect before calling enterVR — otherwise it silently no-ops on
    // the plain-http Quest (the common Unraid mistake), desktop without the
    // emulator, or iPad Safari, leaving the button apparently dead.
    if (!window.isSecureContext) {
      setError(
        'VR needs a secure (HTTPS) connection. Put Panel behind a reverse proxy or tunnel so it’s served over https://.',
      )
      return
    }
    const xr = (navigator as Navigator & { xr?: { isSessionSupported(m: string): Promise<boolean> } }).xr
    const supported = xr ? await xr.isSessionSupported('immersive-vr').catch(() => false) : false
    if (!supported) {
      setError('This browser can’t enter VR (no WebXR). Open Panel in the Meta Quest browser to read in the headset.')
      return
    }
    setError(null)
    // nothing loaded yet → drop into the 3D library to pick, not an empty reader
    if (pages.length === 0) setView('sphere')
    try {
      await xrStore.enterVR()
    } catch (err) {
      console.error('[Panel] enterVR failed', err)
      setError('Couldn’t start VR — the headset declined the session. Try again.')
    }
  }, [pages.length])

  // Furthest page currently visible (0 when nothing is loaded — visible can be
  // empty for a 0-page book, so never spread `Math.max` over an empty array).
  const furthestVisible = visible.length > 0 ? Math.max(...visible) : 0
  const counter =
    visible.length === 2
      ? `${visible[0] + 1}–${visible[1] + 1}`
      : `${(visible[0] ?? 0) + 1}`
  const progress = pages.length > 0 ? (furthestVisible + 1) / pages.length : 0

  return (
    <>
      {chrome === 'marquee' ? (
        <div className={`marquee${hasComic ? '' : ' landing'}`}>
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
                    pg {furthestVisible + 1} / {pages.length}
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

          <button className="btn-vr" onClick={enterVR}>
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
            <label className="btn-ghost file" tabIndex={0} role="button" onKeyDown={onCbzKey}>
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
            <label className="curve-ctl" title="Bend the page toward you so the far edges come closer (best in VR)">
              Curve
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={curve}
                onChange={(e) => setCurve(parseFloat(e.target.value))}
              />
              <span className="curve-val">{Math.round(curve * 100)}%</span>
            </label>
            <button
              className={`btn-ghost sm${handGestures ? ' on' : ''}`}
              onClick={toggleHands}
              title="Hand mode (Quest hand tracking): turn pages by tapping the page's left/right thirds or waving a hand; middle taps show/hide the controls. Off = controller mode (trigger-hold to grab the page, A/B to page)."
            >
              Hands {handGestures ? 'on' : 'off'}
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
            <label className="btn-ghost sm file" tabIndex={0} role="button" onKeyDown={onCbzKey}>
              Load .cbz
              <input ref={fileRef} type="file" accept=".cbz,.zip" onChange={onPickCbz} hidden />
            </label>
            <button className="btn-vr sm" onClick={enterVR}>
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
          {/* Y toggles the library, but only leaves the sphere for the reader
              when there's actually a book — otherwise it would drop into an
              empty void with no way back. */}
          <VRViewToggle
            onToggle={() => setView((v) => (v === 'sphere' ? (hasComic ? 'read' : 'sphere') : 'sphere'))}
          />
          {view === 'sphere' ? (
            // Close returns to the reader only when there's a book to return to;
            // with nothing loaded the sphere IS the destination, so no Close
            // button (Exit VR / picking a book are the ways out).
            <LibrarySphere
              onOpenBook={(b) => openBook(b)}
              onClose={hasComic ? () => setView('read') : undefined}
            />
          ) : hasComic ? (
            <Reader
              pages={pages}
              indices={visible}
              onNext={next}
              onPrev={prev}
              spread={spread}
              onToggleSpread={toggleSpread}
              onOpenLibrary={() => setView('sphere')}
              curve={curve}
              onCurveChange={setCurve}
              handGestures={handGestures}
            />
          ) : null}
        </XR>
      </Canvas>
    </>
  )
}
