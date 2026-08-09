/**
 * The document title, per route.
 *
 * The app is hash-routed, so this wins no search indexing — a fragment is not a
 * URL to a crawler, which is what the static guide under `public/guide/` exists
 * to solve. It is worth doing anyway for the four places a title is actually
 * read by a person: the browser tab, the history menu, the bookmark name, and
 * the app switcher on an installed PWA. Before this, all of them said "Mistria
 * Codex" on every screen, which makes a back-button list useless.
 *
 * No library. `react-helmet` and friends exist to reconcile a tree of competing
 * head tags across nested layouts; this app has one title per screen and needs
 * about twenty lines.
 */
import { useEffect } from 'react'

const BASE_TITLE = 'Mistria Codex'

/**
 * Set the title while this component is mounted.
 *
 * `null` means "not loaded yet" and leaves the previous title alone, rather
 * than flashing the base title between a route change and its data arriving.
 * Passing the record name once it exists is the intended shape:
 *
 * ```ts
 * useDocumentTitle(item?.name ?? null)
 * ```
 *
 * The restore on unmount matters because a route that sets no title would
 * otherwise inherit whatever the last one set.
 */
export function useDocumentTitle(title: string | null, description?: string): void {
  useEffect(() => {
    if (title === null) return

    const previousTitle = document.title
    document.title = title === BASE_TITLE ? BASE_TITLE : `${title} · ${BASE_TITLE}`

    const meta = document.querySelector('meta[name="description"]')
    const previousDescription = meta?.getAttribute('content') ?? null
    if (description !== undefined) meta?.setAttribute('content', description)

    return () => {
      document.title = previousTitle
      if (description !== undefined && previousDescription !== null) {
        meta?.setAttribute('content', previousDescription)
      }
    }
  }, [title, description])
}
