import { SEASONS, type Season } from '@mistria/schema'
import { getRouteApi, Link } from '@tanstack/react-router'
import { useEffect, useMemo, useState } from 'react'
import { Column } from '~/app/AppShell'
import { ItemIcon } from '~/components/ItemIcon'
import { Section, Unknown } from '~/components/Section'
import { type DisplayIndex, loadAvailability, loadDataset, loadDisplayIndex } from '~/lib/data'
import { type AvailabilityIndex, KIND_LABELS } from '~/lib/findable'
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
  unlock_requires: string[]
  data_gaps: string[]
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
    places: Map<string, string>
    availability: AvailabilityIndex | null
    index: DisplayIndex
    loading: boolean
  }>({ place: null, places: new Map(), availability: null, index: {}, loading: true })

  useEffect(() => {
    let live = true
    Promise.all([loadDataset<LocationRecord>('locations'), loadAvailability(), loadDisplayIndex()])
      .then(([locations, availability, index]) => {
        if (!live) return
        setState({
          place: locations.find((l) => l.id === id) ?? null,
          places: new Map(locations.map((l) => [l.id, l.name])),
          availability,
          index,
          loading: false,
        })
      })
      .catch(() => live && setState((s) => ({ ...s, loading: false })))
    return () => {
      live = false
    }
  }, [id])

  const { place, places, availability, index, loading } = state

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
          No place here is called <code>{id}</code>.{' '}
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
      <header>
        <h1 className="text-2xl">{place.name}</h1>
        <p className="mt-0.5 text-ink-mute text-sm">
          {place.kind?.replace(/_/g, ' ') ?? 'place'}
          {place.parent_id !== null && ` · in ${places.get(place.parent_id) ?? place.parent_id}`}
        </p>
      </header>

      {place.unlock_requires.length > 0 && (
        // Shown, never used to hide. Knowing a place exists and is locked is
        // information; a place that silently is not there is not.
        <p className="unverified mt-3 rounded-tile px-2 py-1 text-xs">
          Locked until: {place.unlock_requires.join(', ').replace(/_/g, ' ')}
        </p>
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

      {place.habitats.length > 0 && (
        <Section title="Terrain">
          <p className="text-ink-mute text-sm">{place.habitats.join(' · ').replace(/_/g, ' ')}</p>
        </Section>
      )}

      <p className="mt-6 text-xs">
        <Link to="/map" className="text-ink-mute underline decoration-rule underline-offset-4">
          See it on the map →
        </Link>
      </p>

      {place.data_gaps.length > 0 && (
        <p className="mt-2 text-ink-faint text-xs">
          Not recorded: {place.data_gaps.join(', ').replace(/_/g, ' ')}.
        </p>
      )}
    </Column>
  )
}
