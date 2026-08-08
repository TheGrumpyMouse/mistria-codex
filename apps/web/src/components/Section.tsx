import { gapLabels } from '~/lib/labels'

/**
 * The wrappers every detail screen is made of.
 *
 * Extracted from the item route when the villager route needed the same pair.
 * `Unknown` matters more than it looks: it is the single place the "we don't
 * know this" treatment is defined, so a missing value can never accidentally
 * render like a known one.
 */
export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-5">
      <h2 className="font-display font-semibold text-ink text-sm">{title}</h2>
      <div className="mt-1.5">{children}</div>
    </section>
  )
}

export const Unknown = ({ children }: { children: React.ReactNode }) => (
  <p className="unverified inline-block rounded-tile px-2 py-1 text-xs">{children}</p>
)

/**
 * The honest footer: what this record does not know, in a player's words.
 *
 * Internal bookkeeping tokens are dropped by `gapLabels`, not translated —
 * "id pending rename" told a player nothing and looked broken. When a wiki
 * page exists it is offered, because "we don't know" and "nobody knows" are
 * different answers and the wiki may have caught up since this snapshot.
 */
export function NotRecorded({ gaps, wikiPage }: { gaps: string[]; wikiPage?: string | null }) {
  const words = gapLabels(gaps)
  if (words.length === 0) return null

  return (
    <p className="mt-6 text-ink-faint text-xs">
      Not recorded yet: {words.join(', ')}.
      {wikiPage != null && (
        <>
          {' '}
          The{' '}
          <a
            href={`https://fieldsofmistria.wiki.gg/wiki/${encodeURIComponent(wikiPage)}`}
            target="_blank"
            rel="noreferrer"
            className="underline decoration-rule underline-offset-4 hover:text-ink-mute"
          >
            wiki page
          </a>{' '}
          may know more.
        </>
      )}
    </p>
  )
}

/**
 * The one data-load failure message, for every screen that fetches.
 *
 * This app is offline-first, so the honest reading of a failed fetch is
 * "connection", not "bug" — and the old text told players to run a build
 * command they do not have.
 */
export const LoadError = () => (
  <p className="text-gap text-sm">
    Couldn’t load the almanac. Check your connection and reload — everything seen before works
    offline.
  </p>
)
