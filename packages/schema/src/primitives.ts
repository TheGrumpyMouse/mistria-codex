import { z } from 'zod'

/**
 * Closed vocabularies. Every one of these is a hard enum: the pipeline resolves
 * loose wiki tokens into these values or fails, it never widens the vocabulary
 * to accommodate an unrecognised input.
 */

export const SEASONS = ['spring', 'summer', 'fall', 'winter'] as const
export const Season = z.enum(SEASONS)
export type Season = z.infer<typeof Season>

/** The six weather states the game gates content on. */
export const WEATHERS = ['clear', 'rain', 'storm', 'wind', 'snow', 'blizzard'] as const
export const Weather = z.enum(WEATHERS)
export type Weather = z.infer<typeof Weather>

/**
 * Our own non-overlapping partition of the game day.
 *
 * The research doc's blocks (Morning 6-11, Day 6-20, Night 20-2) overlap and are
 * therefore useless as buckets. We treat those wiki labels as *ranges to
 * materialise* into concrete `time` windows, and use this partition only for UI
 * chips and coarse indexing.
 *
 * The game day runs 06:00 -> 02:00, so `night` wraps midnight.
 */
export const TIME_BLOCKS = ['morning', 'day', 'evening', 'night'] as const
export const TimeBlock = z.enum(TIME_BLOCKS)
export type TimeBlock = z.infer<typeof TimeBlock>

export const TIME_BLOCK_RANGES: Readonly<Record<TimeBlock, readonly [number, number]>> = {
  morning: [6 * 60, 11 * 60],
  day: [11 * 60, 18 * 60],
  evening: [18 * 60, 20 * 60],
  night: [20 * 60, 2 * 60], // wraps midnight
} as const

export const DAYS_OF_WEEK = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const
export const DayOfWeek = z.enum(DAYS_OF_WEEK)
export type DayOfWeek = z.infer<typeof DayOfWeek>

export const RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary'] as const
export const Rarity = z.enum(RARITIES)
export type Rarity = z.infer<typeof Rarity>

export const QUALITIES = ['normal', 'silver', 'gold', 'perfect', 'golden'] as const
export const Quality = z.enum(QUALITIES)
export type Quality = z.infer<typeof Quality>

export const CURRENCIES = [
  'tesserae',
  'renown',
  'essence',
  'shiny_bead',
  'breath_of_spring',
  'queen_berry',
] as const
export const Currency = z.enum(CURRENCIES)
export type Currency = z.infer<typeof Currency>

/** How a thing enters the player's inventory. */
export const SPAWN_METHODS = [
  'fishing',
  'diving',
  'fish_trap',
  'fish_bait',
  'bug_net',
  'rock_break',
  'foraging',
  'dig_spot',
  'tree_shake',
  'mine_drop',
  'monster_drop',
  'crop_harvest',
  'ranching',
  'apiary',
  'terrarium',
  'shop',
  'crafting',
  'cooking',
  'quest_reward',
  'festival',
  'mail',
  'chest',
] as const
export const SpawnMethod = z.enum(SPAWN_METHODS)
export type SpawnMethod = z.infer<typeof SpawnMethod>

/**
 * A class of place, as the wiki and the player think of it ("Pond", "River").
 * Distinct from a Location, which is a specific place on a map that a pin needs.
 * See `curated/aliases/location_aliases.json` for the expansion policy.
 */
export const HABITATS = [
  'ocean',
  'river',
  'pond',
  'beach',
  'mine_water',
  'overworld',
  'forest',
  'mountain',
  'cave',
  'indoor',
  'farm',
] as const
export const Habitat = z.enum(HABITATS)
export type Habitat = z.infer<typeof Habitat>

export const LOCATION_KINDS = [
  'outdoor',
  'indoor',
  'mine',
  'cave',
  'beach',
  'water',
  'farm',
  'shop',
] as const
export const LocationKind = z.enum(LOCATION_KINDS)
export type LocationKind = z.infer<typeof LocationKind>

export const ITEM_CATEGORIES = [
  'fish',
  'bug',
  'forageable',
  'crop',
  'fruit',
  'artifact',
  'material',
  'ranching_product',
  'cooked',
  'tool',
  'weapon',
  'equipment',
  'furniture',
  'cosmetic',
  'seed',
  'ingot',
  'gem',
  'ore',
  'junk',
  'misc',
] as const
export const ItemCategory = z.enum(ITEM_CATEGORIES)
export type ItemCategory = z.infer<typeof ItemCategory>

export const MUSEUM_WINGS = ['archaeology', 'flora', 'insects', 'fish'] as const
export const MuseumWing = z.enum(MUSEUM_WINGS)
export type MuseumWing = z.infer<typeof MuseumWing>

export const GIFT_INTERESTS = ['loved', 'liked', 'neutral', 'disliked', 'hated'] as const
export const GiftInterest = z.enum(GIFT_INTERESTS)
export type GiftInterest = z.infer<typeof GiftInterest>

/**
 * How much to trust a value.
 * - `verified` — checked against the game's own data files
 * - `wiki`     — sourced from the wiki and not yet cross-checked
 * - `inferred` — derived by the pipeline (e.g. habitat expansion). The UI must
 *                render inferred data visibly differently from fact.
 */
export const CONFIDENCES = ['verified', 'wiki', 'inferred'] as const
export const Confidence = z.enum(CONFIDENCES)
export type Confidence = z.infer<typeof Confidence>

export const PROVENANCE_SOURCES = [
  'game_files',
  'wiki_cargo',
  'wiki_page',
  'manual',
  'community_archive',
] as const
export const ProvenanceSource = z.enum(PROVENANCE_SOURCES)
export type ProvenanceSource = z.infer<typeof ProvenanceSource>

/**
 * Whether an `id` is the game's real internal name yet.
 * - `provisional`     — slugified from a display name; may not match the game
 * - `confirmed_stale` — matched against the archived v0.15.0 ID table
 * - `confirmed`       — read from the game's own files
 */
export const ID_STATUSES = ['provisional', 'confirmed_stale', 'confirmed'] as const
export const IdStatus = z.enum(ID_STATUSES)
export type IdStatus = z.infer<typeof IdStatus>

/**
 * How precisely we know a constraint, so the UI can avoid over-promising.
 *
 * `not_applicable` and `unknown` are different answers and must not be merged:
 * a mine has no weather (not applicable), whereas nobody has recorded when a
 * given fish bites (unknown). Both show a null value, and only this field says
 * which kind of null it is.
 */
export const PRECISIONS = ['exact', 'coarse', 'block', 'not_applicable', 'unknown'] as const
export const Precision = z.enum(PRECISIONS)
export type Precision = z.infer<typeof Precision>

// ---------------------------------------------------------------------------
// Bitmasks
//
// The shipped availability index compares integers, not string arrays. These
// constants are exported so the build and the client are provably identical —
// a divergence here silently returns wrong results rather than throwing.
// ---------------------------------------------------------------------------

export const SEASON_BIT: Readonly<Record<Season, number>> = {
  spring: 1,
  summer: 2,
  fall: 4,
  winter: 8,
} as const
export const SEASON_MASK_ALL = 0b1111

export const WEATHER_BIT: Readonly<Record<Weather, number>> = {
  clear: 1,
  rain: 2,
  storm: 4,
  wind: 8,
  snow: 16,
  blizzard: 32,
} as const
export const WEATHER_MASK_ALL = 0b111111

export const DOW_BIT: Readonly<Record<DayOfWeek, number>> = {
  mon: 1,
  tue: 2,
  wed: 4,
  thu: 8,
  fri: 16,
  sat: 32,
  sun: 64,
} as const
export const DOW_MASK_ALL = 0b1111111

export const seasonMask = (seasons: readonly Season[]): number =>
  seasons.reduce((m, s) => m | SEASON_BIT[s], 0)

export const weatherMask = (weathers: readonly Weather[]): number =>
  weathers.reduce((m, w) => m | WEATHER_BIT[w], 0)

export const dowMask = (days: readonly DayOfWeek[]): number =>
  days.reduce((m, d) => m | DOW_BIT[d], 0)

/**
 * Weather that can physically occur in a season. The build intersects every
 * rule's weather mask with this, so a summer query never has to special-case
 * snow and "any weather" stays honest.
 */
export const SEASON_LEGAL_WEATHER: Readonly<Record<Season, number>> = {
  spring: WEATHER_BIT.clear | WEATHER_BIT.rain | WEATHER_BIT.storm | WEATHER_BIT.wind,
  summer: WEATHER_BIT.clear | WEATHER_BIT.rain | WEATHER_BIT.storm | WEATHER_BIT.wind,
  fall: WEATHER_BIT.clear | WEATHER_BIT.rain | WEATHER_BIT.storm | WEATHER_BIT.wind,
  winter: WEATHER_BIT.clear | WEATHER_BIT.wind | WEATHER_BIT.snow | WEATHER_BIT.blizzard,
} as const

/** A Mistria season is exactly 28 days — four seven-day weeks. */
export const DAYS_PER_SEASON = 28
export const SEASONS_PER_YEAR = 4

/** Minutes past midnight. The game day starts at 06:00 and ends at 02:00. */
export const DAY_START_MINUTE = 6 * 60
export const DAY_END_MINUTE = 2 * 60
export const MINUTES_PER_DAY = 24 * 60
