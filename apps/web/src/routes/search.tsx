import { Link } from '@tanstack/react-router'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Column } from '~/app/AppShell'
import { ItemIcon } from '~/components/ItemIcon'
import { type DisplayIndex, loadDisplayIndex } from '~/lib/data'
import { routeFor, search } from '~/lib/search'

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
  const [index, setIndex] = useState<DisplayIndex | null>(null)
  const [query, setQuery] = useState('')
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let live = true
    loadDisplayIndex().then((loaded) => live && setIndex(loaded))
    // Focus on arrival: you came here to type.
    input.current?.focus()
    return () => {
      live = false
    }
  }, [])

  const results = useMemo(() => search(index ?? {}, query), [index, query])

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
        placeholder="An item, a villager, a place"
        aria-label="Search"
        className="mt-3 w-full rounded-tile border border-rule bg-surface px-3 py-2.5 text-base text-ink placeholder:text-ink-faint"
      />

      {query.trim() === '' ? (
        <p className="mt-4 text-ink-mute text-sm">
          {index === null
            ? 'Loading…'
            : `${Object.keys(index).length} things to look through — items, villagers, monsters and places.`}
        </p>
      ) : results.length === 0 ? (
        <p className="mt-4 text-ink-mute text-sm">Nothing matches “{query.trim()}”.</p>
      ) : (
        <ul className="mt-3 flex flex-col divide-y divide-rule border-rule border-y">
          {results.map(({ id, entry, via }) => (
            <li key={id}>
              <Link
                to={routeFor(entry.c)}
                params={{ id }}
                className="flex items-center gap-3 py-2.5 transition-colors hover:bg-sunk"
              >
                <ItemIcon iconKey={entry.i ?? `${entry.c}/${id}`} name={entry.n} size="sm" />
                <span className="min-w-0 flex-1 truncate text-ink text-sm">
                  {entry.n}
                  {/* Why this row is here at all. Without it a result whose name
                      does not contain what you typed reads as a broken search. */}
                  {via !== null && <span className="ml-2 text-ink-faint text-xs">also {via}</span>}
                </span>
                <span className="shrink-0 text-ink-faint text-xs">
                  {entry.c.replace(/_/g, ' ')}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Column>
  )
}
