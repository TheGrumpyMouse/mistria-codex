import { getRouteApi, Link } from '@tanstack/react-router'
import { useEffect, useMemo, useState } from 'react'
import { Column } from '~/app/AppShell'
import { useAtlas } from '~/app/AtlasProvider'
import { BackLink } from '~/components/BackLink'
import { FoundHereList } from '~/components/FoundHereList'
import { ItemIcon } from '~/components/ItemIcon'
import { NotRecorded, Section } from '~/components/Section'
import { SpoilerAsk } from '~/components/Spoiler'
import { ValleyMap } from '~/components/ValleyMap'
import { type DisplayIndex, loadAvailability, loadDataset, loadDisplayIndex } from '~/lib/data'
import { type AvailabilityIndex, foundAt } from '~/lib/findable'
import { useDocumentTitle } from '~/lib/head'
import {
  floorRange,
  type PlaceLabel,
  placeLabel,
  placeLabels,
  requirementDisplay,
} from '~/lib/labels'
import { iconKeyFor } from '~/lib/search'
import { useSpoilers } from '~/lib/spoilers'

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
  spoiler?: boolean
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

interface MineRecord {
  location_id: string | null
  floors: { min: number; max: number }
}

export function PlaceRoute() {
  const { id } = route.useParams()
  const [state, setState] = useState<{
    place: LocationRecord | null
    all: LocationRecord[]
    places: Map<string, PlaceLabel>
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
      loadDataset<MineRecord>('mines'),
    ])
      .then(([locations, availability, index, seals, mines]) => {
        if (!live) return
        setState({
          place: locations.find((l) => l.id === id) ?? null,
          all: locations,
          places: placeLabels(locations, mines),
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

  const spoilers = useSpoilers()
  const { place, all, places, availability, index, seals, loading } = state
  useDocumentTitle(place?.name ?? null)
  const selfFloors = places.get(id)?.floors ?? null
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

  // The walk itself is shared with the map's region panel (lib/findable.ts
  // foundAt), and it takes this place PLUS the places inside it — a region
  // page should count what its buildings sell and spawn.
  const found = useMemo(() => {
    if (availability === null) return []
    const ids = new Set([id, ...all.filter((l) => l.parent_id === id).map((l) => l.id)])
    return foundAt(availability, ids)
  }, [availability, all, id])

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

  // The veil covers the whole page, name included — the name is the spoiler.
  if (place.spoiler === true && !spoilers.shown(place.id)) {
    return (
      <Column>
        <BackLink />
        <SpoilerAsk id={place.id} kind="place" />
      </Column>
    )
  }

  return (
    <Column>
      <BackLink />
      <header className="flex items-center gap-3">
        {/* No location sprite exists anywhere, so this is always the map pin.
            It is here for the same reason the other detail screens have one:
            a page that starts with a bare heading reads as a different kind
            of page. */}
        <ItemIcon iconKey={`location/${place.id}`} name={place.name} size="lg" />
        <div className="min-w-0">
          <h1 className="text-2xl">{place.name}</h1>
          <p className="mt-0.5 text-ink-mute text-sm">
            {place.kind?.replace(/_/g, ' ') ?? 'place'}
            {/* A mine biome's depth belongs in the subtitle, not the heading:
                the name is what the rest of the app links to, and "The Tide
                Caverns (floors 21–39)" as an h1 reads as the place's name. */}
            {selfFloors !== null && (
              <>
                {' · '}
                <span data-numeral>{floorRange(selfFloors)}</span>
              </>
            )}
            {place.parent_id !== null && (
              <>
                {' · in '}
                <Link
                  to="/place/$id"
                  params={{ id: place.parent_id }}
                  className="underline decoration-rule underline-offset-4 hover:text-ink"
                >
                  {placeLabel(places, place.parent_id).name}
                </Link>
              </>
            )}
          </p>
        </div>
      </header>

      {place.unlock_requires.length > 0 && (
        // Shown, never used to hide. Knowing a place exists and is locked is
        // information; a place that silently is not there is not.
        <div className="unverified mt-3 rounded-tile px-3 py-2 text-xs">
          Locked — to open it,{' '}
          {place.unlock_requires.map((r, i) => {
            // The index is already here, so the gate gets its real name
            // ("Repair the Bell Tower", not a title-cased slug) and a link.
            const parts = requirementDisplay(r, index[r.key]?.n)
            return (
              <span key={`${r.type}:${r.key}`}>
                {i > 0 && ' and '}
                {parts.prefix}
                {parts.linkTo === null ? (
                  parts.label
                ) : (
                  <Link
                    to={parts.linkTo.to}
                    params={{ id: parts.linkTo.id }}
                    className="underline decoration-rule underline-offset-2 hover:text-ink"
                  >
                    {parts.label}
                  </Link>
                )}
                {parts.suffix}
              </span>
            )
          })}
          .
          {/* When the door is a seal, the lock message carries the price —
              which is the half a player actually came to look up. */}
          {gateSeal !== undefined && gateSeal.required_items.length > 0 && (
            <>
              <p className="mt-1.5">That seal asks for:</p>
              {/* The same shopping list the mines screen and the quest page
                  draw, drawn the same way — chips with sprites, because the
                  answer to "what do I still need" is scanned, not read. */}
              <ul className="mt-1 flex flex-wrap gap-1.5">
                {gateSeal.required_items.map((entry) => (
                  <li key={entry.item_id}>
                    <Link
                      to="/item/$id"
                      params={{ id: entry.item_id }}
                      className="tap-target flex items-center gap-1.5 rounded-tile border border-rule bg-surface py-1 pr-2 pl-1 text-ink transition-colors hover:bg-sunk"
                    >
                      <ItemIcon
                        iconKey={iconKeyFor(entry.item_id, index[entry.item_id])}
                        name={index[entry.item_id]?.n ?? entry.item_id}
                        size="sm"
                      />
                      {index[entry.item_id]?.n ?? entry.item_id.replace(/_/g, ' ')}
                      {entry.quantity > 1 && <span data-numeral>×{entry.quantity}</span>}
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      <Section title="What you can get here">
        <FoundHereList entities={found} index={index} />
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
