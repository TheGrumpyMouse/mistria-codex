import { z } from 'zod'
import { IdRef } from './ids.js'
import {
  Confidence,
  DAYS_PER_SEASON,
  DayOfWeek,
  Habitat,
  Precision,
  ProvenanceSource,
  Rarity,
  Season,
  SpawnMethod,
  TimeBlock,
  Weather,
} from './primitives.js'
import { TimeRange } from './time.js'

/**
 * A gate on content: a skill level, a perk, a completed quest, a built building.
 *
 * Authored in `curated/` as compact tokens (`skill:fishing>=30`) and parsed by
 * the build into this shape, so the client never string-parses. Results that
 * fail a gate are tagged `locked` and still shown — a player wants to know the
 * Legendary fish exists and why they can't catch it yet.
 */
export const Requirement = z.object({
  type: z.enum([
    'skill',
    'perk',
    'quest',
    'town_rank',
    'building',
    'tool',
    'hearts',
    'item',
    'season_unlocked',
    /** A place you must have reached — the Deep Woods, a mine biome. */
    'location',
    /** `year >= 2`. The request board holds some things back until year two. */
    'year',
  ]),
  key: z.string().min(1),
  op: z.enum(['>=', '>', '==', 'has', 'done']),
  value: z.union([z.number(), z.string()]).nullable().default(null),
})
export type Requirement = z.infer<typeof Requirement>

/** A specific calendar date, used for festivals and time-limited forageables. */
export const GameDate = z.object({
  season: Season,
  day: z.number().int().min(1).max(DAYS_PER_SEASON),
})
export type GameDate = z.infer<typeof GameDate>

/**
 * One way a thing can be obtained.
 *
 * **Each window is an AND of its constraints. An entity's `availability` array
 * is an OR of windows.** This is the load-bearing decision of the whole dataset:
 * a bug can be spring-in-town-at-night *and* all-season-in-the-mines-any-time,
 * and a single flat `{seasons, weather, time}` cannot express that. Collapsing
 * two windows into one produces wrong answers on the flagship screen.
 */
export const AvailabilityWindow = z.object({
  method: SpawnMethod,

  /**
   * The class of place, as the wiki and the player say it ("Pond").
   * Kept alongside `locations` so text can read "found in ponds" while the map
   * still has concrete pins.
   */
  habitats: z.array(Habitat).default([]),

  /**
   * Concrete places, for map pins. When these were derived by expanding a
   * habitat rather than stated by a source, the window carries
   * `confidence: "inferred"` and the UI must draw those pins hollow.
   */
  locations: z.array(IdRef).default([]),

  /** Finer than a location — a specific dig spot or dive hole. Overrides the pin. */
  spot_ids: z.array(IdRef).default([]),

  /**
   * Always fully expanded, never an `"all"` magic string. Matching becomes a set
   * intersection with zero special cases; forty bytes buys a total function.
   */
  seasons: z.array(Season).min(1),

  /**
   * `null` means **not applicable** — mines and interiors have no weather.
   * It does not mean unknown. Unknown is recorded as `data_gaps: ["weather"]`
   * on the record, so the matcher never has to guess which one a null is.
   */
  weather: z.array(Weather).nullable(),
  weather_precision: Precision,

  /**
   * Authored ranges, which may wrap midnight. The build splits them into
   * non-wrapping minute intervals before shipping.
   *
   * `null` means not applicable or unknown (see `time_precision` and the
   * record's `data_gaps`). A null here **does not exclude** the window from a
   * query — it matches every time and the result is badged "time unknown".
   * Excluding on unknown would quietly hide correct answers, which is worse
   * than showing an unverified one.
   */
  time: z.array(TimeRange).nullable(),

  /** Derived from `time` at build time. Never hand-authored — the two would drift. */
  time_blocks: z.array(TimeBlock).nullable().default(null),
  time_precision: Precision,

  /** Day-of-week gate: Saturday Market, Friday Night at the Inn, weekend dates. */
  days: z.array(DayOfWeek).nullable().default(null),

  /** Specific dates: festivals, and forageables that only appear in a date range. */
  dates: z.array(GameDate).nullable().default(null),

  /** Mine floor range. Lives on the window because the same fish is also in a river. */
  depth: z.object({ min: z.number().int(), max: z.number().int() }).nullable().default(null),

  /**
   * The mine biome this window sits in, when it sits in one.
   *
   * Derived at build time from the window's location, or failing that from the
   * floor range — never authored, because two copies of "floors 21-39 means the
   * Tide Caverns" would eventually disagree. It exists so the app can name the
   * biome without re-deriving a range comparison on every render, and so a
   * biome record is reachable from the items found in it.
   */
  biome_id: IdRef.nullable().default(null),

  /** Earliest in-game year this becomes obtainable. */
  min_year: z.number().int().min(1).nullable().default(null),

  rarity: Rarity.nullable().default(null),
  /** Drop chance 0..1 where a source states one. Never estimated. */
  chance: z.number().min(0).max(1).nullable().default(null),
  quantity: z
    .object({ min: z.number().int().min(1), max: z.number().int().min(1) })
    .nullable()
    .default(null),

  requires: z.array(Requirement).default([]),

  confidence: Confidence,
  prov: ProvenanceSource,
})
export type AvailabilityWindow = z.infer<typeof AvailabilityWindow>

// ---------------------------------------------------------------------------
// Shipped form
//
// `data/` keeps windows nested on the entity because that is what reviews well
// in a pull request. `public/data/availability.json` flattens them to one record
// per (entity x method x location) with bitmasks precomputed, because that is
// what the runtime query wants. The build owns the translation; neither shape is
// derived by hand.
// ---------------------------------------------------------------------------

export const AVAILABILITY_KINDS = [
  'fish',
  'bug',
  'forage',
  'crop',
  'mine_drop',
  'dig',
  'shop_stock',
  'festival',
  'birthday',
  'npc_schedule',
  'weekly_event',
] as const
export const AvailabilityKind = z.enum(AVAILABILITY_KINDS)
export type AvailabilityKind = z.infer<typeof AvailabilityKind>

/**
 * One flattened rule. Field names are short because there are several thousand
 * of these and the file is precached on the critical path.
 */
export const AvailabilityRule = z.object({
  /** entity id */
  e: IdRef,
  k: AvailabilityKind,
  /**
   * Location index into the shipped locations table, or **null for "we do not
   * know where"** — which is most of the forageables.
   *
   * Nullable rather than omitted: a window whose place is unknown still has to
   * appear in the results, badged, because dropping it would make the flagship
   * screen quietly claim the thing does not exist. Unknown does not exclude.
   */
  loc: z.number().int().min(0).nullable(),
  /** optional sub-location: body of water, mine floor band, shop counter */
  sub: z.number().int().min(0).nullable().default(null),

  /** season bitmask — see SEASON_BIT */
  sea: z.number().int().min(1),
  /** weather bitmask — see WEATHER_BIT. Already intersected with the season's legal weather. */
  wx: z.number().int().min(0),

  /** Minute intervals, already split at midnight. Empty means "any time". */
  t: z.array(z.tuple([z.number().int(), z.number().int()])).default([]),

  /** inclusive day-of-season range */
  d: z.tuple([z.number().int(), z.number().int()]).nullable().default(null),
  /** day-of-week bitmask — see DOW_BIT */
  dow: z.number().int().nullable().default(null),
  /** minimum year */
  y: z.number().int().nullable().default(null),

  /** rarity ordinal, 0 = common */
  rar: z.number().int().min(0).max(4).nullable().default(null),
  /** unparsed gate tokens; the client resolves these against player progress */
  req: z.array(z.string()).default([]),
  /** pin override in the region's viewBox coordinate space */
  p: z.tuple([z.number(), z.number()]).nullable().default(null),

  /** so the UI can render inferred pins differently from stated ones */
  conf: Confidence,
})
export type AvailabilityRule = z.infer<typeof AvailabilityRule>
