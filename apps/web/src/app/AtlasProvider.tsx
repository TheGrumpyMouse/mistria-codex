import { createContext, type ReactNode, useContext, useEffect, useState } from 'react'
import { loadMeta } from '~/lib/data'
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

/**
 * The atlas index, at a URL that changes when the art does.
 *
 * **`atlas.json` was the one file in the art bundle with a stable URL**, and
 * the service worker holds `assets/game/**` CacheFirst — so once a device had
 * a copy it kept that copy forever. The sheets it names are content-addressed
 * and updated fine; the index naming them never did. A build that added the
 * fish-shadow animation frames therefore reached devices as a new JS bundle
 * asking a months-old index for keys it had never contained, and `<FishShadow>`
 * dutifully drew the still. Nothing 404s, nothing throws, nothing logs.
 *
 * `meta.assets.version` is the hash of the whole packed bundle and existed for
 * exactly this — its schema comment says so — so the fetch carries it. A
 * failure here falls back to the bare path rather than to no art: offline, the
 * cached copy is the one we want, and a clone with no packed assets has no
 * version to state.
 */
async function loadAtlas(): Promise<Atlas> {
  // No leading slash: GitHub Pages serves this from /<repo>/, and an absolute
  // path works in dev and 404s in production. See apps/web/CLAUDE.md.
  const base = import.meta.env.BASE_URL
  // `loadMeta` dedupes, and every screen asks for it — so this is a shared
  // request rather than an extra one.
  const version = await loadMeta()
    .then((meta) => meta.assets?.version ?? null)
    .catch(() => null)

  const suffix = version === null ? '' : `?v=${version}`
  const response = await fetch(`${base}assets/game/atlas.json${suffix}`)
  if (!response.ok) throw new Error(`atlas.json: ${response.status}`)
  return new Atlas((await response.json()) as AtlasIndex, base, version)
}

function atlasOnce(): Promise<Atlas> {
  pending ??= loadAtlas().catch(() => EMPTY_ATLAS)
  return pending
}

export function AtlasProvider({ children }: { children: ReactNode }) {
  const [atlas, setAtlas] = useState(EMPTY_ATLAS)

  useEffect(() => {
    let live = true
    void atlasOnce().then((loaded) => {
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
