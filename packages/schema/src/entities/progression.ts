import { z } from 'zod'
import { GameDate, Requirement } from '../availability.js'
import { withEnvelope } from '../envelope.js'
import { IdRef } from '../ids.js'
import { Currency, DayOfWeek, MuseumWing, Season } from '../primitives.js'
import { TimeOfDay } from '../time.js'

/**
 * A museum donation set.
 *
 * `required_count` is per-set data, not a constant — the Legendary Fish Set has
 * four items, not five. Validation asserts `item_ids.length === required_count`
 * and that every donatable item belongs to exactly one set, which turns museum
 * curation from a vague chore into a burn-down list.
 */
export const MuseumSet = withEnvelope({
  wing: MuseumWing,
  item_ids: z.array(IdRef).default([]),
  required_count: z.number().int().min(1),
  reward: z
    .object({
      tesserae: z.number().int().nullable().default(null),
      renown: z.number().int().nullable().default(null),
      item_ids: z.array(IdRef).default([]),
    })
    .nullable()
    .default(null),
  unlock_requires: z.array(Requirement).default([]),
  display_order: z.number().int().nullable().default(null),
})
export type MuseumSet = z.infer<typeof MuseumSet>

export const Festival = withEnvelope({
  date: GameDate,

  /**
   * Whether the festival actually fires in game.
   *
   * The wiki lists ten and marks six of them as unimplemented — they exist in
   * the game files but nothing happens on the day. Dropping those rows would
   * make it look like nobody had checked, and treating them as real would have
   * the Today view promise a festival on Fall 28 that never arrives. Both are
   * worse than carrying the flag.
   */
  implemented: z.boolean().default(true),
  location_id: IdRef.nullable().default(null),
  time: z.object({ from: TimeOfDay, to: TimeOfDay }).nullable().default(null),
  /** Breath of Spring, Queen Berries — festival-scoped currencies. */
  currency_item_id: IdRef.nullable().default(null),
  activities: z.array(z.string()).default([]),
  rewards: z.array(IdRef).default([]),
  prerequisites: z.array(Requirement).default([]),
})
export type Festival = z.infer<typeof Festival>

export const Quest = withEnvelope({
  /**
   * `festival` and `important` were added when the Quests page turned out to
   * have sections for both — festival lead-ins that fire every year, and a
   * handful of one-off quests the wiki calls useful but not plot-critical.
   * Folding them into `story` would have made two different things look alike.
   */
  kind: z.enum([
    'story',
    'festival',
    'important',
    'crown',
    'cooking_challenge',
    'heart',
    'mission',
    'request',
  ]),
  giver_character_id: IdRef.nullable().default(null),
  prerequisites: z.array(Requirement).default([]),
  objectives: z
    .array(
      z.object({
        type: z.string(),
        target_id: IdRef.nullable().default(null),
        quantity: z.number().int().nullable().default(null),
      }),
    )
    .default([]),
  rewards: z
    .object({
      renown: z.number().int().nullable().default(null),
      tesserae: z.number().int().nullable().default(null),
      item_ids: z.array(IdRef).default([]),
    })
    .nullable()
    .default(null),
  repeatable: z.boolean().default(false),
  season_restriction: z.array(Season).nullable().default(null),
})
export type Quest = z.infer<typeof Quest>

export const Shop = withEnvelope({
  location_id: IdRef.nullable().default(null),
  owner_character_id: IdRef.nullable().default(null),

  /**
   * Everyone the wiki says runs the place.
   *
   * Three shops are run jointly — Nora and Holt have the General Store between
   * them — so a single `owner_character_id` would have to pick one and be
   * wrong. It stays null where there is no sole proprietor, and this carries the
   * answer a player actually wants: who is behind the counter.
   */
  staff_character_ids: z.array(IdRef).default([]),

  /**
   * Opening hours, if a shop ever has any.
   *
   * Empty means **no restriction**, not unknown: Fields of Mistria's shops never
   * close, and you can buy until 2am when the day ends. None of the eight store
   * pages mentions hours because there are none to mention. See
   * `curated/vocab/method_rules.json` for the same fact on the time axis.
   */
  hours: z
    .array(z.object({ days: z.array(DayOfWeek).default([]), from: TimeOfDay, to: TimeOfDay }))
    .default([]),
  seasonal_closures: z.array(Season).default([]),
  stock: z
    .array(
      z.object({
        item_id: IdRef,
        price: z.number().int().nullable().default(null),
        currency: Currency.default('tesserae'),
        requires: z.array(Requirement).default([]),
        /**
         * Seasons this line is stocked in. `null` is year-round, not unknown —
         * only the General Store's seed tables are season-gated, and its page
         * says so in the heading.
         */
        seasons: z.array(Season).nullable().default(null),
        /** Rotating stock (Balor's Wagon, Saturday Market) rather than always available. */
        rotation: z.boolean().default(false),
      }),
    )
    .default([]),
})
export type Shop = z.infer<typeof Shop>

export const Skill = withEnvelope({
  max_level: z.number().int().default(60),
  /** Cumulative XP per level, index 0 = level 1. Null until sourced from game files. */
  xp_curve: z.array(z.number().int()).nullable().default(null),
  perks: z
    .array(
      z.object({
        id: IdRef,
        name: z.string(),
        tier: z.number().int().nullable().default(null),
        level: z.number().int().nullable().default(null),
        essence_cost: z.number().int().nullable().default(null),
        effect_key: z.string().nullable().default(null),
        /** Which statue grants it — Caldarus' for most, the Mines dragon for mining/combat. */
        statue: z.enum(['caldarus', 'mines']).nullable().default(null),
      }),
    )
    .default([]),
})
export type Skill = z.infer<typeof Skill>
