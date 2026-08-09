import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import { AvailabilityTags } from '~/components/AvailabilityTags'
import { ItemIcon } from '~/components/ItemIcon'
import { PlaceLink } from '~/components/PlaceLink'
import { SpoilerChip, veilReasonOf } from '~/components/Spoiler'
import type { DisplayIndex } from '~/lib/data'
import type { FindableEntity } from '~/lib/findable'
import { groupByKind, KIND_LABELS } from '~/lib/findable'
import type { PlaceLabel } from '~/lib/labels'
import { ruleRequirementsPhrase } from '~/lib/labels'
import { routeFor } from '~/lib/search'
import { useSpoilers } from '~/lib/spoilers'

/**
 * What the query found, as sections.
 *
 * Two rules from the data model surface directly in this component:
 *
 * - **Unknown does not exclude, and it does not hedge either.** A fish whose
 *   time nobody recorded is still catchable now, so the row stays — but the
 *   row simply says nothing about time. `data_gaps` still records the hole in
 *   the data; the screen no longer badges it.
 * - **Locked is shown, tagged.** People want to know the Legendary fish exists
 *   and why they cannot catch it.
 */

export interface FindableListProps {
  entities: FindableEntity[]
  index: DisplayIndex
  /** Location id -> its name and, for a mine biome, its floor range. */
  places: Map<string, PlaceLabel>
}

export function FindableList({ entities, index, places }: FindableListProps) {
  const groups = groupByKind(entities)

  if (groups.length === 0) {
    return (
      <p className="text-ink-mute text-sm">
        Nothing is findable at this instant. That is a real answer — try widening the time, or a
        different season.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      {groups.map((group) => (
        <section key={group.kind}>
          <h2 className="flex items-baseline gap-2 font-display font-semibold text-ink text-sm">
            {KIND_LABELS[group.kind] ?? group.kind}
            <span data-numeral className="font-normal text-ink-faint text-xs">
              {group.entities.length}
            </span>
          </h2>

          <Section group={group} index={index} places={places} />
        </section>
      ))}
    </div>
  )
}

/**
 * Eight rows, then a count.
 *
 * A fall afternoon turns up around 250 findable things, and the honest way to
 * present that is not 250 rows — a screen you scroll for thirteen thousand
 * pixels answers "what exists", when the question was "what should I go do".
 * Eight is enough to see the shape of a category and short enough that the next
 * heading is on the same screen. Nothing is hidden: the count says exactly how
 * much more there is and one tap shows it.
 */
const PREVIEW = 8

function Section({
  group,
  index,
  places,
}: {
  group: { kind: string; entities: FindableEntity[] }
  index: DisplayIndex
  places: Map<string, PlaceLabel>
}) {
  const [expanded, setExpanded] = useState(false)
  const sorted = [...group.entities].sort((a, b) =>
    name(index, a.id).localeCompare(name(index, b.id)),
  )
  const shown = expanded ? sorted : sorted.slice(0, PREVIEW)
  const rest = sorted.length - shown.length

  return (
    <>
      <ul className="mt-1.5 flex flex-col divide-y divide-rule border-rule border-y">
        {shown.map((entity) => (
          <FindableRow key={entity.id} entity={entity} index={index} places={places} />
        ))}
      </ul>

      {rest > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="tap-target mt-1.5 text-ink-mute text-xs hover:text-ink"
        >
          Show {rest} more
        </button>
      )}
      {expanded && sorted.length > PREVIEW && (
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="tap-target mt-1.5 text-ink-mute text-xs hover:text-ink"
        >
          Show fewer
        </button>
      )}
    </>
  )
}

const name = (index: DisplayIndex, id: string): string => index[id]?.n ?? id.replace(/_/g, ' ')

/**
 * One findable thing. Exported for the calendar's collapsed groups.
 *
 * The season and weather tags are the same two the place and map lists carry,
 * rendered by the same rules, and they say something a calendar row could not
 * say without them: **whether this is here because of today**. Every row
 * already matches the chosen instant, so "spring" on a spring day is not a
 * restatement of the filter — it is the difference between a fish you can get
 * any time and one that is gone in a fortnight. It is also what makes the
 * season and weather sorts legible: without a visible reason, a reordered list
 * looks shuffled.
 */
export function FindableRow({
  entity,
  index,
  places,
}: {
  entity: FindableEntity
  index: DisplayIndex
  places: Map<string, PlaceLabel>
}) {
  const entry = index[entity.id]
  const spoilers = useSpoilers()

  // No availability entity is veil-flagged today, but the check costs
  // nothing and means flagging one later needs no code change here.
  const veilReason = veilReasonOf(entry)
  if (entry !== undefined && veilReason !== null && !spoilers.shown(entity.id)) {
    return (
      <li className="flex items-center gap-3 py-2">
        <Link
          to={routeFor(entry.c)}
          params={{ id: entity.id }}
          className="inline-flex items-center gap-3"
        >
          <SpoilerChip reason={veilReason} />
        </Link>
      </li>
    )
  }

  return (
    <li className="flex items-center gap-3 py-2">
      <ItemIcon
        iconKey={entry?.i ?? `${entity.kind}/${entity.id}`}
        name={name(index, entity.id)}
        size="sm"
      />

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">
          <Link
            // Every availability entity is an item category today; routeFor is
            // insurance for the day one is not.
            to={routeFor(entry?.c ?? 'misc')}
            params={{ id: entity.id }}
            className="text-ink underline decoration-transparent underline-offset-4 transition-colors hover:decoration-rule"
          >
            {name(index, entity.id)}
          </Link>
        </p>
        {entity.locationIds.length > 0 && (
          <p className="truncate text-ink-faint text-xs">
            {entity.locationIds.map((locId, i) => (
              <span key={locId}>
                {i > 0 && ' · '}
                <PlaceLink
                  id={locId}
                  places={places}
                  className="underline decoration-transparent underline-offset-2 transition-colors hover:decoration-rule"
                />
              </span>
            ))}
          </p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {entity.requires.length > 0 && (
          <span
            className="rounded-pill px-1.5 py-0.5 text-[0.625rem]"
            style={{ background: 'var(--sunk)', color: 'var(--locked)' }}
            title={`Needs ${ruleRequirementsPhrase(entity.requires)}`}
          >
            locked
          </span>
        )}
        <AvailabilityTags seasonMask={entity.seasonMask} weatherMask={entity.weatherMask} />
      </div>
    </li>
  )
}
