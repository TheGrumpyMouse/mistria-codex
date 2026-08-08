import type { Meta } from '@mistria/schema'
import { getRouteApi, Link } from '@tanstack/react-router'
import { useEffect, useMemo, useState } from 'react'
import { Column } from '~/app/AppShell'
import { useAtlas } from '~/app/AtlasProvider'
import { ItemIcon } from '~/components/ItemIcon'
import { OpportunityCard } from '~/components/OpportunityCard'
import { ValleyMap } from '~/components/ValleyMap'
import {
  type DisplayIndex,
  loadAvailability,
  loadDataset,
  loadDisplayIndex,
  loadMeta,
} from '~/lib/data'
import { type AvailabilityIndex, ruleMatches } from '~/lib/findable'
import { formatDate } from '~/lib/instant'
import { opportunitiesFor } from '~/lib/opportunity'

const route = getRouteApi('/item/$id/when')

interface LocationLite {
  id: string
  name: string
  parent_id: string | null
  shape: { type: 'cells'; cell: number; runs: [number, number, number][] } | null
  anchor: { x: number; y: number } | null
}

/**
 * "When can I get this?" — the reverse of the Today screen.
 *
 * It runs on the same `availability.json` the Today query scans, filtered to one
 * entity, which is why it costs nothing: 119KB already downloaded, no new
 * dataset, no new index. That was the point of shipping the flat rule form.
 *
 * The instant comes from the URL exactly as it does on Today, so "in 43 days" is
 * counted from whatever date the user was looking at — and a link to this page
 * carries that date with it.
 */
export function WhenRoute() {
  const { id } = route.useParams()
  const instant = route.useSearch()

  const [state, setState] = useState<{
    availability: AvailabilityIndex | null
    index: DisplayIndex
    names: Map<string, string>
    locations: LocationLite[]
    meta: Meta | null
    loading: boolean
  }>({ availability: null, index: {}, names: new Map(), locations: [], meta: null, loading: true })

  useEffect(() => {
    let live = true
    Promise.all([
      loadAvailability(),
      loadDisplayIndex(),
      loadMeta(),
      loadDataset<LocationLite>('locations'),
    ])
      .then(([availability, index, meta, locations]) => {
        if (!live) return
        setState({
          availability,
          index,
          names: new Map(locations.map((l) => [l.id, l.name])),
          locations,
          meta,
          loading: false,
        })
      })
      .catch(() => live && setState((s) => ({ ...s, loading: false })))
    return () => {
      live = false
    }
  }, [])

  const { availability, index, names, locations, meta, loading } = state
  const artUrl = useAtlas().mapUrl('map/valley')
  const entry = index[id]

  const opportunities = useMemo(
    () =>
      availability === null
        ? []
        : opportunitiesFor(
            availability.rules,
            availability.locations,
            id,
            instant,
            ruleMatches,
            meta?.weatherOdds,
          ),
    [availability, id, instant, meta],
  )

  if (loading) {
    return (
      <Column>
        <p className="text-ink-mute text-sm">Loading…</p>
      </Column>
    )
  }

  const name = entry?.n ?? id.replace(/_/g, ' ')

  return (
    <Column>
      <header className="flex items-center gap-3">
        <ItemIcon iconKey={entry?.i ?? `item/${id}`} name={name} size="lg" />
        <div className="min-w-0">
          <h1 className="truncate text-2xl">When to get {name}</h1>
          <p className="mt-0.5 text-ink-mute text-sm">
            Counted from {formatDate(instant)}.{' '}
            <Link
              to="/item/$id"
              params={{ id }}
              className="underline decoration-rule underline-offset-4"
            >
              Back to the item
            </Link>
          </p>
        </div>
      </header>

      {opportunities.length === 0 ? (
        <p className="mt-5 text-ink-mute text-sm">
          Nothing in the dataset says how this is found. That is a gap in what we know, not a claim
          that it cannot be got — see the item page for what is recorded.
        </p>
      ) : (
        <>
          <ul className="mt-5 flex flex-col divide-y divide-rule border-rule border-y">
            {opportunities.map((opportunity) => (
              <OpportunityCard
                key={ruleKey(opportunity.rule, opportunity.locationId)}
                opportunity={opportunity}
                locationNames={names}
                odds={meta?.weatherOdds}
              />
            ))}
          </ul>

          <WhereMap opportunities={opportunities} locations={locations} artUrl={artUrl} />
        </>
      )}

      <p className="mt-4 text-ink-faint text-xs">
        Weather is rolled per season, not scheduled, so anything that needs weather has a frequency
        rather than a date. The frequencies come from the game's own seasonal counts.
      </p>
    </Column>
  )
}

/**
 * A stable key for a rule.
 *
 * Not the array index: rules are ordered by the build, and an index changes
 * meaning the moment one is inserted upstream.
 */
const ruleKey = (
  rule: { k: string; sea: number; wx: number; t: [number, number][] },
  locationId: string | null,
): string => `${rule.k}:${locationId ?? '?'}:${rule.sea}:${rule.wx}:${rule.t.join()}`

/**
 * The places above, on the map.
 *
 * Pins land on each opportunity's location; a single region focuses, several
 * show the whole valley. Rendered under the list because "when" is this
 * page's question and "where" its follow-up — and skipped entirely when no
 * opportunity names a place, because an empty map answers nothing.
 */
function WhereMap({
  opportunities,
  locations,
  artUrl,
}: {
  opportunities: { locationId: string | null }[]
  locations: LocationLite[]
  artUrl: string | null
}) {
  const byId = new Map(locations.map((l) => [l.id, l]))
  const targets = [
    ...new Set(opportunities.flatMap((o) => (o.locationId === null ? [] : [o.locationId]))),
  ]
    .map((locId) => byId.get(locId))
    .filter((l): l is LocationLite => l !== undefined)
  if (targets.length === 0) return null

  const regionOf = (l: LocationLite): string | null =>
    l.shape !== null ? l.id : (l.parent_id ?? null)
  const regionIds = [
    ...new Set(targets.flatMap((l) => (regionOf(l) === null ? [] : [regionOf(l)]))),
  ]
  const regions = locations
    .filter((l) => l.shape !== null)
    .map((l) => ({ id: l.id, name: l.name, shape: l.shape, anchor: l.anchor }))

  return (
    <div className="mt-4">
      <div className="rounded-card border border-rule bg-surface p-2">
        <ValleyMap
          viewBox="0 0 5442 3599"
          regions={regions}
          focusId={regionIds.length === 1 ? (regionIds[0] ?? null) : null}
          artUrl={artUrl}
          pins={targets.flatMap((l) =>
            l.anchor === null ? [] : [{ id: l.id, x: l.anchor.x, y: l.anchor.y, label: l.name }],
          )}
        />
      </div>
    </div>
  )
}
