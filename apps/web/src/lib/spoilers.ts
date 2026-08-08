import { useCallback, useSyncExternalStore } from 'react'

/**
 * The spoiler curtain's client half: who has agreed to see what.
 *
 * The dataset marks a handful of records as story spoilers (`s: 1` in the
 * display index, `spoiler: true` on the record). This module holds the two
 * ways a user lifts the veil: revealing one thing (persisted per id, because
 * "show me Caldarus" is not "show me the ending"), or switching the curtain
 * off entirely in Settings. Same localStorage-plus-`useSyncExternalStore`
 * pattern as the display mode, and for the same reason: a reveal on one
 * screen must be visible on every other mounted screen at once.
 *
 * What this module never does is hide a record. The veil replaces a *name*
 * with a labelled placeholder and a *page body* with an acknowledgement —
 * rows keep existing and keep navigating, the same principle as "locked is
 * shown, not hidden".
 */

const KEY = 'mistria-codex:spoilers'
const listeners = new Set<() => void>()

interface SpoilerPrefs {
  showAll: boolean
  revealed: string[]
}

const EMPTY: SpoilerPrefs = { showAll: false, revealed: [] }

/** Cached so the store snapshot is referentially stable between writes. */
let cache: { raw: string | null; prefs: SpoilerPrefs } | null = null

function read(): SpoilerPrefs {
  const raw = localStorage.getItem(KEY)
  if (cache !== null && cache.raw === raw) return cache.prefs

  let prefs = EMPTY
  if (raw !== null) {
    // A corrupt value behaves like a fresh install — hiding is the safe
    // direction, and nothing here is worth an error screen.
    try {
      const parsed = JSON.parse(raw) as Partial<SpoilerPrefs>
      prefs = {
        showAll: parsed.showAll === true,
        revealed: Array.isArray(parsed.revealed) ? parsed.revealed.filter(isString) : [],
      }
    } catch {
      prefs = EMPTY
    }
  }
  cache = { raw, prefs }
  return prefs
}

const isString = (value: unknown): value is string => typeof value === 'string'

function write(prefs: SpoilerPrefs): void {
  localStorage.setItem(KEY, JSON.stringify(prefs))
  for (const listener of listeners) listener()
}

export interface Spoilers {
  /** True when this record may be shown: revealed, or the curtain is off. */
  shown: (id: string) => boolean
  /** The user tapped through the acknowledgement for this one record. */
  reveal: (id: string) => void
  showAll: boolean
  setShowAll: (on: boolean) => void
  /** Draw the curtain back over everything revealed one-by-one. */
  rehideAll: () => void
}

export function useSpoilers(): Spoilers {
  const prefs = useSyncExternalStore(
    useCallback((onChange) => {
      listeners.add(onChange)
      return () => listeners.delete(onChange)
    }, []),
    read,
  )

  const reveal = useCallback((id: string) => {
    const current = read()
    if (current.revealed.includes(id)) return
    write({ ...current, revealed: [...current.revealed, id] })
  }, [])

  const setShowAll = useCallback((on: boolean) => {
    write({ ...read(), showAll: on })
  }, [])

  const rehideAll = useCallback(() => {
    write({ showAll: false, revealed: [] })
  }, [])

  return {
    shown: useCallback((id: string) => prefs.showAll || prefs.revealed.includes(id), [prefs]),
    reveal,
    showAll: prefs.showAll,
    setShowAll,
    rehideAll,
  }
}
