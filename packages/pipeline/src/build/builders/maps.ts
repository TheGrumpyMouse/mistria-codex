/**
 * Turn the wiki's map markers into anchors, spots, and one map record.
 *
 * The rule this file exists to hold: **a marker becomes a position only when
 * something in the source says which of our records it belongs to.** That is
 * either the marker's own `article`, or a hand-written entry in
 * `curated/aliases/map_markers.json` with a reason attached. It is never the
 * nearest region, because geometric containment is an inference and an
 * inference that renders as a coordinate is indistinguishable from a survey.
 *
 * Coordinates are SVG user units in the map's `viewBox`, which is the wiki's
 * own published space. Our art will be drawn to match it rather than the other
 * way round, so a pin placed today stays correct when the art lands.
 */
import { type Location, MapRegion, type Spot } from '@mistria/schema'
import type { MapShapesExtract } from '../../enrich/map-shapes.js'
import type { ExtractedMarker, MapsExtract } from '../../enrich/maps.js'

/** The one map, for now. The wiki has no usable per-region data — see the enricher. */
export const WORLD_MAP_ID = 'mistria_world'

export interface MarkerAlias {
  marker: string
  location_id: string
  reason: string
}

/**
 * What decides a marker's fate is its **article, not its group**.
 *
 * An earlier version keyed off the group — Regions and Buildings anchored,
 * everything else became a spot — and got two things wrong in opposite
 * directions. The Wishing Well is filed under `Statues` but is a location we
 * hold, so it lost its anchor; Errol's Cabin is filed under `Buildings` but
 * points *into* the Narrows' page, so it was treated as the Narrows' own
 * position. The article already says which is which:
 *
 * - links at a location's page  -> that location's anchor
 * - links into a location's page (`The_Beach#The_Lighthouse`) -> a spot in it
 * - anything else -> reported, never placed
 *
 * The group survives only to say what *kind* of spot a landmark is.
 */
const SPOT_KINDS: Record<string, Spot['kind']> = {
  Fountains: 'water',
}
const DEFAULT_SPOT_KIND: Spot['kind'] = 'entrance'

/**
 * Give each region its mosaic footprint.
 *
 * Joined on the marker's article, the same key the anchors use — so a region
 * with a shape always has the anchor that shape was measured around, and the
 * two can never drift apart.
 */
export function withShapes(
  locations: Location[],
  shapes: MapShapesExtract | null,
  aliases: MarkerAlias[] = [],
): Location[] {
  if (shapes === null) return locations

  const normalise = (value: string | null): string =>
    (value ?? '').replace(/_/g, ' ').trim().toLowerCase()

  const byPage = new Map(shapes.regions.map((r) => [normalise(r.article), r]))
  // The same alias table the anchors use. The Player's Farm links to the
  // article "Farm" while our page is "The_Farm", and a shape resolved by a
  // different rule than its anchor is a shape that can drift away from its pin.
  const byLocation = new Map<string, (typeof shapes.regions)[number]>()
  for (const alias of aliases) {
    const region = shapes.regions.find((r) => r.name === alias.marker)
    if (region !== undefined) byLocation.set(alias.location_id, region)
  }

  return locations.map((location) => {
    const shape = byLocation.get(location.id) ?? byPage.get(normalise(location.wiki_page))
    if (shape === undefined) return location
    return {
      ...location,
      shape: { type: 'cells' as const, cell: shapes.cell, runs: shape.runs },
    }
  })
}

export function buildMapRegion(extract: MapsExtract): MapRegion {
  const [width, height] = extract.size
  // Parsed rather than cast, so the envelope's defaults — `former_ids`,
  // `id_status` and the rest — are filled by the schema that owns them instead
  // of by a literal here that will drift the first time the envelope changes.
  return MapRegion.parse({
    id: WORLD_MAP_ID,
    name: 'Mistria and the valley',
    // Our own art, drawn onto the wiki's coordinate space. The file does not
    // exist yet; the record carries the gap rather than a placeholder path,
    // because a path that resolves to nothing is worse than an admitted absence.
    svg: 'world.svg',
    view_box: `0 0 ${width} ${height}`,
    map_version: 1,
    layers: ['regions', 'buildings', 'landmarks'],
    // Every position on it is the wiki's own published coordinate, so it is not
    // a stylised approximation even though the art will be stylised.
    not_to_scale: false,
    data_gaps: ['svg'],
    confidence: 'wiki',
    prov: { '*': 'wiki_page' },
    game_version: extract.gameVersion,
  })
}

export interface AnchorResult {
  /** Location id -> its anchor. */
  anchors: Map<string, { x: number; y: number }>
  /** Markers that name no record of ours. Reported, never guessed at. */
  unmatched: ExtractedMarker[]
}

/**
 * Match anchor-bearing markers to locations.
 *
 * A marker carrying a `#section` is pointing *inside* a page — `The Beach#The
 * Lighthouse` is a thing on the beach, not the beach — so it is never taken as
 * the page's own anchor. Without that rule the Beach would be pinned at its
 * lighthouse and the Narrows at Errol's cabin.
 */
export function resolveAnchors(
  markers: ExtractedMarker[],
  locations: Pick<Location, 'id' | 'wiki_page'>[],
  aliases: MarkerAlias[],
): AnchorResult {
  const normalise = (value: string | null): string =>
    (value ?? '').replace(/_/g, ' ').trim().toLowerCase()

  const byPage = new Map(locations.map((l) => [normalise(l.wiki_page), l.id]))
  const byMarkerName = new Map(aliases.map((a) => [a.marker, a.location_id]))
  const known = new Set(locations.map((l) => l.id))

  for (const alias of aliases) {
    if (!known.has(alias.location_id)) {
      throw new Error(
        `curated/aliases/map_markers.json points "${alias.marker}" at "${alias.location_id}", ` +
          'which is not a location.',
      )
    }
  }

  const anchors = new Map<string, { x: number; y: number }>()
  const unmatched: ExtractedMarker[] = []

  for (const marker of markers) {
    const id =
      byMarkerName.get(marker.name) ??
      (marker.section === null ? byPage.get(normalise(marker.article)) : undefined)

    if (id === undefined) {
      // A marker pointing *into* a page is a landmark, and `resolveSpots` will
      // take it. Only a marker that matches nothing at all is unmatched.
      if (marker.section === null) unmatched.push(marker)
      continue
    }
    // First writer wins, and markers arrive sorted, so the result does not
    // depend on iteration order.
    if (!anchors.has(id)) anchors.set(id, { x: marker.x, y: marker.y })
  }

  return { anchors, unmatched }
}

/** Marker names already consumed as a location's anchor, so they are not also spots. */
export function anchoredMarkerNames(aliases: MarkerAlias[]): Set<string> {
  return new Set(aliases.map((a) => a.marker))
}

export interface SpotResult {
  spots: Spot[]
  /** Landmarks whose containing region no source states. */
  unplaced: ExtractedMarker[]
}

/**
 * Which region's footprint a point falls inside.
 *
 * **This is containment, not proximity, and the distinction is the whole
 * reason it is allowed.** An earlier pass refused to place these landmarks
 * because only region *centres* were known, and "nearest centre" is an
 * inference: the Chicken Statue is not in Sweetwater Farm because Sweetwater's
 * marker happens to be closest. Now that each region's footprint is measured,
 * the test is whether the statue's published coordinate lies on Sweetwater's
 * published tiles — two sourced facts meeting, with nothing guessed in between.
 *
 * Null when a point lands on no region at all, which stays a gap. Regions do not
 * overlap, so a point is in one or in none.
 */
export function regionContaining(
  x: number,
  y: number,
  regions: { id: string; shape: { cell: number; runs: [number, number, number][] } }[],
): string | null {
  for (const region of regions) {
    const { cell, runs } = region.shape
    const col = Math.floor(x / cell)
    const row = Math.floor(y / cell)
    for (const [runRow, runCol, length] of runs) {
      if (runRow === row && col >= runCol && col < runCol + length) return region.id
    }
  }
  return null
}

/**
 * Landmarks become spots, but only where the source says which region holds
 * them.
 *
 * A marker linking to `The_Beach#The_Lighthouse` states its own containment:
 * the lighthouse is on the beach, because the wiki says the lighthouse is a
 * section of the beach's page. A marker linking to `Chicken Statue` states
 * nothing — that is its own page — and the seven quest markers link nowhere at
 * all. Those are returned unplaced rather than assigned to whichever region
 * marker happens to be closest.
 */
export function resolveSpots(
  markers: ExtractedMarker[],
  locations: Pick<Location, 'id' | 'wiki_page'>[],
  toId: (name: string) => string,
  alreadyAnchored: Set<string> = new Set(),
  /** Region footprints, for markers whose article does not name their region. */
  footprints: { id: string; shape: { cell: number; runs: [number, number, number][] } }[] = [],
): SpotResult {
  const normalise = (value: string | null): string =>
    (value ?? '').replace(/_/g, ' ').trim().toLowerCase()
  const byPage = new Map(locations.map((l) => [normalise(l.wiki_page), l.id]))
  const isLocation = new Set(byPage.values())

  const spots: Spot[] = []
  const unplaced: ExtractedMarker[] = []

  for (const marker of markers) {
    // A marker that already gave a location its anchor is that location, not a
    // landmark inside it — the Gazebo stands in for the Manor's Gardens.
    if (alreadyAnchored.has(marker.name)) continue

    const kind = SPOT_KINDS[marker.group] ?? DEFAULT_SPOT_KIND

    // A marker that anchors a location of its own is that location, not a
    // landmark inside one.
    const own = marker.section === null ? byPage.get(normalise(marker.article)) : undefined
    if (own !== undefined && isLocation.has(own)) continue

    // Stated containment first: a marker pointing *into* a location's page —
    // `The_Beach#The_Lighthouse` — says which region holds it in so many words.
    // Falling back to geometry only when nothing says it keeps the wiki's own
    // words ahead of our measurement wherever both exist.
    const locationId =
      (marker.section === null ? undefined : byPage.get(normalise(marker.article))) ??
      regionContaining(marker.x, marker.y, footprints) ??
      undefined

    if (locationId === undefined) {
      unplaced.push(marker)
      continue
    }

    spots.push({
      id: toId(marker.name),
      location_id: locationId,
      x: marker.x,
      y: marker.y,
      kind,
      seasons: [],
      map_version: 1,
    })
  }

  spots.sort((a, b) => a.id.localeCompare(b.id))
  return { spots, unplaced }
}
