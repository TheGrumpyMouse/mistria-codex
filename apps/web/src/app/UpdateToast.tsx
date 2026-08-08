import { useRegisterSW } from 'virtual:pwa-register/react'
import { useState } from 'react'

/**
 * "There's a new version" — an offer, never an interruption.
 *
 * The service worker deliberately does not `skipWaiting()` on its own. A new
 * worker taking over mid-session reloads the page under whoever is using it,
 * and reloading someone halfway through a museum audit to give them a nicer
 * icon is hostile. So the new version waits, this says so, and the reload
 * happens when the person says.
 *
 * There used to be a second toast — "Ready to use offline." — and it is gone
 * on purpose: offline is this app's normal state, not an event, and announcing
 * plumbing is noise. The About page still states the promise for anyone who
 * wants it in writing.
 */
export function UpdateToast() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW()

  const [busy, setBusy] = useState(false)
  if (!needRefresh) return null

  return (
    <div
      // `polite`, not `assertive`: an update offer is not worth interrupting a
      // screen reader mid-sentence for.
      role="status"
      aria-live="polite"
      className="fixed inset-x-3 bottom-20 z-20 mx-auto max-w-sm rounded-card border border-rule bg-surface p-3 shadow-raised lg:right-4 lg:bottom-4 lg:left-auto"
    >
      <p className="text-ink text-sm">A new version is ready.</p>
      <p className="mt-0.5 text-ink-mute text-xs">
        Your progress is kept — reloading only swaps the app.
      </p>
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setBusy(true)
            void updateServiceWorker(true)
          }}
          className="tap-target rounded-pill px-3 py-1 text-xs"
          style={{ background: 'var(--accent-tint)', color: 'var(--accent)', fontWeight: 600 }}
        >
          {busy ? 'Reloading…' : 'Reload'}
        </button>
        <button
          type="button"
          onClick={() => setNeedRefresh(false)}
          className="tap-target rounded-pill border border-rule px-3 py-1 text-ink-mute text-xs"
        >
          Later
        </button>
      </div>
    </div>
  )
}
