import { z } from 'zod'
import { AvailabilityWindow } from '../availability.js'
import { withEnvelope } from '../envelope.js'
import { IdRef } from '../ids.js'
import { ItemCategory, MuseumWing, Quality, Rarity, SpawnMethod } from '../primitives.js'

/**
 * The canonical record for anything that can sit in the player's inventory.
 *
 * There is **one** items table. Category-specific data lives in facet records
 * that reference an item by id, and the per-category files the app downloads are
 * build-time projections of (item ∪ facet). Duplicating full records into
 * `fish.json` would guarantee the classic bug where Rainbow Trout exists twice
 * and the two copies disagree.
 */
export const Item = withEnvelope({
  category: ItemCategory,
  subcategory: z.string().nullable().default(null),

  /**
   * Quality variants ("Perfect Ruby", "Golden Milk") are separate item records
   * linked back to their base, because the wiki, the gift lists and the museum
   * all treat them as distinct things. Modelling them as a map on the base item
   * would force a special case into every id reference in the dataset.
   */
  base_item_id: IdRef.nullable().default(null),
  quality: Quality.nullable().default(null),

  sell_value: z.number().int().nullable().default(null),
  buy_value: z.number().int().nullable().default(null),

  stamina: z.number().int().nullable().default(null),
  health: z.number().int().nullable().default(null),
  mana: z.number().int().nullable().default(null),

  is_consumable: z.boolean().nullable().default(null),
  is_craftable: z.boolean().nullable().default(null),
  is_buyable: z.boolean().nullable().default(null),
  is_giftable: z.boolean().nullable().default(null),

  tags: z.array(z.string()).default([]),

  museum: z
    .object({
      donatable: z.boolean(),
      set_id: IdRef.nullable().default(null),
      wing: MuseumWing.nullable().default(null),
      donation_points: z.number().int().nullable().default(null),
    })
    .nullable()
    .default(null),

  /** How to get it. An OR of windows — see AvailabilityWindow. */
  availability: z.array(AvailabilityWindow).default([]),

  /** Derived at build time from the recipe graph. */
  used_in_recipe_ids: z.array(IdRef).default([]),
  /** Derived at build time from shop stock. */
  sold_by: z.array(IdRef).default([]),

  /**
   * Colour/style variants collapsed into this record — the game's own item
   * ids for each colourway of one product (fifteen "Basic Wood Chest"
   * chests share a `recipe_key` and one record). Absent everywhere else.
   */
  variant_ids: z.array(z.string()).optional(),
  /**
   * Set when the collapsed variants craft from *different* ingredients (each
   * paving-stone colour needs its own dye). The record carries the base
   * variant's recipe; this flag is what lets the UI say so.
   */
  variant_recipes_differ: z.literal(true).optional(),

  /**
   * Cosmetics only: how many colours it comes in. Unlike furniture these are
   * palette swaps of one wardrobe entry, not separate records — so this is a
   * count, and there is nothing to link to.
   */
  variant_count: z.number().int().min(2).optional(),
  /** Cosmetics only: the body slot it occupies — `hair`, `head_gear`, `feet`. */
  worn_on: z.string().optional(),
  /** Cosmetics only: you start with it, so nothing sells it and it costs nothing. */
  default_unlocked: z.literal(true).optional(),
})
export type Item = z.infer<typeof Item>

/**
 * Facets carry the fields that only make sense for one category. They are keyed
 * on `item_id` and validated for referential integrity against `items.json`.
 */
const facet = <T extends z.ZodRawShape>(shape: T) => z.object({ item_id: IdRef, ...shape })

export const FishFacet = facet({
  shadow_size: z.enum(['small', 'medium', 'large', 'giant']).nullable().default(null),
  catch_methods: z.array(SpawnMethod).default([]),
  is_legendary: z.boolean().default(false),
  school_size: z
    .object({ min: z.number().int().min(1), max: z.number().int().min(1) })
    .nullable()
    .default(null),
  rarity: Rarity.nullable().default(null),
})
export type FishFacet = z.infer<typeof FishFacet>

export const BugFacet = facet({
  spawn_surface: z
    .enum(['grass', 'rock', 'tree', 'ground', 'water', 'air'])
    .nullable()
    .default(null),
  /** The game's own spawn-condition label, kept verbatim as a key for cross-checking. */
  spawn_condition_key: z.string().nullable().default(null),
  rarity: Rarity.nullable().default(null),
})
export type BugFacet = z.infer<typeof BugFacet>

export const ForageableFacet = facet({
  respawn_days: z.number().int().nullable().default(null),
  spawns_on: z
    .enum(['dirt_patch', 'beach', 'tree', 'bush', 'floor', 'grass', 'water'])
    .nullable()
    .default(null),
  yields_seed_item_id: IdRef.nullable().default(null),
})
export type ForageableFacet = z.infer<typeof ForageableFacet>

export const ArtifactFacet = facet({
  /**
   * How the game hands this artifact out. `fishing`, `fish_trap` and
   * `mist_spot` were added when the game's own pool tables landed — the wiki
   * never distinguished them.
   */
  dig_source: z
    .enum([
      'dig_spot',
      'rock',
      'floor_range',
      'diving',
      'panning',
      'fishing',
      'fish_trap',
      'mist_spot',
    ])
    .nullable()
    .default(null),
  biome_id: IdRef.nullable().default(null),
  rarity: Rarity.nullable().default(null),
})
export type ArtifactFacet = z.infer<typeof ArtifactFacet>
