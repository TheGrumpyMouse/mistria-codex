import { getRouteApi, Link } from '@tanstack/react-router'
import { useMemo } from 'react'
import { Column } from '~/app/AppShell'
import { ItemIcon } from '~/components/ItemIcon'
import { LoadError } from '~/components/Section'
import { SpoilerChip, veilReasonOf } from '~/components/Spoiler'
import { loadDisplayIndex } from '~/lib/data'
import { routeFor, typedTheName } from '~/lib/search'
import { useSpoilers } from '~/lib/spoilers'
import { useData } from '~/lib/use-data'

const route = getRouteApi('/browse')

/**
 * Everything, by category.
 *
 * Built on `index.json` alone — 103KB for 1,251 records — rather than on
 * `items.json` at a megabyte. A browse screen needs a name, an icon and a price;
 * it does not need every availability window, and downloading them to show a
 * list is the parse that freezes a mid-range phone.
 *
 * Not virtualised, deliberately. The largest category is 235 rows, and a
 * virtualiser costs a dependency, a measured row height and a class of
 * scroll-restoration bug to save painting a few hundred list items that the
 * browser is already good at. If a category ever reaches thousands, revisit it.
 */

const CATEGORIES: { id: string; label: string }[] = [
  { id: 'fish', label: 'Fish' },
  { id: 'bug', label: 'Bugs' },
  { id: 'forageable', label: 'Forage' },
  { id: 'crop', label: 'Crops' },
  { id: 'seed', label: 'Seeds' },
  { id: 'cooked', label: 'Cooked' },
  { id: 'artifact', label: 'Artifacts' },
  { id: 'material', label: 'Materials' },
  { id: 'equipment', label: 'Equipment' },
  { id: 'tool', label: 'Tools' },
  { id: 'weapon', label: 'Weapons' },
  { id: 'ranching_product', label: 'Ranching' },
  { id: 'fruit', label: 'Fruit' },
  { id: 'junk', label: 'Junk' },
  { id: 'misc', label: 'Other' },
  { id: 'character', label: 'Villagers' },
  { id: 'monster', label: 'Monsters' },
  { id: 'location', label: 'Places' },
  // 352 records — a fifth of the index. Absent from this list, they were
  // findable only through search, which read as missing data.
  { id: 'quest', label: 'Quests' },
]

export function BrowseRoute() {
  // Category and filter live in the URL, so the back button restores this
  // screen exactly — same rows, same scroll. Typing replaces the history
  // entry rather than stacking one per keystroke.
  const search = route.useSearch()
  const navigate = route.useNavigate()
  const category = search.c ?? 'fish'
  const filter = search.q ?? ''
  // Defaults are omitted from the URL rather than written as `undefined` —
  // exactOptionalPropertyTypes treats those differently, and a bare /browse
  // should stay a bare /browse.
  const setCategory = (c: string): void =>
    void navigate({
      search: ({ c: _, ...rest }) => (c === 'fish' ? rest : { ...rest, c }),
      replace: true,
    })
  const setFilter = (q: string): void =>
    void navigate({
      search: ({ q: _, ...rest }) => (q === '' ? rest : { ...rest, q }),
      replace: true,
    })

  const { data: index, error } = useData('display-index', loadDisplayIndex)
  const spoilers = useSpoilers()

  const rows = useMemo(() => {
    if (index === null) return []
    const needle = filter.trim().toLowerCase()
    return Object.entries(index)
      .filter(([, entry]) => entry.c === category)
      .filter(([, entry]) => needle === '' || entry.n.toLowerCase().includes(needle))
      .sort((a, b) => a[1].n.localeCompare(b[1].n))
  }, [index, category, filter])

  const counts = useMemo(() => {
    const tally = new Map<string, number>()
    for (const entry of Object.values(index ?? {})) {
      tally.set(entry.c, (tally.get(entry.c) ?? 0) + 1)
    }
    return tally
  }, [index])

  if (error !== null) {
    return (
      <Column>
        <LoadError />
      </Column>
    )
  }

  return (
    <Column>
      <header>
        <h1 className="text-2xl">Browse</h1>
        <p className="mt-1 text-ink-mute text-sm">
          {index === null ? 'Loading…' : `${Object.keys(index).length} things, by category.`}
        </p>
      </header>

      <div className="mt-3 flex flex-wrap gap-1">
        {CATEGORIES.filter((c) => (counts.get(c.id) ?? 0) > 0).map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => setCategory(c.id)}
            className="rounded-pill border border-rule px-2.5 py-1 text-xs transition-colors"
            style={
              category === c.id
                ? { background: 'var(--accent-tint)', color: 'var(--accent)', fontWeight: 600 }
                : { color: 'var(--ink-mute)' }
            }
          >
            {c.label} <span data-numeral>{counts.get(c.id)}</span>
          </button>
        ))}
      </div>

      <input
        type="search"
        value={filter}
        onChange={(event) => setFilter(event.target.value)}
        placeholder="Filter by name"
        aria-label="Filter by name"
        className="mt-3 w-full rounded-tile border border-rule bg-surface px-3 py-2 text-ink text-sm placeholder:text-ink-faint"
      />

      <ul className="mt-3 flex flex-col divide-y divide-rule border-rule border-y">
        {rows.map(([id, entry]) => {
          // Veiled, not dropped: the count above stays honest and the row
          // still opens its (veiled) page. Typing the name lifts it.
          const reason = veilReasonOf(entry)
          const veiled = reason !== null && !spoilers.shown(id) && !typedTheName(entry, filter)
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
                    <span className="min-w-0 flex-1 truncate text-ink text-sm">{entry.n}</span>
                    {entry.v !== null && (
                      <span data-numeral className="shrink-0 text-ink-mute text-xs tabular-nums">
                        {entry.v}t
                      </span>
                    )}
                  </>
                )}
              </Link>
            </li>
          )
        })}
      </ul>

      {rows.length === 0 && index !== null && (
        <p className="mt-4 text-ink-mute text-sm">Nothing matches “{filter}”.</p>
      )}
    </Column>
  )
}
