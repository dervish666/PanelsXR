import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { getKomgaConfig, setKomgaConfig, clearKomgaConfig } from '../config'
import { ping, KomgaError } from '../komga/client'

// First-run connect screen for the hosted BYO build. The headset shows a short
// pairing code and polls; the user finishes on their phone/laptop at /pair — so
// nobody types a URL + API key on the Quest keyboard (the whole point). A manual
// entry path is tucked underneath for anyone who's already on a real keyboard.
type PairStatus = 'creating' | 'waiting' | 'verifying' | 'expired' | 'error'

export function Setup({ onDone }: { onDone: () => void }) {
  const existing = getKomgaConfig()

  const [code, setCode] = useState<string | null>(null)
  const tokenRef = useRef<string | null>(null)
  const [pairStatus, setPairStatus] = useState<PairStatus>('creating')
  const [pairError, setPairError] = useState('')

  const [showManual, setShowManual] = useState(false)
  const [url, setUrl] = useState(existing?.url ?? '')
  const [key, setKey] = useState(existing?.key ?? '')
  const [manualBusy, setManualBusy] = useState(false)
  const [manualError, setManualError] = useState('')

  const pairUrl = `${location.host}/pair`

  // Persist a candidate config, then prove it by actually reaching Komga through
  // the proxy. On failure we clear the cookie again so a bad config can't stick.
  // Returns true on success, or a human error string.
  const verifyAndFinish = useCallback(
    async (cfg: { url: string; key: string }): Promise<true | string> => {
      setKomgaConfig(cfg)
      try {
        await ping()
        onDone()
        return true
      } catch (err) {
        clearKomgaConfig()
        return err instanceof KomgaError ? err.message : 'Could not connect to Komga.'
      }
    },
    [onDone],
  )

  const newCode = useCallback(async () => {
    setPairStatus('creating')
    setPairError('')
    setCode(null)
    tokenRef.current = null
    try {
      const res = await fetch('/api/pair/create', { method: 'POST' })
      if (!res.ok) throw new Error('create failed')
      const data = (await res.json()) as { code: string; token: string }
      setCode(data.code)
      tokenRef.current = data.token
      setPairStatus('waiting')
    } catch {
      setPairStatus('error')
      setPairError('Couldn’t start pairing — check your connection and try again.')
    }
  }, [])

  useEffect(() => {
    void newCode()
  }, [newCode])

  // Poll while waiting for the phone to submit. Stops the instant we leave the
  // 'waiting' state (verify / expire / error), and skips overlapping ticks.
  useEffect(() => {
    if (pairStatus !== 'waiting' || !code || !tokenRef.current) return
    let cancelled = false
    let busy = false
    const tick = async () => {
      if (busy || cancelled) return
      busy = true
      try {
        const res = await fetch(
          `/api/pair/claim?code=${encodeURIComponent(code)}&token=${encodeURIComponent(tokenRef.current!)}`,
        )
        const data = (await res.json().catch(() => ({}))) as {
          status?: string
          url?: string
          key?: string
        }
        if (cancelled) return
        if (data.status === 'ready' && data.url && data.key) {
          setPairStatus('verifying')
          const result = await verifyAndFinish({ url: data.url, key: data.key })
          if (cancelled) return
          if (result !== true) {
            setPairStatus('error')
            setPairError(result)
          }
        } else if (res.status === 404 || data.status === 'expired') {
          setPairStatus('expired')
        }
      } catch {
        // transient blip — keep polling
      } finally {
        busy = false
      }
    }
    const id = setInterval(tick, 2500)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [pairStatus, code, verifyAndFinish])

  const onManualSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault()
      setManualError('')
      if (!url.trim() || !key.trim()) {
        setManualError('Enter both your server URL and API key.')
        return
      }
      setManualBusy(true)
      const result = await verifyAndFinish({ url: url.trim(), key: key.trim() })
      setManualBusy(false)
      if (result !== true) setManualError(result)
    },
    [url, key, verifyAndFinish],
  )

  return (
    <div className="setup">
      <div className="setup-card">
        <div className="brand">PANEL</div>
        <div className="halftone-rule" />
        <div className="kicker">Connect your Komga</div>

        <div className="setup-pair">
          {pairStatus === 'error' ? (
            <div className="setup-msg">
              <div className="error">{pairError}</div>
              <button className="btn accent" onClick={() => void newCode()}>
                Try again
              </button>
            </div>
          ) : pairStatus === 'expired' ? (
            <div className="setup-msg">
              <div className="new-here">That code expired before it was used.</div>
              <button className="btn accent" onClick={() => void newCode()}>
                New code
              </button>
            </div>
          ) : pairStatus === 'creating' ? (
            <div className="setup-wait">
              <span className="spinner" /> Getting a code…
            </div>
          ) : (
            <>
              <ol className="setup-steps">
                <li>
                  On your phone or computer, open <b className="setup-url">{pairUrl}</b>
                </li>
                <li>Enter this code:</li>
              </ol>
              <div className="setup-code" aria-label="pairing code">
                {code}
              </div>
              <div className="setup-wait">
                <span className="spinner" />
                {pairStatus === 'verifying' ? ' Connecting…' : ' Waiting for your phone…'}
              </div>
            </>
          )}
        </div>

        <button className="setup-toggle" onClick={() => setShowManual((v) => !v)}>
          {showManual ? 'Hide manual entry' : 'Or type it in here'}
        </button>

        {showManual && (
          <form className="setup-manual" onSubmit={onManualSubmit}>
            <label>
              Komga server URL
              <input
                type="url"
                inputMode="url"
                placeholder="https://komga.example.com"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
              />
            </label>
            <label>
              API key
              <input
                type="password"
                placeholder="Komga → Account Settings → API Keys"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                autoComplete="off"
              />
            </label>
            {manualError && <div className="error">{manualError}</div>}
            <button className="btn-vr sm" type="submit" disabled={manualBusy}>
              {manualBusy ? 'Connecting…' : 'Connect'}
            </button>
          </form>
        )}

        {existing && (
          <button className="setup-toggle quiet" onClick={onDone}>
            Keep current server
          </button>
        )}
      </div>
    </div>
  )
}
