import { getRouteApi, Link } from '@tanstack/react-router'
import { useEffect, useMemo, useRef } from 'react'
import { Column } from '~/app/AppShell'
import { ItemIcon } from '~/components/ItemIcon'
import { SpoilerChip, veilReasonOf } from '~/components/Spoiler'
import { loadDataset, loadDisplayIndex } from '~/lib/data'
import { useDocumentTitle } from '~/lib/head'
import { categoryLabelOne, floorRange, type MineFloors } from '~/lib/labels'
import { routeFor, search, typedTheName } from '~/lib/search'
import { useSpoilers } from '~/lib/spoilers'
import { useData } from '~/lib/use-data'

const route = getRouteApi('/search')

/**
 * Search, over the index the app already has.
 *
 * The plan called for MiniSearch, serialised at build time and parsed in a
 * worker. That was the right shape for a corpus with prose in it — and this one
 * has none. Every searchable field is a **name**: 1,251 of them, already
 * downloaded for every other screen, and a substring scan over them is
 * sub-millisecond.
 *
 * So no index file, no worker, no dependency, and nothing to keep in step with
 * the data. Revisit if search ever has to cover descriptions or recipe steps —
 * it will not, because this project does not hold prose.
 */

export function SearchRoute() {
  useDocumentTitle('Search')
  // The query lives in the URL: back from a result returns to the same
  // results at the same scroll, and a search is shareable.
  const { q } = route.useSearch()
  const navigate = route.useNavigate()
  const query = q ?? ''
  const setQuery = (next: string): void =>
    void navigate({ search: next === '' ? {} : { q: next }, replace: true })

  const { data: index } = useData('display-index', loadDisplayIndex)
  // A search hit on a mine is a reference to it like any other, and the index
  // has no floor data — 4KB joins the five that need it. `undefined` while it
  // loads simply means no range yet, never a wrong one.
  const { data: mines } = useData('mines', () =>
    loadDataset<{ location_id: string | null; floors: MineFloors }>('mines'),
  )
  const floorsByPlace = useMemo(
    () =>
      new Map(
        (mines ?? []).flatMap((m) => (m.location_id === null ? [] : [[m.location_id, m.floors]])),
      ),
    [mines],
  )
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    // Focus on arrival: you came here to type.
    input.current?.focus()
  }, [])

  const results = useMemo(() => search(index ?? {}, query), [index, query])
  const spoilers = useSpoilers()

  return (
    <Column>
      <header>
        <h1 className="text-2xl">Search</h1>
      </header>

      <input
        ref={input}
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Anything — items, villagers, quests, recipes, places"
        aria-label="Search"
        className="mt-3 w-full rounded-tile border border-rule bg-surface px-3 py-2.5 text-base text-ink placeholder:text-ink-faint"
      />

      {query.trim() === '' ? (
        <p className="mt-4 text-ink-mute text-sm">
          {index === null
            ? 'Loading…'
            : `${Object.keys(index).length} things to look through — every item, villager, quest, recipe, monster and place in the game.`}
        </p>
      ) : results.length === 0 ? (
        <p className="mt-4 text-ink-mute text-sm">Nothing matches “{query.trim()}”.</p>
      ) : (
        <ul className="mt-3 flex flex-col divide-y divide-rule border-rule border-y">
          {results.map(({ id, entry, via }) => {
            // The typed-it exemption: a veiled record shows its real name to
            // someone whose query already is that name — redacting "Caldarus"
            // from the person who typed "caldarus" would only look broken.
            const floors = floorsByPlace.get(id)
            const reason = veilReasonOf(entry)
            const veiled = reason !== null && !spoilers.shown(id) && !typedTheName(entry, query)
            return (
              <li key={id}>
                <Link
                  to={routeFor(entry.c)}
                  params={{ id }}
                  className="flex items-center gap-3 py-2.5 transition-colors hover:bg-sunk"
                >
                  {veiled && reason !== null ? (
                    <SpoilerChip reason={reason} />
                  ) : (
                    <>
                      <ItemIcon iconKey={entry.i ?? `${entry.c}/${id}`} name={entry.n} size="sm" />
                      <span className="min-w-0 flex-1 truncate text-ink text-sm">
                        {entry.n}
                        {floors !== undefined && (
                          <span data-numeral className="text-ink-faint">
                            {' '}
                            ({floorRange(floors)})
                          </span>
                        )}
                        {/* Why this row is here at all. Without it a result whose name
                            does not contain what you typed reads as a broken search. */}
                        {via !== null && (
                          <span className="ml-2 text-ink-faint text-xs">also {via}</span>
                        )}
                      </span>
                    </>
                  )}
                  <span className="ml-auto shrink-0 text-ink-faint text-xs">
                    {categoryLabelOne(entry.c)}
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
      )}

      {/*
        The way into Browse for a thumb. On a desktop the sidebar lists Browse;
        on a phone the bottom nav is full at five and Browse lost the seat — so
        without this, the only browsing entry on mobile is knowing the URL.
        Search is where you go when you can name the thing; this is the door
        for when you cannot. Hidden on desktop, where the sidebar already
        answers it.
      */}
      <p className="mt-6 lg:hidden">
        <Link
          to="/browse"
          className="tap-target inline-flex w-full items-center justify-center rounded-tile border border-rule px-3 py-2.5 text-ink-mute text-sm transition-colors hover:text-ink"
        >
          Browse all items →
        </Link>
      </p>
    </Column>
  )
}
