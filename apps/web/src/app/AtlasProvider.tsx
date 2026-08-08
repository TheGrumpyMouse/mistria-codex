import { createContext, type ReactNode, useContext, useEffect, useState } from 'react'
import { Atlas, type AtlasIndex, EMPTY_ATLAS } from '~/lib/sprites'

/**
 * Loads the sprite atlas index, once, for the whole app.
 *
 * **The app must render correctly before this resolves and if it never
 * resolves.** Sprites are an enhancement over the drawn glyph, not a
 * prerequisite: a missing atlas means every icon falls back, which is exactly
 * what happens today for the thirty-odd records the wiki has no art for. So the
 * initial value is a real empty atlas rather than `null`, and nothing in the
 * tree has to branch on "not loaded yet".
 */
const AtlasContext = createContext<Atlas>(EMPTY_ATLAS)

/** Cached across remounts — the index is immutable for the life of the page. */
let pending: Promise<Atlas> | null = null

function loadAtlas(): Promise<Atlas> {
  if (pending !== null) return pending

  // No leading slash: GitHub Pages serves this from /<repo>/, and an absolute
  // path works in dev and 404s in production. See apps/web/CLAUDE.md.
  const base = import.meta.env.BASE_URL
  pending = fetch(`${base}assets/game/atlas.json`)
    .then(async (response) => {
      if (!response.ok) throw new Error(`atlas.json: ${response.status}`)
      return new Atlas((await response.json()) as AtlasIndex, base)
    })
    .catch(() => EMPTY_ATLAS)

  return pending
}

export function AtlasProvider({ children }: { children: ReactNode }) {
  const [atlas, setAtlas] = useState(EMPTY_ATLAS)

  useEffect(() => {
    let live = true
    void loadAtlas().then((loaded) => {
      if (live) setAtlas(loaded)
    })
    return () => {
      live = false
    }
  }, [])

  return <AtlasContext.Provider value={atlas}>{children}</AtlasContext.Provider>
}

export function useAtlas(): Atlas {
  return useContext(AtlasContext)
}
