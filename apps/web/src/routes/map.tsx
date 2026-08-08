import { SEASON_BIT, SEASONS, type Season } from '@mistria/schema'
import { getRouteApi, Link } from '@tanstack/react-router'
import { useEffect, useMemo, useState } from 'react'
import { Column } from '~/app/AppShell'
import { useAtlas } from '~/app/AtlasProvider'
import { FoundHereList } from '~/components/FoundHereList'
import { LoadError } from '~/components/Section'
import { type MapRegionShape, ValleyMap } from '~/components/ValleyMap'
import { type DisplayIndex, loadAvailability, loadDataset, loadDisplayIndex } from '~/lib/data'
import { type AvailabilityIndex, foundAt } from '~/lib/findable'
import { titleCase } from '~/lib/labels'

const route = getRouteApi('/map')

/**
 * The map screen: the whole valley, or one region up close.
 *
 * Selecting a region crops the view to it (the same `focusId` machinery the
 * place page uses — pins and labels counter-scale, coordinates never move)
 * and answers "what can I find here" right underneath, because that is why
 * anyone zooms into a region. "Back to the valley" steps out again, and the
 * selection lives in the URL, so the browser's own back button does too.
 *
 * The pins are the wiki's published coordinates and the region shapes are
 * measured from its v0.13 map, which the game has moved on from. **That is
 * said once, here, and not repeated on every pin** — a caveat attached to all
 * forty-six markers stops being read by the second screen.
 */

interface LocationRecord {
  id: string
  name: string
  kind: string
  parent_id: string | null
  anchor: { x: number; y: number } | null
  shape: MapRegionShape['shape']
}

interface MapRecord {
  id: string
  view_box: string
  game_version: string | null
}

interface SpotRecord {
  id: string
  location_id: string
  x: number
  y: number
  kind: string
}

export function MapRoute() {
  const artUrl = useAtlas().mapUrl('map/valley')
  const navigate = route.useNavigate()
  const { region, season, q } = route.useSearch()
  const [state, setState] = useState<{
    map: MapRecord | null
    locations: LocationRecord[]
    spots: SpotRecord[]
    availability: AvailabilityIndex | null
    index: DisplayIndex
    error: string | null
  }>({ map: null, locations: [], spots: [], availability: null, index: {}, error: null })

  useEffect(() => {
    let live = true
    Promise.all([
      loadDataset<MapRecord>('maps'),
      loadDataset<LocationRecord>('locations'),
      loadDataset<SpotRecord>('spots'),
      loadAvailability(),
      loadDisplayIndex(),
    ])
      .then(([maps, locations, spots, availability, index]) => {
        if (!live) return
        setState({ map: maps[0] ?? null, locations, spots, availability, index, error: null })
      })
      .catch((err: unknown) => {
        if (!live) return
        setState((s) => ({ ...s, error: err instanceof Error ? err.message : String(err) }))
      })
    return () => {
      live = false
    }
  }, [])

  const { map, locations, spots, availability, index, error } = state

  // The URL's word is validated against real regions — a stale or mistyped
  // id falls back to the overview rather than a broken crop.
  const selected =
    region !== undefined && locations.some((l) => l.id === region && l.shape !== null)
      ? region
      : null

  // Changing region drops the filters — they describe a place's list, and
  // carrying "spring" from the Beach to the Mines would silently hide most
  // of a screen the player just opened.
  const select = (id: string | null): void =>
    void navigate({ search: id === null ? {} : { region: id } })
  const setSeason = (next: string | undefined): void =>
    void navigate({
      search: ({ season: _, ...rest }) => (next === undefined ? rest : { ...rest, season: next }),
      replace: true,
    })
  const setQuery = (next: string): void =>
    void navigate({
      search: ({ q: _, ...rest }) => (next === '' ? rest : { ...rest, q: next }),
      replace: true,
    })

  // What the focused region yields — the region itself plus everything
  // inside it, because a building's stock counts as the region's.
  const found = useMemo(() => {
    if (availability === null || selected === null) return []
    const ids = new Set([
      selected,
      ...locations.filter((l) => l.parent_id === selected).map((l) => l.id),
    ])
    return foundAt(availability, ids)
  }, [availability, locations, selected])

  // The region's list, narrowed. Season keeps only what any rule here yields
  // in that season; the text matches names the way the calendar's box does.
  const needle = (q ?? '').trim().toLowerCase()
  const filteredFound = useMemo(() => {
    const bit = season === undefined ? null : SEASON_BIT[season as Season]
    return found.filter((entity) => {
      if (bit !== null && (entity.seasonMask & bit) === 0) return false
      if (needle === '') return true
      const name = index[entity.id]?.n ?? entity.id.replace(/_/g, ' ')
      return name.toLowerCase().includes(needle)
    })
  }, [found, season, needle, index])

  if (error !== null) {
    return (
      <Screen>
        <LoadError />
        <p className="mt-2 text-ink-faint text-xs">{error}</p>
      </Screen>
    )
  }

  if (map === null) {
    return (
      <Screen>
        <p className="text-ink-mute text-sm">Loading the valley…</p>
      </Screen>
    )
  }

  // Regions are the top-level outdoor places; everything else is inside one.
  const regions: MapRegionShape[] = locations
    .filter((l) => l.shape !== null)
    .map((l) => ({ id: l.id, name: l.name, shape: l.shape, anchor: l.anchor }))

  const inside = locations.filter((l) => l.anchor !== null && l.shape === null)
  const selectedRegion = locations.find((l) => l.id === selected) ?? null

  // What sits in the selected region: its buildings, and the landmarks the wiki
  // places inside it. With nothing selected the buildings are the pins, because
  // "where is the blacksmith" is the question this screen exists to answer.
  const pins =
    selected === null
      ? inside.map((l) => ({ id: l.id, x: l.anchor?.x ?? 0, y: l.anchor?.y ?? 0, label: l.name }))
      : [
          ...inside
            .filter((l) => l.parent_id === selected)
            .map((l) => ({ id: l.id, x: l.anchor?.x ?? 0, y: l.anchor?.y ?? 0, label: l.name })),
          // Spot pins are landmarks, not places — nothing to open.
          ...spots
            .filter((s) => s.location_id === selected)
            .map((s) => ({ id: s.id, x: s.x, y: s.y, label: titleCase(s.id), open: false })),
        ]

  return (
    <Screen>
      <header className="mb-3">
        <h1 className="text-2xl">{selectedRegion === null ? 'Map' : selectedRegion.name}</h1>
        <p className="mt-1 text-ink-mute text-sm">
          {selectedRegion === null ? (
            `${regions.length} regions, ${inside.length} places inside them.`
          ) : (
            <>
              {`${pins.length} places here. `}
              <Link
                to="/place/$id"
                params={{ id: selectedRegion.id }}
                className="underline decoration-rule underline-offset-4 hover:text-ink"
              >
                About {selectedRegion.name} →
              </Link>
            </>
          )}
        </p>
      </header>

      {selected !== null && (
        <p className="mb-2">
          <button
            type="button"
            onClick={() => select(null)}
            className="tap-target rounded-tile border border-rule px-3 py-1.5 text-ink-mute text-xs transition-colors hover:text-ink"
          >
            ← Back to the valley
          </button>
        </p>
      )}

      <div className="rounded-card border border-rule bg-surface p-3 shadow-card">
        <ValleyMap
          viewBox={map.view_box}
          regions={regions}
          selectedId={selected}
          focusId={selected}
          onSelect={(id) => select(selected === id ? null : id)}
          pins={pins}
          artUrl={artUrl}
          // A building pin opens its page — "where is the blacksmith" ends at
          // the blacksmith, not at a rectangle with a tooltip.
          onPinClick={(id) => void navigate({ to: '/place/$id', params: { id } })}
        />
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {regions.map((r) => (
          <button
            key={r.id}
            type="button"
            onClick={() => select(selected === r.id ? null : r.id)}
            className="tap-target rounded-pill border border-rule px-2.5 py-1 text-xs transition-colors"
            style={
              r.id === selected
                ? { background: 'var(--accent-tint)', color: 'var(--accent)', fontWeight: 600 }
                : { color: 'var(--ink-mute)' }
            }
          >
            {r.name}
          </button>
        ))}
      </div>

      {/* The reason anyone zooms in: what is findable here, without leaving
          the map. Same shared list the place page renders, narrowable by
          season and by name — "what can I still get at the Beach this
          winter" is a real planning question. */}
      {selected !== null && (
        <section className="mt-5">
          <h2 className="mb-2 font-display font-semibold text-ink text-sm">
            What you can get here
          </h2>

          <div className="mb-2 flex flex-wrap items-center gap-1">
            <button
              type="button"
              onClick={() => setSeason(undefined)}
              className="tap-target rounded-pill border border-rule px-2.5 py-1 text-xs transition-colors"
              style={
                season === undefined
                  ? { background: 'var(--accent-tint)', color: 'var(--accent)', fontWeight: 600 }
                  : { color: 'var(--ink-mute)' }
              }
            >
              Any season
            </button>
            {SEASONS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSeason(season === s ? undefined : s)}
                className="tap-target rounded-pill border border-rule px-2.5 py-1 text-xs transition-colors"
                style={
                  season === s
                    ? { background: `var(--${s}-tint)`, color: `var(--${s})`, fontWeight: 600 }
                    : { color: 'var(--ink-mute)' }
                }
              >
                {titleCase(s)}
              </button>
            ))}
          </div>
          <input
            type="search"
            value={q ?? ''}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter what this place yields"
            aria-label="Filter what this place yields"
            className="mb-3 w-full rounded-tile border border-rule bg-surface px-3 py-2 text-ink text-sm placeholder:text-ink-faint"
          />

          {filteredFound.length === 0 && found.length > 0 ? (
            <p className="text-ink-mute text-sm">
              Nothing here matches
              {needle !== '' && <> “{(q ?? '').trim()}”</>}
              {season !== undefined && <> in {titleCase(season)}</>} — clear a filter to see the
              full list.
            </p>
          ) : (
            <FoundHereList entities={filteredFound} index={index} />
          )}
        </section>
      )}

      {/*
        Said once. The shapes and pins come from the wiki's map for v0.13 and
        the game is 1.0, so a building may have moved. Repeating that on every
        pin would train people to stop reading it.
      */}
      <p className="mt-4 text-ink-faint text-xs leading-relaxed">
        Positions come from the Fields of Mistria Wiki's map of v{map.game_version ?? '0.13'}; the
        game is now 1.0, so something may have moved.{' '}
        {artUrl === null
          ? 'Region shapes are measured from that map and drawn as tiles — they show roughly how far a place extends, not its exact border.'
          : 'The highlighted region shapes are approximate — they mark roughly how far a place extends, not its exact border.'}{' '}
        The pins are the wiki's own coordinates.
      </p>
    </Screen>
  )
}

function Screen({ children }: { children: React.ReactNode }) {
  // The one wide screen. Everything else in this app is a reading column; a
  // valley 5,442 units across is not read, and at 512px its labels vanish.
  return (
    <Column width="wide">
      <div className="flex flex-col">{children}</div>
    </Column>
  )
}
