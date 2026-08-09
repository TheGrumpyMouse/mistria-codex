import { useRegisterSW } from 'virtual:pwa-register/react'
import { createContext, type ReactNode, useCallback, useContext, useRef, useState } from 'react'
import { fetchFreshMeta, loadMeta } from '~/lib/data'

/**
 * One place that knows whether this app is the current one.
 *
 * `useRegisterSW` used to live inside `UpdateToast`, which meant its state was
 * reachable from exactly one component and Settings could not offer to check
 * for anything. Registering it twice is not the fix — that is two registrations
 * with two independent ideas of whether an update is waiting — so it is lifted
 * here and the toast becomes a consumer.
 */

/**
 * What the last check found.
 *
 * `offline` is deliberately distinct from `current`. A check that could not
 * reach the server has not established anything, and answering "you're up to
 * date" is the one reply worse than saying nothing: it is the same sentence a
 * successful check gives, and it sends someone away from the button that would
 * have fixed their problem.
 */
export type UpdateStatus = 'idle' | 'checking' | 'ready' | 'current' | 'offline'

interface ServiceWorkerValue {
  /** A new app shell, or new data, is waiting. */
  needRefresh: boolean
  status: UpdateStatus
  /** When the last completed check ran — `null` until one has. */
  checkedAt: Date | null
  check: () => Promise<void>
  applyUpdate: () => Promise<void>
  dismiss: () => void
  /** Drop every cached file and re-register, keeping progress. */
  reinstall: () => Promise<void>
}

const NOT_MOUNTED: ServiceWorkerValue = {
  needRefresh: false,
  status: 'idle',
  checkedAt: null,
  check: async () => undefined,
  applyUpdate: async () => undefined,
  dismiss: () => undefined,
  reinstall: async () => undefined,
}

const ServiceWorkerContext = createContext<ServiceWorkerValue>(NOT_MOUNTED)

export function ServiceWorkerProvider({ children }: { children: ReactNode }) {
  const registration = useRef<ServiceWorkerRegistration | null>(null)
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW: (_url, reg) => {
      registration.current = reg ?? null
    },
  })

  const [status, setStatus] = useState<UpdateStatus>('idle')
  const [checkedAt, setCheckedAt] = useState<Date | null>(null)

  /**
   * Ask, rather than wait.
   *
   * **Two questions, because they fail independently.** `registration.update()`
   * re-fetches `sw.js` and is the only thing that notices a new *shell* — but
   * the data bundle is `globIgnore`d from the precache manifest, so a redeploy
   * that changes only `data/` or the art leaves `sw.js` byte-identical and that
   * call returns having found nothing. Comparing the manifest is what catches
   * those, and it is most of what actually ships between releases.
   */
  const check = useCallback(async (): Promise<void> => {
    setStatus('checking')
    // A new shell flips `needRefresh` through the hook rather than through us.
    // In dev the virtual module is a no-op and there is no registration at all,
    // so this half simply does nothing and the manifest half still answers.
    try {
      await registration.current?.update()
    } catch {
      // A failed update() is not itself an answer — the manifest check below
      // is, and it reports its own failure.
    }

    try {
      const [current, fresh] = await Promise.all([loadMeta(), fetchFreshMeta()])
      const moved =
        fresh.dataVersion !== current.dataVersion ||
        (fresh.assets?.version ?? null) !== (current.assets?.version ?? null)
      setCheckedAt(new Date())
      setStatus(moved ? 'ready' : 'current')
    } catch {
      setStatus('offline')
    }
  }, [])

  /**
   * Take the update.
   *
   * The branch matters. `updateServiceWorker()` messages a *waiting* worker and
   * resolves when it takes control; with nothing waiting — the data-only case —
   * that message goes to no one and the promise never settles, so the button
   * would spin forever on the commonest kind of update there is.
   */
  const applyUpdate = useCallback(async (): Promise<void> => {
    if (needRefresh) {
      await updateServiceWorker()
      return
    }
    window.location.reload()
  }, [needRefresh, updateServiceWorker])

  /**
   * The uninstall-and-reinstall, minus the reinstall.
   *
   * A last resort for a device whose cache is wrong in a way the version
   * suffix cannot reach. **It touches Cache Storage only**: progress is in
   * IndexedDB (`lib/progress.ts`) and preferences are in localStorage, so
   * neither is here to lose. Unregistering as well means the next load
   * re-registers and re-precaches from scratch rather than trusting a worker
   * that believes it already cached everything.
   */
  const reinstall = useCallback(async (): Promise<void> => {
    try {
      const keys = await caches.keys()
      await Promise.all(keys.map((key) => caches.delete(key)))
      await registration.current?.unregister()
    } catch {
      // Reload anyway. A partial clear plus a fresh load is still closer to
      // right than the state that made someone press this.
    }
    window.location.reload()
  }, [])

  const dismiss = useCallback(() => setNeedRefresh(false), [setNeedRefresh])

  return (
    <ServiceWorkerContext.Provider
      value={{
        // Strictly the waiting worker. A manifest that moved is reported by
        // `status` instead: it is only ever discovered by someone who pressed
        // the button, and popping a toast over the answer they are already
        // reading would be the same news twice.
        needRefresh,
        status,
        checkedAt,
        check,
        applyUpdate,
        dismiss,
        reinstall,
      }}
    >
      {children}
    </ServiceWorkerContext.Provider>
  )
}

export function useServiceWorker(): ServiceWorkerValue {
  return useContext(ServiceWorkerContext)
}
