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
