import { RouterProvider } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { AtlasProvider } from '~/app/AtlasProvider'
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
        route change must never re-fetch it. */}
    <AtlasProvider>
      <RouterProvider router={router} />
      <UpdateToast />
    </AtlasProvider>
  </StrictMode>,
)
