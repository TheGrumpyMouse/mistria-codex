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
  type TimeRange,
  toSnakeId,
  WEATHER_BIT,
  type Weather,
} from '@mistria/schema'
import { toBoolean, toInteger, toTokens } from '../../normalise/wikitext.js'
import { type BuildContext, type CargoRow, text } from '../context.js'
import { idStatusFor } from '../item-ids.js'
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
 * What the game's own files say about when and where something appears.
 *
 * Present only for the categories whose rules the game states plainly. Where it
 * is present it replaces the wiki's answer outright rather than merging with it:
 * the two agreed on every bug season checked, and where they differ the game is
 * the game.
 */
export interface GameWindowFacts {
  seasons: Season[]
  /** Already expanded from the game's four weather classes. Null means any. */
  weather: Weather[] | null
  /** Null means the rule states no hour restriction, which is not the same as unknown. */
  time: TimeRange | null
  /** Our location ids. Empty means the game does not narrow where it spawns. */
  locations: string[]
}

/**
 * The game's hours as a resolved time window.
 *
 * A game rule with no hour restriction is `not_applicable`, not `unknown`: the
 * files say there is no restriction, which is an answer. That distinction is
 * what takes the "time unknown" badge off a bug that genuinely has no window.
 */
function gameTime(
  input: ItemBuildInput,
): { ranges: TimeRange[] | null; precision: 'exact' | 'not_applicable' } | null {
  if (input.game === undefined) return null
  return input.game.time === null
    ? { ranges: null, precision: 'not_applicable' }
    : { ranges: [input.game.time], precision: 'exact' }
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
  // A ready-made answer from the game's own tables — currently the artifact
  // pools. It replaces the wiki path outright rather than merging with it,
  // the same rule every other game override follows.
  if (input.availabilityOverride !== undefined) {
    return {
      windows: input.availabilityOverride.windows,
      gaps: [...input.availabilityOverride.gaps],
    }
  }

  const gaps: string[] = []
  const methods = input.methods

  // A category table's own season column beats the Items one: Bugs record
  // season per bug, whereas Items records it per page.
  const seasonSource =
    input.seasonTokens !== undefined && input.seasonTokens.length > 0
      ? input.seasonTokens.join(' ')
      : text(row.season)

  const wiki = ctx.resolver.resolveSeasons(seasonSource, id)
  const place = ctx.resolver.resolveLocations(toTokens(row.location), id)

  // The game's own files beat the wiki wherever they say anything. `dates` has
  // no game equivalent — a spawn rule is seasonal, not calendar-dated — so it
  // keeps coming from the wiki either way.
  const seasons = input.game?.seasons ?? wiki.seasons
  const dates = wiki.dates

  const resolvedWeather =
    input.game !== undefined
      ? input.game.weather
      : narrowToSeason(ctx.resolver.resolveWeather(input.weatherTokens ?? [], id), seasons)

  // Time comes from the game as numbers when we have it. Before G1 the only
  // source was `Bugs.time`, which is loose prose, and 65 of 93 bugs had nothing
  // usable in it at all.
  const time =
    gameTime(input) ??
    (input.timeToken === undefined ? null : ctx.resolver.resolveTime(input.timeToken, id))

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
    const fromWiki = where.locations.length > 0 ? where.locations : byMethod

    // A bug's spawn tag and a room's `bug_tag` are the same vocabulary, which is
    // the only source in the project for where an insect can be caught. It beats
    // the habitat expansion outright: that one turns "Pond" into three ponds and
    // marks the result inferred, whereas this names the rooms the game spawns it
    // in. Only 38 of 103 bug windows had a location before it.
    const fromGame = input.game?.locations ?? []
    const locations = fromGame.length > 0 ? fromGame : fromWiki

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
      // A window whose places came from the game is not an inference and is not
      // the wiki's word for it. `verified` and `game_files` mean the app draws
      // its pins solid, and the distinction is why the hollow pin still means
      // something everywhere else.
      confidence: fromGame.length > 0 ? 'verified' : where.inferred ? 'inferred' : 'wiki',
      prov: fromGame.length > 0 ? 'game_files' : 'wiki_cargo',
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
  /**
   * What the game's own files say. Where this is set it wins — see
   * build/game-facts.ts for how the raw extract becomes these fields.
   */
  game?: GameWindowFacts
  /**
   * Complete windows the game states outright, gaps included. Stronger than
   * `game`, which only overrides fields inside the wiki's window shape — this
   * replaces the whole availability answer. Artifacts use it, because their
   * windows come from pool tables the wiki never had.
   */
  availabilityOverride?: { windows: AvailabilityWindow[]; gaps: string[] }
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

    // Where a source names this item, `id` is the game's own internal name
    // rather than a slug — and if the two differ, the slug was what the id used
    // to be. Keeping it in `former_ids` is what turns a name change into a
    // migration instead of a data loss, and it is not retrofittable once
    // someone's progress is keyed by an old id.
    //
    // Written off `id` rather than off the index, so it stays right no matter
    // which layer settled the name.
    const slug = toSnakeId(input.displayName)
    const formerIds = id !== slug ? [slug] : []
    const idStatus = idStatusFor(ctx.itemIds, input.displayName, id)
    const numericId = ctx.itemIds.numericByDisplay.get(input.displayName) ?? null

    items.push({
      id,
      name: input.displayName,
      category: input.categoryOverride ?? categoryFor(tags),

      // Provenance only. Numeric ids change between patches and hard rule 3
      // forbids anything referencing one — which is also why this stays stamped
      // at v0.15.0 even for a name the current build confirms: the game files
      // do not publish ordinals, and re-deriving them would be a guess.
      numeric_id: numericId,
      numeric_id_game_version: numericId === null ? null : ctx.itemIds.gameVersion,
      // `confirmed` only for a name read from the installed build. v0.15.0
      // predates 1.0, so a name it settles is the game's rather than ours but
      // may still have moved since — that is `confirmed_stale`.
      id_status: idStatus,
      former_ids: formerIds,
      also_known_as: [],

      game_version: idStatus === 'confirmed' ? ctx.itemIds.confirmedAt : null,
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
