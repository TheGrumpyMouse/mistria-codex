import { SEASONS } from '@mistria/schema'
import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import { ItemIcon } from '~/components/ItemIcon'
import { SpoilerChip, veilReasonOf } from '~/components/Spoiler'
import type { DisplayIndex } from '~/lib/data'
import { type FoundEntity, KIND_LABELS, KIND_ORDER } from '~/lib/findable'
import { seasonsOf } from '~/lib/opportunity'
import { routeFor } from '~/lib/search'
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
 */

const PREVIEW = 8

export function FoundHereList({
  entities,
  index,
}: {
  entities: FoundEntity[]
  index: DisplayIndex
}) {
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
    <ul className="flex flex-col gap-4">
      {ordered.map(({ kind, entities: found }) => (
        <Group key={kind} kind={kind} entities={found} index={index} />
      ))}
    </ul>
  )
}

function Group({
  kind,
  entities,
  index,
}: {
  kind: string
  entities: FoundEntity[]
  index: DisplayIndex
}) {
  const [expanded, setExpanded] = useState(false)
  const spoilers = useSpoilers()

  const sorted = [...entities].sort((a, b) =>
    (index[a.id]?.n ?? a.id).localeCompare(index[b.id]?.n ?? b.id),
  )
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
          const seasons = seasonsOf(entity.seasonMask)
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
                      iconKey={entry?.i ?? `item/${entity.id}`}
                      name={entry?.n ?? entity.id}
                      size="sm"
                    />
                    <span className="min-w-0 flex-1 truncate text-ink text-sm">
                      {entry?.n ?? entity.id.replace(/_/g, ' ')}
                    </span>
                    <span className="flex shrink-0 gap-1">
                      {seasons.length === SEASONS.length ? (
                        <span className="text-ink-faint text-[10px]">all year</span>
                      ) : (
                        seasons.map((season) => (
                          <span
                            key={season}
                            className="rounded-pill px-1.5 py-0.5 text-[10px]"
                            style={{
                              background: `var(--${season}-tint)`,
                              color: `var(--${season})`,
                            }}
                          >
                            {season}
                          </span>
                        ))
                      )}
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
