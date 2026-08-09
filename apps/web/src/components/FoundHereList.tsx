import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import { AvailabilityTags } from '~/components/AvailabilityTags'
import { ItemIcon } from '~/components/ItemIcon'
import { SortPicker } from '~/components/SortPicker'
import { SpoilerChip, veilReasonOf } from '~/components/Spoiler'
import type { DisplayIndex } from '~/lib/data'
import { type FoundEntity, KIND_LABELS, KIND_ORDER } from '~/lib/findable'
import { type ListSort, NO_FOCUS, type SortFocus, sortEntities, useListSort } from '~/lib/list-sort'
import { iconKeyFor, routeFor } from '~/lib/search'
import { useSpoilers } from '~/lib/spoilers'

/**
 * "What you can get here" — the planning view of one place or region.
 *
 * Shared between the place page and the map's focused-region panel, so the
 * two screens can never drift into answering the same question differently.
 * Rows are grouped by kind in the Today view's order, capped at eight per
 * group with an honest count (the map panel would otherwise scroll for
 * thousands of pixels under the Narrows), season pills say when, and veiled
 * records show the chip rather than their name — the row still navigates,
 * and the page it lands on does the asking.
 *
 * The sort picker lives here rather than in the two routes for the same
 * reason: one control, one ordering, no way for the map to sort a list the
 * place page renders differently.
 */

const PREVIEW = 8

export function FoundHereList({
  entities,
  index,
  focus = NO_FOCUS,
}: {
  entities: FoundEntity[]
  index: DisplayIndex
  /**
   * The season and weather currently chosen, when the screen has chips for
   * them. Sorting by weather puts what is here *because* of that weather
   * first; with nothing chosen there is nothing to be first, and the sort
   * falls back to constrained-before-unconstrained.
   */
  focus?: SortFocus
}) {
  const [sort, setSort] = useListSort()
  const groups = new Map<string, FoundEntity[]>()
  for (const entity of entities) {
    groups.set(entity.kind, [...(groups.get(entity.kind) ?? []), entity])
  }
  const ordered = [
    ...KIND_ORDER.flatMap((kind) => {
      const found = groups.get(kind)
      return found === undefined ? [] : [{ kind: kind as string, entities: found }]
    }),
    // Kinds the canonical order does not know yet still render, after it.
    ...[...groups.entries()]
      .filter(([kind]) => !(KIND_ORDER as readonly string[]).includes(kind))
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([kind, found]) => ({ kind, entities: found })),
  ]

  if (ordered.length === 0) {
    return (
      <p className="unverified rounded-tile px-3 py-2 text-ink-mute text-sm">
        Nothing is recorded as coming from here yet.
      </p>
    )
  }

  return (
    <>
      {/* Above the groups, not above the whole section: it orders these rows
          and nothing else on the page. */}
      <div className="mb-3">
        <SortPicker value={sort} onChange={setSort} />
      </div>
      <ul className="flex flex-col gap-4">
        {ordered.map(({ kind, entities: found }) => (
          <Group key={kind} kind={kind} entities={found} index={index} sort={sort} focus={focus} />
        ))}
      </ul>
    </>
  )
}

function Group({
  kind,
  entities,
  index,
  sort,
  focus,
}: {
  kind: string
  entities: FoundEntity[]
  index: DisplayIndex
  sort: ListSort
  focus: SortFocus
}) {
  const [expanded, setExpanded] = useState(false)
  const spoilers = useSpoilers()

  // Within the kind, never across it. The groups are the shape of the errand —
  // you go fishing or you go foraging — so an ordering that interleaved them
  // would trade a useful answer for a tidier list.
  const sorted = sortEntities(entities, sort, (e) => index[e.id]?.n ?? e.id, focus)
  const shown = expanded ? sorted : sorted.slice(0, PREVIEW)
  const rest = sorted.length - shown.length

  return (
    <li>
      <p className="text-ink text-sm">
        {KIND_LABELS[kind] ?? kind.replace(/_/g, ' ')}
        <span className="text-ink-faint"> · {entities.length}</span>
      </p>
      <ul className="mt-1 flex flex-col divide-y divide-rule border-rule border-y">
        {shown.map((entity) => {
          const entry = index[entity.id]
          const reason = veilReasonOf(entry)
          const veiled = reason !== null && !spoilers.shown(entity.id)
          return (
            <li key={entity.id}>
              <Link
                to={routeFor(entry?.c ?? 'misc')}
                params={{ id: entity.id }}
                className="flex items-center gap-3 py-2 transition-colors hover:bg-sunk"
              >
                {veiled && reason !== null ? (
                  <SpoilerChip reason={reason} />
                ) : (
                  <>
                    <ItemIcon
                      iconKey={iconKeyFor(entity.id, entry)}
                      name={entry?.n ?? entity.id}
                      size="sm"
                    />
                    <span className="min-w-0 flex-1 truncate text-ink text-sm">
                      {entry?.n ?? entity.id.replace(/_/g, ' ')}
                    </span>
                    <span className="flex shrink-0 items-center gap-1">
                      <AvailabilityTags
                        seasonMask={entity.seasonMask}
                        weatherMask={entity.weatherMask}
                      />
                    </span>
                  </>
                )}
              </Link>
            </li>
          )
        })}
      </ul>
      {rest > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="mt-1.5 text-ink-mute text-xs hover:text-ink"
        >
          Show {rest} more
        </button>
      )}
      {expanded && sorted.length > PREVIEW && (
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="mt-1.5 text-ink-mute text-xs hover:text-ink"
        >
          Show fewer
        </button>
      )}
    </li>
  )
}
