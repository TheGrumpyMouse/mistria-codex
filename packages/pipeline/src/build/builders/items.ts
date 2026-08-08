import {
  type AvailabilityWindow,
  blocksForIntervals,
  type Item,
  type ItemCategory,
  type MuseumWing,
  type Rarity,
  SEASON_LEGAL_WEATHER,
  type Season,
  type SpawnMethod,
  splitAtMidnight,
  toSnakeId,
  WEATHER_BIT,
  type Weather,
} from '@mistria/schema'
import { toBoolean, toInteger, toTokens } from '../../normalise/wikitext.js'
import { type BuildContext, type CargoRow, text } from '../context.js'
import { expandHabitats, splitByFishableFloors } from '../waters.js'

/**
 * The wiki tags an item "Missing Data" when its own editors know something is
 * absent. That is a gift: it converts directly into `data_gaps` instead of us
 * having to infer incompleteness.
 */
const MISSING_DATA_TAG = 'missing data'
const UNRELEASED_TAG = 'unreleased'

/**
 * Which mine biome a window sits in, if any.
 *
 * The location is tried first because it is what a source actually said; the
 * floor range is a fallback for windows that name a depth without naming a
 * place. Both come from `curated/entities/mines.json`, so there is exactly one
 * definition of "floors 21-39 is the Tide Caverns" in the project.
 */
function biomeFor(
  ctx: BuildContext,
  locations: string[],
  depth: { min: number; max: number } | null,
): string | null {
  const byLocation = ctx.mines.biomes.find((b) => locations.includes(b.location_id))
  if (byLocation !== undefined) return byLocation.id

  if (depth === null) return null
  const byFloors = ctx.mines.biomes.find(
    (b) => depth.min >= b.floors.min && depth.max <= b.floors.max,
  )
  return byFloors?.id ?? null
}

/** Which category an item belongs to, decided by its wiki tags. */
function categoryFor(tags: string[]): ItemCategory {
  const folded = tags.map((t) => t.toLowerCase())
  if (folded.includes('fish')) return 'fish'
  if (folded.includes('bug') || folded.includes('bee')) return 'bug'
  if (folded.some((t) => t.endsWith('forageable'))) return 'forageable'
  if (folded.includes('crop')) return 'crop'
  if (folded.includes('fruit')) return 'fruit'
  if (folded.includes('artifact')) return 'artifact'
  if (folded.includes('seed')) return 'seed'
  if (folded.includes('material')) return 'material'
  if (folded.includes('food') || folded.some((t) => t.startsWith('food:'))) return 'cooked'
  if (folded.includes('tool') || folded.includes('tools')) return 'tool'
  if (folded.includes('weapon') || folded.includes('swords')) return 'weapon'
  if (folded.includes('equipment')) return 'equipment'
  if (folded.includes('animal product')) return 'ranching_product'
  if (folded.includes('junk item')) return 'junk'
  return 'misc'
}

const RARITIES: Record<string, Rarity> = {
  common: 'common',
  uncommon: 'uncommon',
  rare: 'rare',
  legendary: 'legendary',
  epic: 'epic',
}

/**
 * Narrow "any weather" to the weather its seasons can physically have.
 *
 * The wiki records 126 of 143 fish as available in "Any" weather, which is true
 * as written but useless as stored: a winter-only fish would claim it bites in
 * the rain, and winter has no rain. Intersecting here means the query never has
 * to special-case it and the app never shows an impossible combination.
 *
 * The intersection is against the *union* of the window's seasons, since one
 * window covers them all — a spring-and-winter fish legitimately keeps every
 * state. Narrowing further would need one window per season, which the source
 * data does not support.
 */
function narrowToSeason(weather: Weather[] | null, seasons: Season[]): Weather[] | null {
  if (weather === null) return null

  const legal = seasons.reduce((mask, season) => mask | SEASON_LEGAL_WEATHER[season], 0)
  const narrowed = weather.filter((w) => (WEATHER_BIT[w] & legal) !== 0)

  // If the source claims weather no season allows, keep the source value rather
  // than silently emptying the field — that is a conflict to notice, not to hide.
  return narrowed.length > 0 ? narrowed : weather
}

/**
 * Build the availability windows for one item.
 *
 * Everything that is genuinely unknown stays null and is named in `data_gaps`.
 *
 * Time comes from three places, in order of authority: an explicit window on the
 * source row (only bugs have one), then the per-method rule for methods where no
 * restriction exists (fishing), then unknown. Keeping those apart is what stops
 * the app either inventing a restriction or hiding a gap.
 */
function buildAvailability(
  ctx: BuildContext,
  row: CargoRow,
  id: string,
  input: ItemBuildInput,
  rarity: Rarity | null,
): { windows: AvailabilityWindow[]; gaps: string[] } {
  const gaps: string[] = []
  const methods = input.methods

  // A category table's own season column beats the Items one: Bugs record
  // season per bug, whereas Items records it per page.
  const seasonSource =
    input.seasonTokens !== undefined && input.seasonTokens.length > 0
      ? input.seasonTokens.join(' ')
      : text(row.season)

  const { seasons, dates } = ctx.resolver.resolveSeasons(seasonSource, id)
  const place = ctx.resolver.resolveLocations(toTokens(row.location), id)
  const resolvedWeather = narrowToSeason(
    ctx.resolver.resolveWeather(input.weatherTokens ?? [], id),
    seasons,
  )

  // Bugs are the only category with a real time column, so this is the only
  // place a genuine time window comes from before the game files land.
  const time = input.timeToken === undefined ? null : ctx.resolver.resolveTime(input.timeToken, id)

  if (place.hasGap) gaps.push('locations')

  const allMethods = [...new Set([...methods, ...place.methods])]
  if (allMethods.length === 0) {
    // No method means no window, which means the item cannot appear on the
    // "what can I find right now" screen. That is often correct — a forged
    // sword is not found — but it is never something to leave implicit, so it
    // is recorded and shows up in the coverage report.
    gaps.push('obtain_method')
    return { windows: [], gaps }
  }

  // One window per method. A fish that can be both angled and dived for is two
  // ways of getting it, and the app must be able to say which.
  const windows = allMethods.flatMap((method): AvailabilityWindow[] => {
    // Time of day does not affect fishing in this game, so a null time on a
    // fish is "no such restriction" — not "nobody wrote it down". Badging those
    // as unknown would put an un-clearable warning on every fish in the app.
    // Methods absent from the rules file default to unknown, which is the safe
    // direction. See curated/vocab/method_rules.json.
    const timeNA = ctx.methodRules.timeNotApplicable.includes(method)
    const weatherNA = ctx.methodRules.weatherNotApplicable.includes(method)

    // A resolved time window wins over the per-method rule: the source told us
    // something specific, which beats a general "this method has no restriction".
    const timePrecision = time !== null ? time.precision : timeNA ? 'not_applicable' : 'unknown'

    if (timePrecision === 'unknown') gaps.push('time')
    if (resolvedWeather === null && !weatherNA) gaps.push('weather')

    // "Pond" becomes the three ponds the Fishing page enumerates — and, for a
    // diving window, only the ones a player can actually dive in. The window is
    // marked inferred because the wiki said which ponds exist, not which one
    // this fish is in, and the UI draws an inferred pin hollow.
    const where = expandHabitats(ctx.waters, place.habitats, place.locations, method)

    // A method that settles its own place — a crop grows where it was planted.
    // Only applied where nothing better is known, and only for the methods
    // curated/vocab/method_rules.json has a source for.
    const byMethod = ctx.methodRules.locationByMethod[method] ?? []
    const locations = where.locations.length > 0 ? where.locations : byMethod

    const window: AvailabilityWindow = {
      method,
      habitats: place.habitats,
      locations,
      spot_ids: [],
      seasons,
      weather: resolvedWeather,
      weather_precision:
        resolvedWeather !== null ? 'exact' : weatherNA ? 'not_applicable' : 'unknown',
      time: time?.ranges ?? null,
      time_blocks:
        time?.ranges != null
          ? [...new Set(time.ranges.flatMap((r) => blocksForIntervals(splitAtMidnight(r))))]
          : null,
      time_precision: timePrecision,
      days: null,
      dates,
      depth: place.depth,
      biome_id: biomeFor(ctx, locations, place.depth),
      min_year: null,
      rarity,
      chance: null,
      quantity: null,
      requires: place.requires,
      confidence: where.inferred ? 'inferred' : 'wiki',
      prov: 'wiki_cargo',
    }

    // A mine biome is fishable only where it holds water: floors 2-19 of the
    // Upper Mines, and 81-89 plus 91-99 of the Ancient Ruins. Two ranges is two
    // windows, because one 81-99 window would claim floor 90 has water.
    return splitByFishableFloors(ctx.waters, window)
  })

  // A habitat with no expansion — `overworld`, which means "outdoors, nowhere
  // in particular" — is still a genuine gap. One that expanded is not: the
  // window now names places, and the uncertainty that remains is recorded as
  // `confidence: "inferred"` rather than counted twice.
  if (windows.some((w) => w.locations.length === 0 && w.habitats.length > 0)) {
    gaps.push('locations')
  }

  return { windows, gaps: [...new Set(gaps)] }
}

export interface ItemBuildInput {
  displayName: string
  methods: SpawnMethod[]
  rarity?: Rarity | null
  weatherTokens?: string[]
  /**
   * Season straight from a category table. Bugs carry their own season column,
   * which is better than the Items one because it is per-bug rather than
   * per-item-page.
   */
  seasonTokens?: string[]
  /** Bugs are the only category with a real time column. */
  timeToken?: string
  categoryOverride?: ItemCategory
  museum?: { setId: string; wing: MuseumWing } | undefined
}

/**
 * Build item records for a named subset.
 *
 * D1 covers fish, crops, and the seed items crops reference — the last of those
 * because a crop's `seed_item_id` would otherwise dangle and fail referential
 * integrity.
 */
export function buildItems(ctx: BuildContext, inputs: ItemBuildInput[]): Item[] {
  const items: Item[] = []

  for (const input of inputs) {
    const row = ctx.itemByName.get(input.displayName)
    if (row === undefined) continue

    const id = ctx.idFor(input.displayName)
    const tags = toTokens(row.tags)
    const folded = tags.map((t) => t.toLowerCase())

    const rarity = input.rarity ?? RARITIES[text(row.rarity).toLowerCase()] ?? null

    const { windows, gaps } = buildAvailability(ctx, row, id, input, rarity)

    if (folded.includes(MISSING_DATA_TAG)) gaps.push('wiki_flagged_missing_data')
    if (folded.includes(UNRELEASED_TAG)) gaps.push('unreleased')

    const sellValue = toInteger(row.sellValue)
    if (sellValue === null) gaps.push('sell_value')

    const donatable = toBoolean(row.museum)

    // Where a v0.15.0 datamining snapshot names this item, `id` is the game's
    // own internal name rather than a slug — and if the two differ, the slug
    // was what the id used to be. Keeping it in `former_ids` is what turns the
    // eventual game-file pass into a migration instead of a data loss, and it
    // is not retrofittable once someone's progress is keyed by an old id.
    const internal = ctx.itemIds.internalByDisplay.get(input.displayName)
    const slug = toSnakeId(input.displayName)
    const formerIds = internal !== undefined && internal !== slug ? [slug] : []

    items.push({
      id,
      name: input.displayName,
      category: input.categoryOverride ?? categoryFor(tags),

      // Provenance only. Numeric ids change between patches and hard rule 3
      // forbids anything referencing one.
      numeric_id: ctx.itemIds.numericByDisplay.get(input.displayName) ?? null,
      numeric_id_game_version: internal === undefined ? null : ctx.itemIds.gameVersion,
      // `confirmed_stale`, never `confirmed`: v0.15.0 predates 1.0, so the name
      // is the game's rather than ours but may still have moved since.
      id_status: internal === undefined ? 'provisional' : 'confirmed_stale',
      former_ids: formerIds,

      game_version: null,
      version_added: null,
      confidence: 'wiki',
      prov: { '*': 'wiki_cargo' },
      data_gaps: [...new Set(gaps)],

      // Our own key, never the wiki's image filename — storing that would
      // invite hotlinking someone else's proprietary art.
      icon_key: `${input.categoryOverride ?? categoryFor(tags)}/${id}`,
      wiki_page: input.displayName.replace(/ /g, '_'),
      blurb: null,

      subcategory: null,
      base_item_id: null,
      quality: null,

      sell_value: sellValue,
      buy_value: null,
      stamina: toInteger(row.stamina),
      health: toInteger(row.health),
      mana: toInteger(row.mana),

      is_consumable: toBoolean(row.isConsumable),
      is_craftable: toBoolean(row.isCraftable),
      is_buyable: toBoolean(row.isBuyable),
      is_giftable: null,

      tags,
      museum:
        donatable === null
          ? null
          : {
              donatable,
              set_id: input.museum?.setId ?? null,
              wing: input.museum?.wing ?? null,
              donation_points: null,
            },

      availability: windows,
      used_in_recipe_ids: [],
      sold_by: [],
    })
  }

  return items
}
