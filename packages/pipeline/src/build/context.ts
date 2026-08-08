import { join } from 'node:path'
import {
  type Building,
  type Currency,
  SEASONS,
  type Season,
  type SpawnMethod,
  toSnakeId,
} from '@mistria/schema'
import type { CalendarExtract } from '../enrich/calendar.js'
import type { ItemNamesExtract } from '../enrich/item-names.js'
import type { MapShapesExtract } from '../enrich/map-shapes.js'
import type { MapsExtract } from '../enrich/maps.js'
import type { MonstersExtract } from '../enrich/monsters.js'
import type { MuseumExtract } from '../enrich/museum.js'
import type { PlacesExtract } from '../enrich/places.js'
import type { QuestExtract } from '../enrich/quests.js'
import type { ScheduleExtract } from '../enrich/schedules.js'
import type { ExtractedShop } from '../enrich/shops.js'
import type { SkillsExtract } from '../enrich/skills.js'
import type { WatersExtract } from '../enrich/waters.js'
import { CURATED_DIR, SOURCES_DIR } from '../lib/paths.js'
import { readJsonFile } from '../lib/read-json.js'
import { Resolver } from '../normalise/resolve.js'
import { decodeEntities, stripWikitext } from '../normalise/wikitext.js'
import type { MarkerAlias } from './builders/maps.js'
import { type GameFacts, loadGameFacts, loadWeatherClasses } from './game-facts.js'
import { buildItemIdIndex, type ItemIdIndex } from './item-ids.js'
import { buildWaterIndex, type WaterIndex } from './waters.js'

export type CargoRow = Record<string, unknown>

/**
 * Which Characters rows are real villagers rather than wiki user pages.
 * See `curated/vocab/characters.json`.
 */
export interface CharacterRules {
  /** The pinned villager roster. See curated/vocab/characters.json. */
  roster: string[]
  /**
   * Display name -> the game's npc file stem, where the two differ.
   *
   * Only one entry today: the wiki has no page for Seridia and calls her the
   * Priestess. See the file for why the id has not moved with the name.
   */
  gameNpcIds?: Record<string, string>
}

/**
 * Which constraints genuinely don't apply to a given method, as opposed to
 * being unrecorded. See `curated/vocab/method_rules.json` for the sources.
 */
export interface MethodRules {
  timeNotApplicable: SpawnMethod[]
  weatherNotApplicable: SpawnMethod[]
  /**
   * Methods where the way you obtain a thing is also where it happens — a crop
   * grows where it was planted, which is the farm and nowhere else. Only for
   * methods the source settles; see the file for what is deliberately absent.
   */
  locationByMethod: Partial<Record<SpawnMethod, string[]>>
}

/**
 * The festival extract, with its season strings narrowed to the enum.
 *
 * The wiki encodes a season as a digit and `curated/vocab/calendar.json` maps it
 * to a name. Narrowing at load means one throw with a useful message here rather
 * than a Zod failure four steps downstream pointing at a record nobody authored.
 */
export interface FestivalInputs {
  wikiVersionStamp: string | null
  lastEdited: string | null
  /** Festival display name -> the item display name it collects. */
  currencies: Record<string, string>
  festivals: {
    season: Season
    day: number
    name: string
    page: string | null
    implemented: boolean
    location: string | null
  }[]
}

/**
 * How the schedule pages' headings are read. See `curated/vocab/schedules.json`.
 *
 * `unselectableSections` is the load-bearing part: rainy and Friday-night
 * tables are chosen by a hidden counter, so they become a named gap rather than
 * a schedule entry that would present a coin flip as a fact.
 */
export interface ScheduleVocab {
  pagePattern: string
  seasonHeadings: Record<string, string>
  dayHeadings: string[]
  unselectableSections: { prefix: string; gap: string }[]
  gatePattern: string
}

/** A building read from its `{{Infobox location}}`. See `curated/vocab/places.json`. */
export interface PlaceVocab {
  places: { page: string; id: string; name: string; kind: string; aliases: string[] }[]
  /** Regions that already have a location record and gain only their gate. */
  regions: { page: string; id: string }[]
  /** Place pages that spell a quest differently from the Quests page. */
  questNameAliases: Record<string, string>
}

/** One line of a shop's stock, flattened out of the per-shop extract. */
export interface ShopStockRow {
  shopId: string
  item: { target: string; display: string }
  prices: { amount: number | null; token: string }[]
  requires: string[]
  seasons: string[] | null
}

export interface ShopInputs {
  /** Raw `{{Price|N|token}}` token -> currency. Anything else is not a price. */
  priceTokens: Record<string, Currency>
  /** Tokens known to price something other than money (a defence stat, a level). */
  nonPriceTokens: Set<string>
  shops: {
    id: string
    name: string
    page: string
    owner: string | null
    staff: string[]
    rotates: boolean
    location: string | null
    wikiVersionStamp: string | null
    lastEdited: string | null
  }[]
  stock: ShopStockRow[]
}

/** The eight farm animals, hand-authored. See `curated/entities/animals.json`. */
export interface AnimalInputs {
  feed: Record<'coop' | 'barn', string[]>
  maturesDays: Record<'coop' | 'barn', number>
  gestationDays: number
  shopId: string
  animals: {
    id: string
    name: string
    building: 'coop' | 'barn'
    price: number
    treat: string
    products: string[]
    goldenProducts: string[]
    wiki_page: string
  }[]
}

/** Farm buildings and home upgrades. See `curated/entities/buildings.json`. */
export interface BuildingInputs {
  buildings: {
    id: string
    name: string
    kind: Building['kind']
    vendor: string | null
    placeable_on_farm: boolean
    wiki_page: string
    tiers: {
      level: number
      tesserae: number
      capacity: number | null
      materials: { item: string; quantity: number }[]
      requires: unknown[]
    }[]
  }[]
}

/** The five mine biomes, hand-authored. See `curated/entities/mines.json`. */
export interface MineInputs {
  commonDropItemNames: string[]
  biomes: {
    id: string
    name: string
    location_id: string
    floors: { min: number; max: number }
    seal: { name: string; floor: number; quest: string | null }
    unlock_quest: string | null
    ore_item_names: string[]
    artifact_set_ids: string[]
    hazards: string[]
    wiki_page: string
  }[]
}

/**
 * Everything the builders read, loaded once.
 *
 * The name index is the load-bearing part. `Fish` and `Crops` carry no season,
 * location or sell value — those live in `Items` and join on **display name**.
 * `pnpm --filter @mistria/pipeline run vocab:report` asserts that itemName is
 * unique across all 1,154 rows, because a duplicate would make this join
 * silently wrong rather than loudly broken.
 */
export interface BuildContext {
  items: CargoRow[]
  fish: CargoRow[]
  crops: CargoRow[]
  bugs: CargoRow[]
  artifacts: CargoRow[]
  characters: CargoRow[]
  giftPrefs: CargoRow[]
  recipes: CargoRow[]
  ingredients: CargoRow[]
  museum: MuseumExtract
  skills: SkillsExtract
  festivals: FestivalInputs
  mines: MineInputs
  shops: ShopInputs
  quests: QuestExtract
  animals: AnimalInputs
  buildings: BuildingInputs
  /**
   * Which regions hold ponds, rivers and ocean, and which mine floors are
   * fishable. This is what lets a "Pond" fish be drawn on a map at all.
   */
  waters: WaterIndex
  places: PlacesExtract
  monsters: MonstersExtract
  /**
   * The wiki's own map markers, and the coordinate space they live in.
   *
   * Optional: a clone whose `sources/` predates the map enricher builds fine
   * and every location keeps its anchor gap, which is the state this project
   * was in until the DataMaps pages were found.
   */
  maps: MapsExtract | null
  mapShapes: MapShapesExtract | null
  mapAliases: MarkerAlias[]
  /**
   * The game's real internal item names, where a v0.15.0 snapshot has them.
   * `idFor` consults this first, so every item reference in the dataset moves
   * together — see build/item-ids.ts.
   */
  itemIds: ItemIdIndex
  /**
   * The game's own files, where this clone has them.
   *
   * Optional for the same reason `maps` is: `sources/game/` is committed, so CI
   * has it, but a clone whose sources predate G1 still builds and simply gets
   * the wiki's answers — thinner time data, `confirmed_stale` ids, and the
   * coverage report saying so.
   */
  game: GameFacts | null
  /** Game weather class -> our weather, per season. See curated/vocab/weather.json. */
  weatherClasses: Record<string, Partial<Record<Season, string | null>>>
  schedules: ScheduleExtract
  scheduleVocab: ScheduleVocab
  /** display name -> Items row */
  itemByName: Map<string, CargoRow>
  /**
   * Display name -> item id.
   *
   * The game's internal name when we know it, `toSnakeId` when we don't. Every
   * builder goes through this rather than slugifying for itself, so an id that
   * changes changes everywhere at once instead of leaving half the dataset
   * pointing at a name that no longer exists.
   */
  idFor: (displayName: string) => string
  resolver: Resolver
  methodRules: MethodRules
  characterRules: CharacterRules
  /** Perk id -> what it does, in our own words. See curated/vocab/perk_effects.json. */
  perkEffects: Record<string, string>
  /**
   * Game item ids to surface before the wiki documents them — the 1.0
   * additions. An allowlist, never a sync; see curated/vocab/items_1_0.json.
   */
  gameOnlyItems: string[]
}

const isSeason = (value: string): value is Season => (SEASONS as readonly string[]).includes(value)

const cargo = (table: string): Promise<CargoRow[]> =>
  readJsonFile<CargoRow[]>(join(SOURCES_DIR, 'wiki', 'cargo', `${table}.json`))

export async function loadContext(): Promise<BuildContext> {
  const [items, fish, crops, bugs, artifacts, characters, giftPrefs, recipes, ingredients] =
    await Promise.all([
      cargo('Items'),
      cargo('Fish'),
      cargo('Crops'),
      cargo('Bugs'),
      cargo('Artifacts'),
      cargo('Characters'),
      cargo('GiftPrefs'),
      cargo('Recipes'),
      cargo('Ingredients'),
    ])

  const pages = (file: string): string => join(SOURCES_DIR, 'wiki', 'pages', file)
  const [
    museum,
    skills,
    calendar,
    extractedShops,
    quests,
    watersExtract,
    places,
    schedules,
    monsters,
  ] = await Promise.all([
    readJsonFile<MuseumExtract>(pages('museum_sets.json')),
    readJsonFile<SkillsExtract>(pages('skills.json')),
    readJsonFile<CalendarExtract>(pages('festivals.json')),
    readJsonFile<ExtractedShop[]>(pages('shops.json')),
    readJsonFile<QuestExtract>(pages('quests.json')),
    readJsonFile<WatersExtract>(pages('waters.json')),
    readJsonFile<PlacesExtract>(pages('places.json')),
    readJsonFile<ScheduleExtract>(pages('schedules.json')),
    readJsonFile<MonstersExtract>(pages('monsters.json')),
  ])

  const { currencies } = await readJsonFile<{ currencies: Record<string, string> }>(
    join(CURATED_DIR, 'vocab', 'calendar.json'),
  )
  const itemNames = await readJsonFile<ItemNamesExtract>(
    join(SOURCES_DIR, 'community', 'item_names.json'),
  )
  const [game, weatherClasses] = await Promise.all([loadGameFacts(), loadWeatherClasses()])
  const itemIds = buildItemIdIndex(itemNames, game)

  // Optional on purpose: `sources/` from before the map enricher existed still
  // builds, and every location simply keeps the anchor gap it had.
  const maps = await readJsonFile<MapsExtract>(pages('maps.json')).catch(() => null)
  const mapShapes = await readJsonFile<MapShapesExtract>(pages('map_shapes.json')).catch(() => null)
  const { anchors: mapAliases } = await readJsonFile<{ anchors: MarkerAlias[] }>(
    join(CURATED_DIR, 'aliases', 'map_markers.json'),
  ).catch(() => ({ anchors: [] as MarkerAlias[] }))

  const entities = (file: string): string => join(CURATED_DIR, 'entities', file)
  const [mines, animals, buildings] = await Promise.all([
    readJsonFile<MineInputs>(entities('mines.json')),
    readJsonFile<AnimalInputs>(entities('animals.json')),
    readJsonFile<BuildingInputs>(entities('buildings.json')),
  ])

  const shopVocab = await readJsonFile<{
    priceTokens: Record<string, Currency>
    nonPriceTokens: { token: string; reason: string }[]
    shops: { id: string; owner: string | null; staff: string[] }[]
  }>(join(CURATED_DIR, 'vocab', 'shops.json'))

  const curatedShop = new Map(shopVocab.shops.map((s) => [s.id, s] as const))
  const shops: ShopInputs = {
    priceTokens: shopVocab.priceTokens,
    nonPriceTokens: new Set(shopVocab.nonPriceTokens.map((t) => t.token)),
    shops: extractedShops.map((shop) => ({
      id: shop.id,
      name: shop.name,
      page: shop.page,
      owner: shop.owner,
      staff: curatedShop.get(shop.id)?.staff ?? [],
      rotates: shop.rotates,
      location: shop.location,
      wikiVersionStamp: shop.wikiVersionStamp,
      lastEdited: shop.lastEdited,
    })),
    stock: extractedShops.flatMap((shop) =>
      shop.stock.map((row) => ({
        shopId: shop.id,
        item: row.item,
        prices: row.prices,
        requires: row.requires,
        seasons: row.seasons,
      })),
    ),
  }

  const festivals: FestivalInputs = {
    wikiVersionStamp: calendar.wikiVersionStamp,
    lastEdited: calendar.lastEdited,
    currencies,
    festivals: calendar.festivals.map((f) => {
      if (!isSeason(f.season)) {
        throw new Error(
          `Festival "${f.name}" has season "${f.season}", which is not one of ` +
            `${SEASONS.join(', ')}. Check seasonOrder in curated/vocab/calendar.json.`,
        )
      }
      return { ...f, season: f.season }
    }),
  }

  const resolver = await Resolver.load()

  // Buildings become locations here rather than in the resolver, because their
  // region is read from the wiki and the resolver only knows curated inputs.
  // Which buildings exist is the curated half; where each one is, is the
  // sourced half — and the Museum being in The Narrows is why it is sourced.
  const placeVocab = await readJsonFile<PlaceVocab>(join(CURATED_DIR, 'vocab', 'places.json'))
  const placeById = new Map(places.places.map((p) => [p.id, p] as const))
  // A place page may spell a quest its own way. Canonicalising here means the
  // gate points at a quest that exists rather than one nobody can ever finish.
  const questName = (name: string | null): string | null =>
    name === null ? null : (placeVocab.questNameAliases[name] ?? name)
  for (const place of placeVocab.places) {
    const extracted = placeById.get(place.id)
    if (extracted === undefined) {
      throw new Error(
        `"${place.id}" is in curated/vocab/places.json but not in sources — run ` +
          '`pnpm enrich:pages` after adding a place.',
      )
    }
    const parent =
      extracted.region === null
        ? null
        : resolver.locationId([extracted.region], `place:${place.id}`)
    resolver.addLocation({
      id: place.id,
      name: place.name,
      kind: place.kind,
      habitats: place.kind === 'outdoor' ? ['overworld'] : ['indoor'],
      aliases: place.aliases,
      unlock_quest: questName(extracted.unlockQuest),
      wiki_page: place.page,
      ...(parent === null ? {} : { parent_id: parent }),
    })
  }

  // Regions already have a record; they gain only their gate. Two of the nine
  // are behind a story quest, and everything found in them was until now listed
  // as findable on day one.
  for (const region of placeVocab.regions) {
    const extracted = placeById.get(region.id)
    const record = resolver.locations.find((l) => l.id === region.id)
    if (extracted === undefined || record === undefined) {
      throw new Error(
        `"${region.id}" is listed as a region in curated/vocab/places.json but is ` +
          'not a location — check the id, or run `pnpm enrich:pages`.',
      )
    }
    record.unlock_quest = questName(extracted.unlockQuest)
  }

  const scheduleVocab = await readJsonFile<ScheduleVocab>(
    join(CURATED_DIR, 'vocab', 'schedules.json'),
  )
  const methodRules = await readJsonFile<MethodRules>(
    join(CURATED_DIR, 'vocab', 'method_rules.json'),
  )
  // Optional like every curated vocab that arrived late: absent means every
  // perk keeps a null effect, which was the only state before it existed.
  const { effects: perkEffects } = await readJsonFile<{ effects: Record<string, string> }>(
    join(CURATED_DIR, 'vocab', 'perk_effects.json'),
  ).catch(() => ({ effects: {} as Record<string, string> }))
  const characterRules = await readJsonFile<CharacterRules>(
    join(CURATED_DIR, 'vocab', 'characters.json'),
  )
  // Optional like perk_effects: absent means no game-only items are surfaced,
  // which was the only state before 1.0 outran the wiki.
  const { items: gameOnlyItems } = await readJsonFile<{ items: string[] }>(
    join(CURATED_DIR, 'vocab', 'items_1_0.json'),
  ).catch(() => ({ items: [] as string[] }))

  const itemByName = new Map<string, CargoRow>()
  for (const row of items) {
    const itemName = name(row.itemName)
    if (itemName === '') continue
    if (itemByName.has(itemName)) {
      throw new Error(
        `Duplicate itemName "${itemName}" in Items. The Items<->Fish join is by display ` +
          'name, so a duplicate makes it silently wrong. Resolve on the wiki or add a ' +
          'disambiguation rule before continuing.',
      )
    }
    itemByName.set(itemName, row)
  }

  return {
    items,
    fish,
    crops,
    bugs,
    artifacts,
    characters,
    giftPrefs,
    recipes,
    ingredients,
    museum,
    skills,
    festivals,
    mines,
    shops,
    quests,
    animals,
    buildings,
    waters: buildWaterIndex(watersExtract, mines, (names) =>
      resolver.locationId(names, 'wiki:Fishing'),
    ),
    places,
    monsters,
    maps,
    mapShapes,
    mapAliases,
    itemIds,
    game,
    weatherClasses,
    schedules,
    scheduleVocab,
    itemByName,
    idFor: (displayName) => {
      const display = name(displayName)
      return itemIds.internalByDisplay.get(display) ?? toSnakeId(display)
    },
    resolver,
    methodRules,
    characterRules,
    perkEffects,
    gameOnlyItems,
  }
}

/** Read a Cargo cell as plain text. */
export const text = (value: unknown): string => stripWikitext(String(value ?? ''))

/**
 * Read a Cargo cell that holds a display NAME.
 *
 * Names are plain strings in Cargo, so they never go through the wikitext
 * stripper — but they are still HTML-escaped, and nine items have an apostrophe:
 * `Mermaid&#039;s Comb`. Left undecoded, that name renders wrong, slugifies to
 * `mermaid_039_s_comb`, and silently fails to match its museum set roster (which
 * comes from page wikitext, where the apostrophe is literal).
 *
 * Entities are decoded but wikitext is not stripped, because a name legitimately
 * containing brackets should survive intact.
 */
export const name = (value: unknown): string => decodeEntities(String(value ?? '')).trim()
