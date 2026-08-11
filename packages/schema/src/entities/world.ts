import { z } from 'zod'
import { Requirement } from '../availability.js'
import { withEnvelope } from '../envelope.js'
import { IdRef } from '../ids.js'
import { Habitat, LocationKind, Season } from '../primitives.js'

/**
 * A point in a map's coordinate space.
 *
 * **All coordinates are SVG user units in the owning map's `viewBox`. Never
 * pixels.** Validation asserts every anchor falls inside its map, which catches
 * the whole class of "redrew the region, every pin silently moved" bugs.
 */
export const Point = z.object({ x: z.number(), y: z.number() })
export type Point = z.infer<typeof Point>

/**
 * A specific place on a map — what a pin needs.
 *
 * Distinct from a Habitat, which is a *class* of place ("Pond") and is what the
 * wiki and the player actually say. The wiki gives habitats; the map needs
 * locations; `curated/aliases/location_aliases.json` records the expansion and
 * marks it inferred.
 */
export const Location = withEnvelope({
  kind: LocationKind,

  /**
   * Null until the region has been drawn. Locations are real records long before
   * their maps exist, and the alternative — a placeholder coordinate — would be
   * inventing data that looks exactly like the real thing.
   */
  map_id: IdRef.nullable().default(null),
  parent_id: IdRef.nullable().default(null),
  habitats: z.array(Habitat).default([]),

  /**
   * Default pin position for anything found here with no finer spot.
   * Null while the map is undrawn; the record carries `data_gaps: ["anchor"]`.
   */
  anchor: Point.nullable().default(null),
  /**
   * The region's footprint on its map, for highlighting rather than pinning.
   *
   * `cells` is a mosaic: the region quantised to a square grid, run-length
   * encoded as `[row, firstColumn, length]`. Two reasons it beats an outline.
   * It is **tiny** — nine regions come to under 3KB, where a traced polygon of
   * the same fidelity is an order of magnitude more — and it is **honest about
   * its own precision**: a cell is visibly a cell, so nobody reads a
   * hand-measured footprint as a surveyed border.
   *
   * It is also the shape the rest of this app already speaks. The currency is
   * tesserae and the Day Dial is a grid of them; a mosaic map is the same idea
   * at a different scale rather than a second visual language.
   */
  shape: z
    .discriminatedUnion('type', [
      z.object({
        type: z.literal('polygon'),
        points: z.array(z.tuple([z.number(), z.number()])),
      }),
      z.object({
        type: z.literal('cells'),
        /** Cell edge in map units. Grid origin is the map's own 0,0. */
        cell: z.number().int().positive(),
        /** `[row, firstColumn, length]`, sorted, non-overlapping. */
        runs: z.array(z.tuple([z.number().int(), z.number().int(), z.number().int()])),
      }),
    ])
    .nullable()
    .default(null),

  connections: z.array(IdRef).default([]),
  unlock_requires: z.array(Requirement).default([]),

  /** Spellings seen in the wild, used by the token resolver. */
  aliases: z.array(z.string()).default([]),
})
export type Location = z.infer<typeof Location>

/**
 * A map: a coordinate space, and how it is drawn.
 *
 * **The art is not a file.** Regions carry a `cells` footprint and the app
 * draws the mosaic from it, which means the map can be recoloured, highlighted
 * per region and made interactive without anyone touching an asset. `svg` is
 * kept for a region that one day wants hand-drawn detail, and is null until
 * then — a path pointing at a file that does not exist is worse than an
 * admitted absence.
 *
 * The game's own map image is never committed. It is fetched to the HTTP cache,
 * measured, and discarded; the measurements are facts and are what we keep.
 */
export const MapRegion = withEnvelope({
  /** Path relative to `curated/maps/`, when there is hand-drawn art. */
  svg: z.string().min(1).nullable().default(null),
  view_box: z.string().regex(/^-?\d+(?:\.\d+)? -?\d+(?:\.\d+)? \d+(?:\.\d+)? \d+(?:\.\d+)?$/),

  /**
   * Bumped whenever the art is redrawn. Pins record the version they were
   * authored against and CI fails on a mismatch, because a redraw otherwise
   * relocates every pin silently.
   *
   * Never change a published `viewBox` — only extend it, and bump this.
   */
  map_version: z.number().int().min(1).default(1),
  layers: z.array(z.string()).default([]),
  /** Stylised and not to scale. The UI says so. */
  not_to_scale: z.boolean().default(true),
})
export type MapRegion = z.infer<typeof MapRegion>

/** Finer than a location: a single dig spot, dive hole, or forage patch. */
export const Spot = z.object({
  id: IdRef,
  location_id: IdRef,
  x: z.number(),
  y: z.number(),
  kind: z.enum(['dig_spot', 'dive_hole', 'forage_patch', 'rock', 'tree', 'water', 'entrance']),
  seasons: z.array(Season).default([]),
  map_version: z.number().int().min(1).default(1),
})
export type Spot = z.infer<typeof Spot>

export const MineBiome = withEnvelope({
  floors: z.object({ min: z.number().int(), max: z.number().int() }),
  ore_item_ids: z.array(IdRef).default([]),
  monster_ids: z.array(IdRef).default([]),
  fish_item_ids: z.array(IdRef).default([]),
  artifact_set_ids: z.array(IdRef).default([]),
  hazards: z.array(z.string()).default([]),
  gate: z.array(Requirement).default([]),
  location_id: IdRef.nullable().default(null),
})
export type MineBiome = z.infer<typeof MineBiome>

/**
 * A story seal: the barrier, the quest that breaks it, and what breaking it
 * costs.
 *
 * The game models a seal as a quest whose stage demands a delivery of items
 * (`supplied_items` in the quest files), so the item list here is stated, not
 * curated. `unlocks_mine_id` / `unlocks_location_id` are derived by joining the
 * quest against mine gates and location `unlock_requires` — a seal can open
 * either, and the final seal opens neither (it ends the story).
 */
export const Seal = withEnvelope({
  quest_id: IdRef,
  required_items: z
    .array(z.object({ item_id: IdRef, quantity: z.number().int().min(1) }))
    .default([]),
  unlocks_mine_id: IdRef.nullable().default(null),
  unlocks_location_id: IdRef.nullable().default(null),
})
export type Seal = z.infer<typeof Seal>

const MonsterDrop = z.object({
  item_id: IdRef,
  chance: z.number().min(0).max(1).nullable().default(null),
  quantity: z.object({ min: z.number().int(), max: z.number().int() }).nullable().default(null),
  /**
   * The perk that must be active before this line can drop at all — the
   * pet skins behind Friend-Shaped. Stated by the game (`MonsterUtils.gml`
   * checks the perk wherever an item carries `pet_skin_unlock`), so the UI
   * must badge it: a 5% chance that is 0% for most players is not a 5% chance.
   */
  requires_perk: z.string().nullable().default(null),
})

/**
 * `combat_xp` used to sit here, always null: the game has no combat-XP concept
 * to record. Its stats are `hp`, contact `damage`, the `essence` a kill pays,
 * and a coin range — all stated per variant in `fiddle/monsters/`.
 */
export const Monster = withEnvelope({
  biome_ids: z.array(IdRef).default([]),
  hp: z.number().int().nullable().default(null),
  damage: z.number().int().nullable().default(null),
  essence: z.number().int().nullable().default(null),
  coins: z.object({ min: z.number().int(), max: z.number().int() }).nullable().default(null),
  drops: z.array(MonsterDrop).default([]),
  /**
   * A second, separately-rolled loot list — the Rock Stack's guaranteed
   * diamonds for destroying it fully. Folding it into `drops` would state a
   * 100% diamond chance on an ordinary kill.
   */
  super_drops: z.array(MonsterDrop).default([]),
})
export type Monster = z.infer<typeof Monster>
