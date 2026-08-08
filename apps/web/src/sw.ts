/// <reference lib="webworker" />
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching'
import { registerRoute } from 'workbox-routing'
import { CacheFirst, StaleWhileRevalidate } from 'workbox-strategies'

/**
 * The offline promise, kept.
 *
 * Two decisions shape this whole file, and both come from what GitHub Pages
 * cannot do. It sends fixed response headers, so **the service worker owns
 * cache policy** rather than HTTP. And its data files live at versioned URLs,
 * so anything under `data/v/<hash>/` is immutable by construction and can be
 * cached forever without revalidation.
 *
 * **Two tiers, and the split is load-bearing.** Workbox's `precacheAndRoute`
 * fails the *entire* install if a single entry 404s, so tier one is only the
 * app shell — the files Vite emitted and therefore knows exist. Everything else
 * — the data bundle, the sprite atlases, the portraits — is cached on first use
 * by a runtime route. The difference is between "offline works" and "the app
 * never installs".
 */

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: { url: string; revision: string | null }[]
}

// Tier one: the shell. Vite generated this list, so every entry exists.
precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()

/**
 * Versioned data: immutable, so cache first and never revalidate.
 *
 * A new build is a new `dataVersion` and therefore a new URL, so a stale
 * response is impossible rather than merely unlikely.
 */
registerRoute(
  ({ url }) => url.pathname.includes('/data/v/'),
  new CacheFirst({ cacheName: 'mistria-data' }),
)

/**
 * The atlases and portraits: also content-addressed in their filenames.
 *
 * Deliberately **not** precached. They come to a couple of megabytes and the app
 * renders completely without them — every icon falls back to a drawn glyph — so
 * putting them behind the all-or-nothing install would trade a working offline
 * app for prettier icons.
 */
registerRoute(
  ({ url }) => url.pathname.includes('/assets/game/'),
  new CacheFirst({ cacheName: 'mistria-art' }),
)

/**
 * `meta.json` is the one file that changes at a fixed URL.
 *
 * Stale-while-revalidate: the app starts instantly from cache and discovers a
 * new `dataVersion` in the background. Cache-first here would pin the app to
 * the first version it ever saw.
 */
registerRoute(
  ({ url }) => url.pathname.endsWith('/data/meta.json'),
  new StaleWhileRevalidate({ cacheName: 'mistria-meta' }),
)

/**
 * **Never `skipWaiting()` on its own.**
 *
 * A new worker taking over mid-session reloads the page under whoever is using
 * it, and reloading someone in the middle of a museum audit is hostile. The new
 * worker waits; the app notices and offers. Only an explicit message from the
 * page activates it.
 */
self.addEventListener('message', (event) => {
  if ((event.data as { type?: string } | undefined)?.type === 'SKIP_WAITING') {
    void self.skipWaiting()
  }
})
