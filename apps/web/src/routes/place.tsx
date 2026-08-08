import { SEASONS, type Season } from '@mistria/schema'
import { getRouteApi, Link } from '@tanstack/react-router'
import { useEffect, useMemo, useState } from 'react'
import { Column } from '~/app/AppShell'
import { useAtlas } from '~/app/AtlasProvider'
import { BackLink } from '~/components/BackLink'
import { ItemIcon } from '~/components/ItemIcon'
import { NotRecorded, Section, Unknown } from '~/components/Section'
import { ValleyMap } from '~/components/ValleyMap'
import { type DisplayIndex, loadAvailability, loadDataset, loadDisplayIndex } from '~/lib/data'
import { type AvailabilityIndex, KIND_LABELS } from '~/lib/findable'
import { requirementPhrase } from '~/lib/labels'
import { seasonsOf } from '~/lib/opportunity'

const route = getRouteApi('/place/$id')

/**
 * One place: what it is, and everything you can get there.
 *
 * The same walk as Today, filtered by location instead of by instant — so it
 * answers "I am standing in the Narrows, what is here" without the player
 * having to know what date it is. Seasons are shown per entity rather than
 * filtered out, because the useful version of this page is the one you read
 * while planning.
 *
 * It runs off `availability.json`, which is precached, so the page costs one
 * small fetch for the location record and nothing else.
 */

interface LocationRecord {
  id: string
  name: string
  kind: string | null
  aliases: string[]
  habitats: string[]
  parent_id: string | null
  shape: { type: 'cells'; cell: number; runs: [number, number, number][] } | null
  anchor: { x: number; y: number } | null
  unlock_requires: { type: string; key: string }[]
  data_gaps: string[]
}

interface SealRecord {
  id: string
  name: string
  quest_id: string
  required_items: { item_id: string; quantity: number }[]
}

interface Found {
  id: string
  kind: string
  seasons: Season[]
}

export function PlaceRoute() {
  const { id } = route.useParams()
  const [state, setState] = useState<{
    place: LocationRecord | null
    all: LocationRecord[]
    places: Map<string, string>
    availability: AvailabilityIndex | null
    index: DisplayIndex
    seals: SealRecord[]
    loading: boolean
  }>({
    place: null,
    all: [],
    places: new Map(),
    availability: null,
    index: {},
    seals: [],
    loading: true,
  })

  useEffect(() => {
    let live = true
    Promise.all([
      loadDataset<LocationRecord>('locations'),
      loadAvailability(),
      loadDisplayIndex(),
      loadDataset<SealRecord>('seals'),
    ])
      .then(([locations, availability, index, seals]) => {
        if (!live) return
        setState({
          place: locations.find((l) => l.id === id) ?? null,
          all: locations,
          places: new Map(locations.map((l) => [l.id, l.name])),
          availability,
          index,
          seals,
          loading: false,
        })
      })
      .catch(() => live && setState((s) => ({ ...s, loading: false })))
    return () => {
      live = false
    }
  }, [id])

  const { place, all, places, availability, index, seals, loading } = state
  // The region this place sits in — itself when it is one, its parent when it
  // is a building. The map panel crops to that region.
  const regionId =
    place === null ? null : place.shape !== null ? place.id : (place.parent_id ?? null)
  const regions = all
    .filter((l) => l.shape !== null)
    .map((l) => ({ id: l.id, name: l.name, shape: l.shape, anchor: l.anchor }))
  const artUrl = useAtlas().mapUrl('map/valley')
  // The seal behind this door, if the door is a seal. Its item list is the
  // useful half of the lock message.
  const gateSeal =
    place === null
      ? undefined
      : seals.find((s) =>
          place.unlock_requires.some((r) => r.type === 'quest' && r.key === s.quest_id),
        )

  const found = useMemo(() => {
    if (availability === null) return []

    // Union across rules, not one row per rule: three ways to catch the same
    // fish here is still one fish, and its seasons are all of theirs.
    const byEntity = new Map<string, Found>()
    for (const rule of availability.rules) {
      if (rule.loc === null || availability.locations[rule.loc] !== id) continue
      const existing = byEntity.get(rule.e)
      const seasons = new Set([...(existing?.seasons ?? []), ...seasonsOf(rule.sea)])
      byEntity.set(rule.e, {
        id: rule.e,
        kind: existing?.kind ?? rule.k,
        seasons: SEASONS.filter((s) => seasons.has(s)),
      })
    }

    const groups = new Map<string, Found[]>()
    for (const entity of byEntity.values()) {
      groups.set(entity.kind, [...(groups.get(entity.kind) ?? []), entity])
    }
    return [...groups.entries()]
      .map(([kind, entities]) => ({
        kind,
        entities: entities.sort((a, b) =>
          (index[a.id]?.n ?? a.id).localeCompare(index[b.id]?.n ?? b.id),
        ),
      }))
      .sort((a, b) => a.kind.localeCompare(b.kind))
  }, [availability, index, id])

  if (loading) {
    return (
      <Column>
        <p className="text-ink-mute text-sm">Loading…</p>
      </Column>
    )
  }

  if (place === null) {
    return (
      <Column>
        <h1 className="text-2xl">Not found</h1>
        <p className="mt-1 text-ink-mute text-sm">
          No place here goes by “{id.replace(/_/g, ' ')}”.{' '}
          <Link to="/map" className="underline decoration-rule underline-offset-4">
            Open the map
          </Link>
          .
        </p>
      </Column>
    )
  }

  return (
    <Column>
      <BackLink />
      <header>
        <h1 className="text-2xl">{place.name}</h1>
        <p className="mt-0.5 text-ink-mute text-sm">
          {place.kind?.replace(/_/g, ' ') ?? 'place'}
          {place.parent_id !== null && (
            <>
              {' · in '}
              <Link
                to="/place/$id"
                params={{ id: place.parent_id }}
                className="underline decoration-rule underline-offset-4 hover:text-ink"
              >
                {places.get(place.parent_id) ?? place.parent_id.replace(/_/g, ' ')}
              </Link>
            </>
          )}
        </p>
      </header>

      {place.unlock_requires.length > 0 && (
        // Shown, never used to hide. Knowing a place exists and is locked is
        // information; a place that silently is not there is not.
        <div className="unverified mt-3 rounded-tile px-3 py-2 text-xs">
          Locked — to open it,{' '}
          {place.unlock_requires.map((r) => requirementPhrase(r)).join(' and ')}.
          {/* When the door is a seal, the lock message carries the price —
              which is the half a player actually came to look up. */}
          {gateSeal !== undefined && gateSeal.required_items.length > 0 && (
            <span>
              {' '}
              That seal asks for:{' '}
              {gateSeal.required_items.map((entry, i) => (
                <span key={entry.item_id}>
                  {i > 0 && ', '}
                  <Link
                    to="/item/$id"
                    params={{ id: entry.item_id }}
                    className="underline decoration-rule underline-offset-2 hover:text-ink"
                  >
                    {index[entry.item_id]?.n ?? entry.item_id.replace(/_/g, ' ')}
                  </Link>
                  {entry.quantity > 1 && ` ×${entry.quantity}`}
                </span>
              ))}
              .
            </span>
          )}
        </div>
      )}

      <Section title="What you can get here">
        {found.length === 0 ? (
          <Unknown>Nothing is recorded as coming from here yet.</Unknown>
        ) : (
          <ul className="flex flex-col gap-4">
            {found.map(({ kind, entities }) => (
              <li key={kind}>
                <p className="text-ink text-sm">
                  {KIND_LABELS[kind] ?? kind.replace(/_/g, ' ')}
                  <span className="text-ink-faint"> · {entities.length}</span>
                </p>
                <ul className="mt-1 flex flex-col divide-y divide-rule border-rule border-y">
                  {entities.map((entity) => (
                    <li key={entity.id}>
                      <Link
                        to="/item/$id"
                        params={{ id: entity.id }}
                        className="flex items-center gap-3 py-2 transition-colors hover:bg-sunk"
                      >
                        <ItemIcon
                          iconKey={index[entity.id]?.i ?? `item/${entity.id}`}
                          name={index[entity.id]?.n ?? entity.id}
                          size="sm"
                        />
                        <span className="min-w-0 flex-1 truncate text-ink text-sm">
                          {index[entity.id]?.n ?? entity.id.replace(/_/g, ' ')}
                        </span>
                        <span className="flex shrink-0 gap-1">
                          {entity.seasons.length === SEASONS.length ? (
                            <span className="text-ink-faint text-[10px]">all year</span>
                          ) : (
                            entity.seasons.map((season) => (
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
                      </Link>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* The area itself, cropped from the same map the Map screen draws —
          pins and shapes keep their published coordinates, only the view
          narrows. On a clone with no fetched art this is the mosaic crop,
          which still answers "roughly where is this". */}
      {regionId !== null && (
        <Section title="Where it is">
          <div className="rounded-card border border-rule bg-surface p-2">
            <ValleyMap
              viewBox="0 0 5442 3599"
              regions={regions}
              selectedId={place.shape === null ? null : place.id}
              focusId={regionId}
              artUrl={artUrl}
              pins={
                place.anchor === null
                  ? []
                  : [{ id: place.id, x: place.anchor.x, y: place.anchor.y, label: place.name }]
              }
            />
          </div>
          <p className="mt-1.5 text-xs">
            <Link
              to="/map"
              className="text-ink-mute underline decoration-rule underline-offset-4 hover:text-ink"
            >
              Open the full map →
            </Link>
          </p>
        </Section>
      )}

      {place.habitats.length > 0 && (
        <Section title="Terrain">
          <p className="text-ink-mute text-sm">{place.habitats.join(' · ').replace(/_/g, ' ')}</p>
        </Section>
      )}

      <NotRecorded gaps={place.data_gaps} />
    </Column>
  )
}
