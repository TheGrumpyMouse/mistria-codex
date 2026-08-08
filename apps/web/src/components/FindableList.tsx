import { useState } from 'react'
import { ItemIcon } from '~/components/ItemIcon'
import type { DisplayIndex } from '~/lib/data'
import type { FindableEntity } from '~/lib/findable'
import { groupByKind, KIND_LABELS } from '~/lib/findable'

/**
 * What the query found, as sections.
 *
 * Two rules from the data model surface directly in this component, and both are
 * about saying what we do not know rather than hiding it:
 *
 * - **Unknown is badged, not omitted.** A fish whose time nobody recorded is
 *   still catchable now; dropping it would make the screen claim less than the
 *   dataset knows. The badge is the dashed hollow treatment, never a colour.
 * - **Locked is shown, tagged.** People want to know the Legendary fish exists
 *   and why they cannot catch it.
 */

export interface FindableListProps {
  entities: FindableEntity[]
  index: DisplayIndex
  /** Location id -> display name. */
  locationNames: Map<string, string>
}

export function FindableList({ entities, index, locationNames }: FindableListProps) {
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

          <Section group={group} index={index} locationNames={locationNames} />
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
  locationNames,
}: {
  group: { kind: string; entities: FindableEntity[] }
  index: DisplayIndex
  locationNames: Map<string, string>
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
          <Row key={entity.id} entity={entity} index={index} locationNames={locationNames} />
        ))}
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
    </>
  )
}

const name = (index: DisplayIndex, id: string): string => index[id]?.n ?? id.replace(/_/g, ' ')

function Row({
  entity,
  index,
  locationNames,
}: {
  entity: FindableEntity
  index: DisplayIndex
  locationNames: Map<string, string>
}) {
  const entry = index[entity.id]
  const places = entity.locationIds.map((id) => locationNames.get(id) ?? id.replace(/_/g, ' '))

  return (
    <li className="flex items-center gap-3 py-2">
      <ItemIcon
        iconKey={entry?.i ?? `${entity.kind}/${entity.id}`}
        name={name(index, entity.id)}
        size="sm"
      />

      <div className="min-w-0 flex-1">
        <p className="truncate text-ink text-sm">{name(index, entity.id)}</p>
        <p className="truncate text-ink-faint text-xs">
          {entity.placeUnknown ? 'place unknown' : places.join(' · ')}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        {/*
          Badged rather than dropped. 801 of 832 rules have no recorded time, so
          this is the common case and not an exception — and an unverified
          answer beats a missing one.
        */}
        {entity.timeUnknown && (
          <span className="unverified rounded-tile px-1.5 py-0.5 text-[10px]">any time</span>
        )}
        {entity.requires.length > 0 && (
          <span
            className="rounded-pill px-1.5 py-0.5 text-[10px]"
            style={{ background: 'var(--sunk)', color: 'var(--locked)' }}
            title={entity.requires.join(', ')}
          >
            locked
          </span>
        )}
      </div>
    </li>
  )
}
