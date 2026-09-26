// Panel — phone pairing page controller. Plain DOM, no framework: read the code
// the user types (optionally prefilled via ?code=), plus their Komga URL + key,
// and POST them to the Worker's pairing endpoint. The headset (which showed the
// code) is polling and picks the config up. Nothing is stored in an account —
// it's a single-use, short-lived handoff into the headset's own cookie.
import './pair.css'

const root = document.getElementById('pair')!
const prefillCode = (new URLSearchParams(location.search).get('code') ?? '').toUpperCase()

root.innerHTML = `
  <div class="pair-card">
    <div class="pair-brand">PANEL</div>
    <div class="pair-rule"></div>
    <h1 class="pair-title">Pair your headset</h1>
    <p class="pair-lead">
      Enter the code shown on your Quest, then your Komga server and API key.
      They're saved on the headset itself — there's no account to sign into.
    </p>
    <form id="pair-form" novalidate>
      <label>Pairing code
        <input id="f-code" name="code" inputmode="text" autocomplete="off"
          autocapitalize="characters" spellcheck="false" placeholder="ABC-123"
          value="${escapeAttr(prefillCode)}" />
      </label>
      <label>Komga server URL
        <input id="f-url" name="url" type="url" inputmode="url" autocomplete="off"
          autocapitalize="off" spellcheck="false" placeholder="https://komga.example.com" />
      </label>
      <label>API key
        <input id="f-key" name="key" type="password" autocomplete="off"
          placeholder="from Komga → Account Settings → API Keys" />
      </label>
      <button id="f-submit" type="submit">Connect headset</button>
      <p id="f-msg" class="pair-msg" role="status" aria-live="polite"></p>
    </form>
    <p class="pair-hint">
      Generate a key in Komga under <b>Account Settings → API Keys</b> — a dedicated
      read-only user is ideal. Your headset must be able to reach this server over
      the internet.
    </p>
  </div>
`

const form = document.getElementById('pair-form') as HTMLFormElement
const msg = document.getElementById('f-msg') as HTMLParagraphElement
const submitBtn = document.getElementById('f-submit') as HTMLButtonElement
const codeEl = document.getElementById('f-code') as HTMLInputElement
const urlEl = document.getElementById('f-url') as HTMLInputElement
const keyEl = document.getElementById('f-key') as HTMLInputElement

// Focus the first empty field so the user starts typing straight away.
;(prefillCode ? urlEl : codeEl).focus()

form.addEventListener('submit', async (e) => {
  e.preventDefault()
  const code = codeEl.value.trim()
  const url = urlEl.value.trim()
  const key = keyEl.value.trim()
  if (!code || !url || !key) {
    setMsg('Fill in all three fields.', 'err')
    return
  }
  submitBtn.disabled = true
  setMsg('Sending to your headset…', '')
  try {
    const res = await fetch('/api/pair/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, url, key }),
    })
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string }
    if (res.ok && data.ok) {
      for (const el of form.querySelectorAll('input, button')) {
        ;(el as HTMLInputElement | HTMLButtonElement).disabled = true
      }
      setMsg('Done — your headset should connect in a moment. You can close this page.', 'ok')
    } else {
      setMsg(data.error ?? 'Something went wrong — try again.', 'err')
      submitBtn.disabled = false
    }
  } catch {
    setMsg('Couldn’t reach the server. Check your connection and try again.', 'err')
    submitBtn.disabled = false
  }
})

function setMsg(text: string, kind: '' | 'ok' | 'err'): void {
  msg.textContent = text
  msg.className = kind ? `pair-msg ${kind}` : 'pair-msg'
}

function escapeAttr(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  )
}
