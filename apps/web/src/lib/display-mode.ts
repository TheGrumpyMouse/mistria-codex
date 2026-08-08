import { useCallback, useSyncExternalStore } from 'react'

/**
 * How list-heavy screens draw their entries: sprite chips or plain text.
 *
 * A real preference, not a per-screen toggle — someone who wants text wants it
 * everywhere, so it lives in localStorage under one key and every screen reads
 * the same value. `useSyncExternalStore` keeps two mounted screens in step
 * without a context provider.
 */
export type DisplayMode = 'icons' | 'text'

const KEY = 'mistria-codex:display-mode'
const listeners = new Set<() => void>()

const read = (): DisplayMode => (localStorage.getItem(KEY) === 'text' ? 'text' : 'icons')

export function useDisplayMode(): [DisplayMode, (mode: DisplayMode) => void] {
  const mode = useSyncExternalStore(
    useCallback((onChange) => {
      listeners.add(onChange)
      return () => listeners.delete(onChange)
    }, []),
    read,
  )

  const set = useCallback((next: DisplayMode) => {
    localStorage.setItem(KEY, next)
    for (const listener of listeners) listener()
  }, [])

  return [mode, set]
}
