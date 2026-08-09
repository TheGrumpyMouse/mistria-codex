import { z } from 'zod'
import { Requirement } from '../availability.js'
import { withEnvelope } from '../envelope.js'
import { IdRef } from '../ids.js'
import { Confidence, Currency, Quality, Rarity, Season } from '../primitives.js'

export const Crop = withEnvelope({
  seed_item_id: IdRef.nullable().default(null),
  produce_item_id: IdRef.nullable().default(null),
  growth_days: z.number().int().nullable().default(null),
  /** Null means it does not regrow — a single harvest. */
  regrow_days: z.number().int().nullable().default(null),
  seasons: z.array(Season).default([]),
  is_trellis: z.boolean().nullable().default(null),
  yield: z.object({ min: z.number().int(), max: z.number().int() }).nullable().default(null),
  quality_enabled: z.boolean().nullable().default(null),
  greenhouse_ok: z.boolean().nullable().default(null),
  seed_sources: z.array(IdRef).default([]),
})
export type Crop = z.infer<typeof Crop>

/**
 * An ingredient slot. Either a specific item, or a tag ("any fish") where the
 * game accepts a category — never both.
 */
export const RecipeIngredient = z
  .object({
    item_id: IdRef.nullable().default(null),
    tag: z.string().nullable().default(null),
    quantity: z.number().int().min(1).default(1),
  })
  .refine((i) => (i.item_id === null) !== (i.tag === null), {
    message: 'an ingredient must specify exactly one of item_id or tag',
  })
export type RecipeIngredient = z.infer<typeof RecipeIngredient>

/**
 * One way a recipe becomes known.
 *
 * The game states nearly all of these through a single token — `recipe_scroll`,
 * which appears in the store tables, the letters, the quest rewards, the
 * festival stalls, the Wishing Well pool and the Chicken Statue pool. Reading
 * that token is what turned 163 records that all claimed "shop" into 435 that
 * name where they actually come from.
 *
 * `skill_level` is the one **inferred** method. Every `recipe_scroll` in the
 * game files is collected, so a recipe with no grant anywhere and a stated
 * crafting level is gated by that level and nothing else — a structural
 * deduction, not a stated fact, which is why it carries
 * `confidence: 'inferred'` and must never render like the others.
 */
export const RecipeSource = z.object({
  method: z.enum([
    /** `recipe_is_default` — yours from the first day. */
    'default',
    /** A store sells the scroll, or sells a dish that teaches it. */
    'shop',
    'mail',
    'quest',
    'festival',
    'wishing_well',
    'chicken_statue',
    /** Treasure chests in a named mine, behind the Taste Maker perk. */
    'mines_chest',
    'cutscene',
    /** Inferred: no grant exists anywhere, and the level is the only gate. */
    'skill_level',
  ]),
  /**
   * A shop, quest, festival or mine id — **which one depends on `method`**, so
   * refint checks it per method rather than against a single table. Null where
   * the join was genuinely ambiguous, which is honest and is counted.
   */
  source_id: IdRef.nullable().default(null),
  /** The letter's sender, or the quest's giver. */
  character_id: IdRef.nullable().default(null),
  /** What the scroll costs, where a source states it. Never the dish's price. */
  price: z.number().int().nullable().default(null),
  currency: Currency.default('tesserae'),
  requires: z.array(Requirement).default([]),
  confidence: Confidence,
})
export type RecipeSource = z.infer<typeof RecipeSource>

export const Recipe = withEnvelope({
  kind: z.enum(['cooking', 'crafting', 'blacksmithing', 'woodcrafting']),
  output: z.object({ item_id: IdRef, quantity: z.number().int().min(1).default(1) }),
  ingredients: z.array(RecipeIngredient).default([]),

  station: z.string().nullable().default(null),
  station_level: z.number().int().nullable().default(null),
  skill: z
    .object({ id: IdRef, level: z.number().int().min(0).max(60) })
    .nullable()
    .default(null),
  craft_minutes: z.number().int().nullable().default(null),

  /**
   * How the recipe is **learned** — which is a different question from how the
   * thing it makes is obtained, and the one the app could not answer at all.
   *
   * A list, not a single value: the Wishing Well and the Inn both hand out the
   * Spicy Cheddar Biscuit, and collapsing two sources into one would pick a
   * winner arbitrarily. Empty plus `sources` in `data_gaps[]` is the honest
   * "we do not know" — see `RecipeSource` for what each method means.
   */
  sources: z.array(RecipeSource).default([]),

  effects: z
    .object({
      health: z.number().int().nullable().default(null),
      stamina: z.number().int().nullable().default(null),
      mana: z.number().int().nullable().default(null),
      buffs: z.array(z.string()).default([]),
    })
    .nullable()
    .default(null),
})
export type Recipe = z.infer<typeof Recipe>

export const Animal = withEnvelope({
  building: z.enum(['coop', 'barn']),
  matures_days: z.number().int().nullable().default(null),
  products: z
    .array(
      z.object({
        item_id: IdRef,
        hearts_required: z.number().int().min(0).max(10).nullable().default(null),
        quality: Quality.nullable().default(null),
      }),
    )
    .default([]),
  breeding: z
    .object({
      treat_item_id: IdRef.nullable().default(null),
      gestation_days: z.number().int().nullable().default(null),
    })
    .nullable()
    .default(null),
  feed_item_ids: z.array(IdRef).default([]),
  purchase: z
    .object({ price: z.number().int(), currency: Currency.default('tesserae'), shop_id: IdRef })
    .nullable()
    .default(null),
})
export type Animal = z.infer<typeof Animal>

/**
 * A production machine — the Apiary and the Terrarium at 1.0.
 *
 * The machine itself is an *item* (craftable, placeable on the farm); this
 * record carries what the item record cannot: the input -> output rules the
 * game states in the object prototype's `factory` table. Everything here is
 * resolved item ids — the app never sees the game's internal tags.
 */
export const Machine = withEnvelope({
  /** The item record this machine is crafted and placed as. */
  item_id: IdRef,
  days_to_produce: z.number().int().nullable().default(null),
  /** How many inputs it holds at once. */
  capacity: z.number().int().nullable().default(null),
  /** Item ids the machine accepts as working inputs (bees, bugs). */
  accepts_item_ids: z.array(IdRef).default([]),
  /** What each input rarity yields. One entry per rarity the game maps. */
  yields: z
    .array(
      z.object({
        input_rarity: Rarity,
        item_ids: z.array(IdRef).default([]),
      }),
    )
    .default([]),
  /**
   * Items the machine asks for, season by season — the apiary requesting
   * spring flowers. A request is flavour-plus-bonus, not a requirement to run.
   */
  requests: z
    .array(
      z.object({
        item_id: IdRef,
        season: Season.nullable().default(null),
        requires: z.array(Requirement).default([]),
      }),
    )
    .default([]),
})
export type Machine = z.infer<typeof Machine>

export const Building = withEnvelope({
  kind: z.enum([
    'coop',
    'barn',
    'greenhouse',
    'kitchen',
    'crafting_station',
    'mill',
    'home_upgrade',
    'farm_expansion',
    'other',
  ]),
  tiers: z
    .array(
      z.object({
        level: z.number().int().min(1),
        cost: z.object({
          tesserae: z.number().int().nullable().default(null),
          materials: z
            .array(z.object({ item_id: IdRef, quantity: z.number().int().min(1) }))
            .default([]),
        }),
        capacity: z.number().int().nullable().default(null),
        requires: z.array(Requirement).default([]),
      }),
    )
    .default([]),
  vendor_shop_id: IdRef.nullable().default(null),
  placeable_on_farm: z.boolean().nullable().default(null),
})
export type Building = z.infer<typeof Building>
