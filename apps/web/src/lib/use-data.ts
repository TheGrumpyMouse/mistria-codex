import { useEffect, useState } from 'react'

/**
 * Load once, then render synchronously forever after.
 *
 * This hook exists for the back button. The router restores scroll on
 * navigation, but a screen that mounts with "Loading…" is a few hundred
 * pixels tall — the browser clamps the restored position to it, the data
 * arrives a frame later, and the user lands at the top of a list they were
 * halfway down. Caching the *computed result* (not just the fetch — the
 * shaping too) means a revisited screen renders fully populated on its first
 * paint, which is what lets the restoration land.
 *
 * The cache is module-level and lives for the session, exactly like the
 * fetch memoisation in `lib/data.ts` underneath it. Keys are per screen (and
 * per record for detail screens: `place:the_narrows`); a changed key loads
 * fresh while old keys stay warm.
 *
 * Progress ticks deliberately do NOT go through this — they change while the
 * app runs. Cache the almanac, read the ticks live.
 */

const results = new Map<string, unknown>()

export interface Loaded<T> {
  data: T | null
  error: string | null
}

export function useData<T>(key: string, load: () => Promise<T>): Loaded<T> {
  const [state, setState] = useState<Loaded<T>>(() => ({
    data: results.has(key) ? (results.get(key) as T) : null,
    error: null,
  }))

  // `load` is intentionally not a dependency: callers pass inline closures,
  // and re-running on every identity change would defeat the cache. The key
  // is the contract.
  // biome-ignore lint/correctness/useExhaustiveDependencies: key is the contract; load is an inline closure by design.
  useEffect(() => {
    if (results.has(key)) {
      setState({ data: results.get(key) as T, error: null })
      return
    }
    let live = true
    load()
      .then((data) => {
        results.set(key, data)
        if (live) setState({ data, error: null })
      })
      .catch((err: unknown) => {
        if (live) setState({ data: null, error: err instanceof Error ? err.message : String(err) })
      })
    return () => {
      live = false
    }
  }, [key])

  return state
}
