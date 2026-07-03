import { useEffect, useState } from 'react'
import {
  bookThumbUrl,
  listBooks,
  listInProgress,
  listOnDeck,
  listSeries,
  seriesThumbUrl,
} from '../komga/client'
import type { KomgaBook, KomgaSeries } from '../komga/types'

export interface LibraryProps {
  onOpenBook: (book: KomgaBook) => void
  onClose: () => void
}

function bookState(b: KomgaBook): string {
  const rp = b.readProgress
  if (rp?.completed) return 'read'
  if (rp) return `page ${rp.page}/${b.media.pagesCount}`
  return 'unread'
}

// Hide the thumbnail if Komga has none (broken-image boxes are worse than no image).
function hideOnError(e: React.SyntheticEvent<HTMLImageElement>) {
  e.currentTarget.style.visibility = 'hidden'
}

function Shelf({
  title,
  books,
  onOpenBook,
}: {
  title: string
  books: KomgaBook[]
  onOpenBook: (b: KomgaBook) => void
}) {
  if (books.length === 0) return null
  return (
    <div className="shelf">
      <div className="shelf-title">{title}</div>
      <div className="shelf-row">
        {books.map((b) => (
          <button key={b.id} className="card" onClick={() => onOpenBook(b)}>
            <img src={bookThumbUrl(b.id)} alt="" loading="lazy" onError={hideOnError} />
            <span className="card-series">{b.seriesTitle}</span>
            <span className="card-state">{bookState(b)}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

// 2D HTML library browser (pick a book before entering VR). An in-headset
// uikit browser can replace this later; this gets sofa→headset continuity
// shipped first.
export function Library({ onOpenBook, onClose }: LibraryProps) {
  const [series, setSeries] = useState<KomgaSeries[] | null>(null)
  const [inProgress, setInProgress] = useState<KomgaBook[]>([])
  const [onDeck, setOnDeck] = useState<KomgaBook[]>([])
  const [selected, setSelected] = useState<KomgaSeries | null>(null)
  const [books, setBooks] = useState<KomgaBook[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  const q = query.trim().toLowerCase()
  const shownSeries = q ? series?.filter((s) => s.name.toLowerCase().includes(q)) : series

  useEffect(() => {
    listSeries()
      .then(setSeries)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to reach Komga'))
    // Shelves are nice-to-have: fetch independently, ignore failures.
    listInProgress().then(setInProgress).catch(() => {})
    listOnDeck().then(setOnDeck).catch(() => {})
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
        <>
          <input
            className="search"
            type="search"
            placeholder="Search series…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {!q && (
            <>
              <Shelf title="Continue reading" books={inProgress} onOpenBook={onOpenBook} />
              <Shelf title="On deck" books={onDeck} onOpenBook={onOpenBook} />
            </>
          )}
          <ul>
            {series === null &&
              !error &&
              [0, 1, 2, 3, 4, 5].map((i) => <li key={i} className="skel" />)}
            {q && shownSeries?.length === 0 && (
              <li className="muted" style={{ padding: '10px' }}>
                No series match “{query}”
              </li>
            )}
            {shownSeries?.map((s) => (
              <li key={s.id}>
                <button className="row" onClick={() => setSelected(s)}>
                  <img
                    className="thumb"
                    src={seriesThumbUrl(s.id)}
                    alt=""
                    loading="lazy"
                    onError={hideOnError}
                  />
                  <span className="row-name">{s.name}</span>
                  <span className="muted">
                    {s.booksCount} book{s.booksCount === 1 ? '' : 's'}
                    {s.booksUnreadCount > 0 && ` · ${s.booksUnreadCount} unread`}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {selected && (
        <ul>
          {books === null &&
            !error &&
            [0, 1, 2, 3, 4, 5].map((i) => <li key={i} className="skel" />)}
          {books?.map((b) => (
            <li key={b.id}>
              <button className="row" onClick={() => onOpenBook(b)}>
                <img
                  className="thumb"
                  src={bookThumbUrl(b.id)}
                  alt=""
                  loading="lazy"
                  onError={hideOnError}
                />
                <span className="row-name">{b.name}</span>
                <span className="muted">
                  {b.media.pagesCount}p · {bookState(b)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
