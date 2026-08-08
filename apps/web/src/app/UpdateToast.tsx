import { useRegisterSW } from 'virtual:pwa-register/react'
import { useEffect, useState } from 'react'

/**
 * "There's a new version" — an offer, never an interruption.
 *
 * The service worker deliberately does not `skipWaiting()` on its own. A new
 * worker taking over mid-session reloads the page under whoever is using it,
 * and reloading someone halfway through a museum audit to give them a nicer
 * icon is hostile. So the new version waits, this says so, and the reload
 * happens when the person says.
 *
 * It is also the only place the app tells you it is installed and offline-ready,
 * once, and then never mentions it again.
 */
export function UpdateToast() {
  const {
    offlineReady: [offlineReady, setOfflineReady],
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW()

  // The offline-ready note is a one-off reassurance, not a status bar. It says
  // its piece and goes.
  useEffect(() => {
    if (!offlineReady) return
    const timer = setTimeout(() => setOfflineReady(false), 6000)
    return () => clearTimeout(timer)
  }, [offlineReady, setOfflineReady])

  const [busy, setBusy] = useState(false)
  if (!offlineReady && !needRefresh) return null

  return (
    <div
      // `polite`, not `assertive`: neither of these is worth interrupting a
      // screen reader mid-sentence for.
      role="status"
      aria-live="polite"
      className="fixed inset-x-3 bottom-20 z-20 mx-auto max-w-sm rounded-card border border-rule bg-surface p-3 shadow-raised lg:right-4 lg:bottom-4 lg:left-auto"
    >
      {needRefresh ? (
        <>
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
              className="rounded-pill px-3 py-1 text-xs"
              style={{ background: 'var(--accent-tint)', color: 'var(--accent)', fontWeight: 600 }}
            >
              {busy ? 'Reloading…' : 'Reload'}
            </button>
            <button
              type="button"
              onClick={() => setNeedRefresh(false)}
              className="rounded-pill border border-rule px-3 py-1 text-ink-mute text-xs"
            >
              Later
            </button>
          </div>
        </>
      ) : (
        <p className="text-ink text-sm">Ready to use offline.</p>
      )}
    </div>
  )
}
