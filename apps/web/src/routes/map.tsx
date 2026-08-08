import { Link } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { Column } from '~/app/AppShell'
import { useAtlas } from '~/app/AtlasProvider'
import { LoadError } from '~/components/Section'
import { type MapRegionShape, ValleyMap } from '~/components/ValleyMap'
import { loadDataset } from '~/lib/data'
import { titleCase } from '~/lib/labels'

/**
 * The map screen.
 *
 * The pins are the wiki's published coordinates and the region shapes are
 * measured from its v0.13 map, which the game has moved on from. **That is said
 * once, here, and not repeated on every pin** — a caveat attached to all
 * forty-six markers stops being read by the second screen, and the hollow
 * treatment stays reserved for genuine inference like habitat expansion. These
 * are sourced numbers, just older ones.
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
  const [state, setState] = useState<{
    map: MapRecord | null
    locations: LocationRecord[]
    spots: SpotRecord[]
    error: string | null
  }>({ map: null, locations: [], spots: [], error: null })
  const [selected, setSelected] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    Promise.all([
      loadDataset<MapRecord>('maps'),
      loadDataset<LocationRecord>('locations'),
      loadDataset<SpotRecord>('spots'),
    ])
      .then(([maps, locations, spots]) => {
        if (!live) return
        setState({ map: maps[0] ?? null, locations, spots, error: null })
      })
      .catch((err: unknown) => {
        if (!live) return
        setState((s) => ({ ...s, error: err instanceof Error ? err.message : String(err) }))
      })
    return () => {
      live = false
    }
  }, [])

  const { map, locations, spots, error } = state

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
          ...spots
            .filter((s) => s.location_id === selected)
            .map((s) => ({ id: s.id, x: s.x, y: s.y, label: titleCase(s.id) })),
        ]

  return (
    <Screen>
      <header className="mb-3">
        <h1 className="text-2xl">Map</h1>
        <p className="mt-1 text-ink-mute text-sm">
          {selectedRegion === null ? (
            `${regions.length} regions, ${inside.length} places inside them.`
          ) : (
            <>
              <Link
                to="/place/$id"
                params={{ id: selectedRegion.id }}
                className="underline decoration-rule underline-offset-4 hover:text-ink"
              >
                {selectedRegion.name}
              </Link>
              {` — ${pins.length} places. `}
              <Link
                to="/place/$id"
                params={{ id: selectedRegion.id }}
                className="underline decoration-rule underline-offset-4 hover:text-ink"
              >
                What can I find here? →
              </Link>
            </>
          )}
        </p>
      </header>

      <div className="rounded-card border border-rule bg-surface p-3 shadow-card">
        <ValleyMap
          viewBox={map.view_box}
          regions={regions}
          selectedId={selected}
          onSelect={(id) => setSelected((current) => (current === id ? null : id))}
          pins={pins}
          artUrl={artUrl}
        />
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {regions.map((region) => (
          <button
            key={region.id}
            type="button"
            onClick={() => setSelected((current) => (current === region.id ? null : region.id))}
            className="rounded-pill border border-rule px-2.5 py-1 text-xs transition-colors"
            style={
              region.id === selected
                ? { background: 'var(--accent-tint)', color: 'var(--accent)', fontWeight: 600 }
                : { color: 'var(--ink-mute)' }
            }
          >
            {region.name}
          </button>
        ))}
      </div>

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
