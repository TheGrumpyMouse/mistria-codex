import { useCallback, useSyncExternalStore } from 'react'

/**
 * Whether the first-run tour has been seen.
 *
 * Absence means "not yet" — the same default-as-absence convention as
 * `text-size`. The value is shared between the shell (which opens the tour)
 * and Settings (which offers a replay), so it lives in a tiny external store
 * rather than component state: flipping it anywhere updates both.
 *
 * `localStorage` can throw (private mode, storage denied). When it does, the
 * read reports "seen" — a tour that cannot remember being dismissed would
 * otherwise reopen on every load, which is worse than never opening.
 */
const KEY = 'mistria-codex:tour'
const listeners = new Set<() => void>()

const read = (): boolean => {
  try {
    return localStorage.getItem(KEY) === 'done'
  } catch {
    return true
  }
}

function write(done: boolean): void {
  try {
    if (done) localStorage.setItem(KEY, 'done')
    else localStorage.removeItem(KEY)
  } catch {
    // Nothing to do — the in-memory notification below still closes/opens
    // the tour for this session.
  }
  for (const listener of listeners) listener()
}

export function useTourDone(): [boolean, (done: boolean) => void] {
  const done = useSyncExternalStore(
    useCallback((onChange) => {
      listeners.add(onChange)
      return () => listeners.delete(onChange)
    }, []),
    read,
  )
  return [done, useCallback((next: boolean) => write(next), [])]
}
