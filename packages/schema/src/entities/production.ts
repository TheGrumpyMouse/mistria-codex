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
  /**
   * Which stall at the festival, for `method: 'festival'` only — the game's
   * own stall key from `festivals.toml [<festival>.stocks]`
   * (`nora_souvenir_stall`), preserved because "which stall" is the part of
   * the answer a player walks to. Named `_key`, not `_id`: stalls are not
   * records anywhere, so there is nothing for refint to resolve. An internal
   * token — the UI labels it or falls back to the festival alone, never
   * renders it raw.
   */
  stall_key: z.string().nullable().default(null),
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
  size: z.enum(['small', 'large']).nullable().default(null),
  matures_days: z.number().int().nullable().default(null),
  products: z
    .array(
      z.object({
        item_id: IdRef,
        /** Which sex produces it. Null means both — a fact, not a gap. */
        sex: z.enum(['male', 'female']).nullable().default(null),
        days_to_produce: z.number().int().nullable().default(null),
        hearts_required: z.number().int().min(0).max(10).nullable().default(null),
        quality: Quality.nullable().default(null),
      }),
    )
    .default([]),
  breeding: z
    .object({
      treat_item_id: IdRef.nullable().default(null),
      /** Wiki-stated for mammals; the game files state no gestation length. */
      gestation_days: z.number().int().nullable().default(null),
      uses_egg: z.boolean().nullable().default(null),
      /** Egg layers only. Null on mammals is *not applicable*, not unknown. */
      incubation_days: z.number().int().nullable().default(null),
    })
    .nullable()
    .default(null),
  feed_item_ids: z.array(IdRef).default([]),
  purchase: z
    .object({
      price: z.number().int(),
      currency: Currency.default('tesserae'),
      shop_id: IdRef,
      requires: z.array(Requirement).default([]),
      /**
       * The earliest in-game date the animal appears for sale, where the game
       * gates one (alpaca and capybara arrive Winter 1 of year 1). A typed
       * field rather than a Requirement: a season/day/year triple does not fit
       * `Requirement.value` honestly.
       */
      available_from: z
        .object({ season: Season, day: z.number().int(), year: z.number().int() })
        .nullable()
        .default(null),
    })
    .nullable()
    .default(null),
  /**
   * Sale prices, straight from the game's pricing table. `adult_by_heart` is
   * indexed by heart level (0–10); `tier_multipliers` is indexed by variant
   * tier and carried raw — its exact index semantics are unverified, so the
   * UI must not multiply the two until they are.
   */
  sell: z
    .object({
      baby: z.number().int().nullable().default(null),
      adult_by_heart: z.array(z.number().int()).default([]),
      tier_multipliers: z.array(z.number()).default([]),
    })
    .nullable()
    .default(null),
  /**
   * Colour and seasonal breeds. `key` is the game's variant token — never
   * rendered raw. `purchasable` is the game's `default_unlocked`: buyable at
   * Hayden's without breeding it first.
   */
  variants: z
    .array(
      z.object({
        key: z.string(),
        name: z.string().nullable().default(null),
        tier: z.number().int().min(1).max(6),
        born_in: z.array(Season).default([]),
        purchasable: z.boolean(),
        acquirable: z.boolean(),
        renown_value: z.number().int().nullable().default(null),
        /** The accessory the variant is born wearing, as an item record. */
        default_cosmetic_item_id: IdRef.nullable().default(null),
        /**
         * `animal/<id>_<key>` — the variant's own swatch, a dedicated install
         * sprite or the base icon repainted through the game's own palette
         * strip (`lut` + `lut_index`). The key ships even before the art
         * exists, so asset coverage can report the gap; a missing sprite
         * draws the ordinary glyph.
         */
        icon_key: z.string().nullable().default(null),
      }),
    )
    .default([]),
  is_mount: z.boolean().nullable().default(null),
  petting: z
    .object({
      kind: z.enum(['pet', 'pick_up']),
      essence_points: z.number().int().nullable().default(null),
      stamina_cost: z.number().int().nullable().default(null),
    })
    .nullable()
    .default(null),
  eats: z.enum(['seed', 'hay']).nullable().default(null),
})
export type Animal = z.infer<typeof Animal>

/**
 * A pet kind — cat, dog, and the fourteen monster-shaped companions.
 *
 * Pets are not ranch animals: no produce, no purchase, one shared set of jobs
 * (on the `ranching` rules record). A record is the *kind*; the colourways the
 * player chooses between are `variants`. The game states no display name for a
 * kind, only for variants, so kind names are curated.
 */
export const Pet = withEnvelope({
  /** The game's `pet_kind` token — never rendered raw. */
  kind_key: z.string(),
  variants: z
    .array(
      z.object({
        key: z.string(),
        name: z.string().nullable().default(null),
        /** `pet/<kind>_<key>` — same contract as the animal variant swatch. */
        icon_key: z.string().nullable().default(null),
      }),
    )
    .default([]),
})
export type Pet = z.infer<typeof Pet>

/**
 * The ranching rulebook — one singleton record (`ranching_rules`).
 *
 * Global tables that belong to no single animal: how heart points accrue, what
 * each heart level does to production, festival scoring, and the pet jobs
 * every pet shares. A dataset of one record keeps the registry machinery
 * (zod, ajv, determinism, ship) working with zero special cases.
 */
export const RanchingRules = withEnvelope({
  min_hearts_to_breed: z.number().int().nullable().default(null),
  /** Cumulative points to reach heart 1..10, in order. */
  heart_point_table: z.array(z.number().int()).default([]),
  /** Production rolls at each heart threshold, verbatim from the game. */
  production_tiers: z
    .array(
      z.object({
        hearts_required: z.number().int(),
        normal: z.object({ count: z.number().int(), additional_chance: z.number() }),
        golden: z.object({ count: z.number().int(), additional_chance: z.number() }),
      }),
    )
    .default([]),
  /** Heart points per action. Feed bonuses stack on the base `feed` value. */
  heart_actions: z
    .object({
      pet: z.number().int().nullable().default(null),
      feed: z.number().int().nullable().default(null),
      go_outside: z.number().int().nullable().default(null),
      left_outside_penalty: z.number().int().nullable().default(null),
      feed_bonus: z
        .object({
          normal: z.number().int().nullable().default(null),
          quality: z.number().int().nullable().default(null),
          deluxe: z.number().int().nullable().default(null),
          ultimate: z.number().int().nullable().default(null),
        })
        .nullable()
        .default(null),
      crop_bonus: z.number().int().nullable().default(null),
      /** Bonus per star of a cooked dish used as feed, index 0 = 1 star. */
      cooked_star_bonuses: z.array(z.number().int()).default([]),
      child_born: z.number().int().nullable().default(null),
      toy: z.number().int().nullable().default(null),
    })
    .nullable()
    .default(null),
  /**
   * Animal Festival entry scoring. Two point tables the game sums: one by
   * variant tier, one by heart level. Carried raw — `heart_points` has ten
   * entries against eleven heart levels, and until that indexing is verified
   * the UI renders the tables without computing a total.
   */
  festival_scoring: z
    .object({
      tier_points: z.array(z.number().int()).default([]),
      heart_points: z.array(z.number().int()).default([]),
    })
    .nullable()
    .default(null),
  /** The three jobs every pet shares, rewards indexed by pet heart level 0–10. */
  pet_jobs: z
    .array(
      z.object({
        job: z.enum(['wood', 'stone', 'forageables']),
        location_id: IdRef.nullable().default(null),
        reward_item_id: IdRef.nullable().default(null),
        /** True when the reward is the game's pooled forage roll, not one item. */
        reward_custom: z.boolean().default(false),
        reward_by_heart: z.array(z.tuple([z.number().int(), z.number().int()])).default([]),
      }),
    )
    .default([]),
})
export type RanchingRules = z.infer<typeof RanchingRules>

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
        /** Egg slots, for coops. Barns state 0 — a fact, not a gap. */
        incubators: z.number().int().nullable().default(null),
        requires: z.array(Requirement).default([]),
      }),
    )
    .default([]),
  /** Which animal size the building houses — coops small, barns large. */
  animal_size: z.enum(['small', 'large']).nullable().default(null),
  vendor_shop_id: IdRef.nullable().default(null),
  placeable_on_farm: z.boolean().nullable().default(null),
})
export type Building = z.infer<typeof Building>
