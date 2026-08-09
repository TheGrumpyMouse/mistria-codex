import { RouterProvider } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { AtlasProvider } from '~/app/AtlasProvider'
import { ServiceWorkerProvider } from '~/app/ServiceWorkerProvider'
import { UpdateToast } from '~/app/UpdateToast'
import { applyTextSize, savedTextSize } from '~/lib/text-size'
import { router } from '~/router'
import './styles/app.css'

// Before the first render, so a person who chose large text never sees a
// small-text flash on the way in.
applyTextSize(savedTextSize())

/**
 * Put the house in the browser tab.
 *
 * index.html declares both the committed SVG mark and the ship-generated house
 * PNG, but Chrome ranks an SVG icon above any PNG no matter the order — so on
 * a build with fetched assets the tab showed the fallback tesserae instead of
 * the house. Removing the SVG link once the PNG is known to exist makes every
 * browser pick the house; on a clone with no assets the probe 404s and the SVG
 * mark keeps the tab. `force-cache` lets the service worker satisfy this
 * offline.
 *
 * **The one art URL with no `?v=`, and deliberately.** Everything the atlas
 * builds carries the asset version, because a stale sprite is a wrong picture.
 * This request is not asking for a picture — it asks *whether packed art
 * exists*, and a cached 200 answers that as well as a fresh one. It also runs
 * before React and before any manifest is read, so versioning it would mean
 * waiting on `meta.json` to decide a favicon.
 */
void fetch(`${import.meta.env.BASE_URL}assets/game/brand/app-icon-64.png`, {
  cache: 'force-cache',
})
  .then((response) => {
    if (!response.ok) return
    document.querySelector('link[rel="icon"][type="image/svg+xml"]')?.remove()
  })
  .catch(() => undefined)

/**
 * Ask the browser to keep our storage.
 *
 * iOS evicts Cache Storage after about a week for a PWA that is not installed,
 * which would silently throw away a museum tracker somebody spent a season
 * filling in. The request is best-effort and may be refused — hence the void —
 * but not asking guarantees the eviction.
 */
void navigator.storage?.persist?.().catch(() => undefined)

const root = document.getElementById('root')
if (root === null) throw new Error('No #root element — index.html has changed.')

createRoot(root).render(
  <StrictMode>
    {/* Outside the router: the atlas is loaded once for the whole app, and a
        route change must never re-fetch it. The worker registration is out
        here for the same reason, and so the toast and the Settings check are
        looking at one registration rather than two. */}
    <ServiceWorkerProvider>
      <AtlasProvider>
        <RouterProvider router={router} />
        <UpdateToast />
      </AtlasProvider>
    </ServiceWorkerProvider>
  </StrictMode>,
)
