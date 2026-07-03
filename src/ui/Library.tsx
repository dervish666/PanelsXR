import { useEffect, useState } from 'react'
import { listBooks, listSeries } from '../komga/client'
import type { KomgaBook, KomgaSeries } from '../komga/types'

export interface LibraryProps {
  onOpenBook: (book: KomgaBook) => void
  onClose: () => void
}

// 2D HTML library browser (pick a book before entering VR). An in-headset
// uikit browser can replace this later; this gets sofa→headset continuity
// shipped first.
export function Library({ onOpenBook, onClose }: LibraryProps) {
  const [series, setSeries] = useState<KomgaSeries[] | null>(null)
  const [selected, setSelected] = useState<KomgaSeries | null>(null)
  const [books, setBooks] = useState<KomgaBook[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    listSeries()
      .then(setSeries)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to reach Komga'))
  }, [])

  useEffect(() => {
    if (!selected) return
    setBooks(null)
    listBooks(selected.id)
      .then(setBooks)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load books'))
  }, [selected])

  return (
    <div className="library">
      <div className="library-head">
        {selected ? (
          <button onClick={() => { setSelected(null); setBooks(null) }}>‹ Series</button>
        ) : (
          <span className="library-title">Library</span>
        )}
        <span className="library-sub">{selected?.name ?? ''}</span>
        <button onClick={onClose}>✕</button>
      </div>

      {error && <div className="error">{error}</div>}

      {!selected && (
        <ul>
          {series === null && !error && <li className="muted">Loading series…</li>}
          {series?.map((s) => (
            <li key={s.id}>
              <button className="row" onClick={() => setSelected(s)}>
                <span>{s.name}</span>
                <span className="muted">
                  {s.booksCount} book{s.booksCount === 1 ? '' : 's'}
                  {s.booksUnreadCount > 0 && ` · ${s.booksUnreadCount} unread`}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {selected && (
        <ul>
          {books === null && !error && <li className="muted">Loading books…</li>}
          {books?.map((b) => {
            const rp = b.readProgress
            const state = rp?.completed
              ? 'read'
              : rp
                ? `page ${rp.page}/${b.media.pagesCount}`
                : 'unread'
            return (
              <li key={b.id}>
                <button className="row" onClick={() => onOpenBook(b)}>
                  <span>{b.name}</span>
                  <span className="muted">
                    {b.media.pagesCount}p · {state}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
