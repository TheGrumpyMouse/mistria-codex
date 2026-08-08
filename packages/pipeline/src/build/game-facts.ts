/**
 * The game's extract, indexed for the builders.
 *
 * `sources/game/` is what the files say; this is what the dataset can use. The
 * translation is not mechanical, and the three interesting parts are:
 *
 * **Hours run past 24.** `[20, 26]` is 20:00 to 02:00, because the game day ends
 * at 02:00. It becomes a wrapping `TimeRange`, which the build later splits at
 * midnight — so nothing downstream ever compares `from > to`.
 *
 * **Weather is four classes, not six states.** A rule saying
 * `heavy_inclement` means storm in fall and blizzard in winter. Expanding it
 * needs the window's seasons, which is why `weatherFor` takes both.
 *
 * **A bug's `tag` is a room's `bug_tag`.** That join is the only source in the
 * project for where an insect can be caught; the wiki does not record it at all.
 * The room→location half is curated, in `curated/aliases/game_rooms.json`.
 *
 * Everything here is optional. A clone with no `sources/game/` builds fine and
 * gets the wiki's answers, which is the state the project was in before G1.
 */
import { join } from 'node:path'
import {
  fromMinutes,
  type Rarity,
  SEASONS,
  type Season,
  type TimeRange,
  WEATHERS,
  type Weather,
} from '@mistria/schema'
import type { GameArtifactsExtract, GameSealOffering } from '../extract/artifacts.js'
import type { GameCosmetic, GameCosmeticsExtract } from '../extract/cosmetics.js'
import type { GameItem, GameItemsExtract } from '../extract/items.js'
import type { GameFactory, GameMachinesExtract } from '../extract/machines.js'
import type { GameQuestsExtract, GameRequestGate, GameStoryQuest } from '../extract/quests.js'
import type {
  GameBug,
  GameCrop,
  GameFish,
  GameForageable,
  GameSpawnsExtract,
  GameTree,
} from '../extract/spawns.js'
import type { GameStore, GameStoresExtract } from '../extract/stores.js'
import type {
  GameLocation,
  GameNpc,
  GameSeasonWeather,
  GameWorldExtract,
} from '../extract/world.js'
import { CURATED_DIR, SOURCES_DIR } from '../lib/paths.js'
import { readJsonFile } from '../lib/read-json.js'

/** Game weather class -> our weather, per season. Null where it cannot occur. */
type WeatherClassMap = Record<string, Partial<Record<Season, string | null>>>

interface RoomAlias {
  location: string | null
  reason?: string
  source?: string
}

/** A fruit tree together with the sapling item that plants it. */
export interface PlantableTree {
  tree: GameTree
  /** The sapling's item id — a real item, so it can be a `seed_item_id`. */
  saplingItemId: string
  /**
   * Days from planting to the last growth stage.
   *
   * `day_to_stage` has one entry per day and its last entry is the final stage,
   * so the count of days is its length minus one — the same reading the crop
   * builder already uses, and it reproduces the wiki's fourteen.
   */
  growthDays: number
}

/**
 * Fruit trees you can plant, keyed by the fruit they yield.
 *
 * Two filters, and both matter:
 *
 * **A tree must fruit.** `tree_oak` has no `fruit_data`, and a `<..>`-style
 * fallback would have given it a harvest item called `tree_oak` — an id that
 * looks plausible enough to pass a reference check by accident.
 *
 * **Something must plant it.** The join runs from the sapling item's own
 * `sapling` field rather than from a name match, because `tree_plum_blossom`
 * fruits perfectly well and no sapling exists for it. It is a wild tree in the
 * Western Ruins, already carried as a forageable, and a name match would have
 * put a sapling in the app that no shop stocks.
 */
export function plantableTrees(trees: GameTree[], items: GameItem[]): Map<string, PlantableTree> {
  const saplingByTree = new Map<string, string>()
  for (const item of items) {
    if (item.sapling !== null) saplingByTree.set(item.sapling, item.id)
  }

  const byHarvest = new Map<string, PlantableTree>()
  for (const tree of trees) {
    const saplingItemId = saplingByTree.get(tree.id)
    if (tree.harvest === null || saplingItemId === undefined) continue
    byHarvest.set(tree.harvest, {
      tree,
      saplingItemId,
      growthDays: tree.day_to_stage.length - 1,
    })
  }
  return byHarvest
}

export interface GameFacts {
  version: string
  /** Every internal name the game declares. Confirms an id we already hold. */
  itemIds: Set<string>
  /** Display name -> internal name, for names the game uses exactly once. */
  idByDisplay: Map<string, string>
  /** Display names the game reuses. Useless for matching, so reported instead. */
  ambiguousDisplayNames: string[]
  itemById: Map<string, GameItem>
  bugById: Map<string, GameBug>
  /** One item can have several spawn rules — a fish angled and dived for. */
  fishByItem: Map<string, GameFish[]>
  forageByItem: Map<string, GameForageable[]>
  /** Keyed by the item harvesting yields, which is what our crop records key on. */
  cropByHarvest: Map<string, GameCrop>
  /**
   * Fruit trees you can actually plant, keyed by the fruit.
   *
   * Only the seven with a sapling item. `tree_plum_blossom` and `tree_coconut`
   * fruit and nothing sells you one, so they are wild trees and belong in the
   * forageable data they are already in — listing them as growable would put a
   * sapling in the app that no shop stocks.
   */
  fruitTreeByHarvest: Map<string, PlantableTree>
  npcById: Map<string, GameNpc>
  /** Wing id -> set id -> item ids, exactly as the game declares them. */
  museumSets: { wing: string; set: string; name: string | null; items: string[] }[]
  /** Bug tag -> our location ids. The room join, already resolved. */
  locationsByBugTag: Map<string, string[]>
  /** Game room ids we deliberately do not place. */
  unmappedRooms: string[]
  /** Days per 28-day season of each weather class. See extract/world.ts. */
  weather: GameSeasonWeather[]
  /**
   * Things the wiki lists as items and the game does not model as items at all.
   * An id of ours that matches one is unconfirmable by design, not by omission.
   *
   * Keyed by `wordKey`, not by the display name, because the two sources put the
   * words in different orders: the wiki's "Blue Alpaca Ribbon" is the game's
   * "Alpaca Blue Ribbon".
   */
  nonItemNames: Set<string>
  /** Null when the extract predates the artifact work — the wiki answers stand. */
  artifactFacts: ArtifactFacts | null
  /**
   * Production machines (the Apiary and Terrarium at 1.0.0), verbatim from the
   * extract. Empty when the extract predates the machine work — nothing is
   * produced by machine in that build, which was also true of the dataset.
   */
  factories: GameFactory[]
  /** Item id -> the factory whose `rewards_map` yields it. */
  factoryByProduct: Map<string, GameFactory>
  /** Request quest id -> its stated appearance gates. Empty pre-quest-extract. */
  requestGateByQuest: Map<string, GameRequestGate>
  /** Story quest id -> title, icon NPC and stated rewards. */
  storyQuestById: Map<string, GameStoryQuest>
  /** Store section key -> its stock, verbatim from `stores.toml`. */
  storeById: Map<string, GameStore>
  /** The player's wardrobe. Empty when the extract predates the cosmetics read. */
  cosmetics: GameCosmetic[]
  /** Cosmetic id -> its record, for resolving a store line. */
  cosmeticById: Map<string, GameCosmetic>
}

/** The artifact and seal extract, indexed. See `buildArtifactFacts`. */
export interface ArtifactFacts {
  /** Artifact item id -> its archaeology pool (a museum set key). */
  poolByItem: Map<string, string>
  /** Pool -> our location ids, for the pools a room states. */
  locationsByPool: Map<string, string[]>
  /** Artifact item id -> the game's own rarity. */
  rarityByItem: Map<string, Rarity | null>
  /** Mine pool -> 1-based biome position in floor order. */
  minePoolOrder: Map<string, number>
  /** Ritual chamber floor bands, ascending. */
  ritualFloors: { min: number; max: number }[]
  /** Artifact item id -> the fish rule that yields it (dived or fished). */
  fishRuleByArtifact: Map<string, GameFish>
  /** Perk id -> its title, for rendering requirements as words. */
  perkNameById: Map<string, string>
  /**
   * Skill id -> its full perk tree from the skill menu: perk id, tier,
   * essence cost. This is where a perk's owning skill is stated — perks.toml
   * itself is flat — and it is what lets the skills builder append perks the
   * wiki has not written up yet.
   */
  skillTreeBySkill: Map<string, { id: string; tier: number; essence: number | null }[]>
  /** Tier -> unlock level (index 0 = tier 1), from the skill menu defaults. */
  skillTierLevels: number[]
  seals: {
    id: string
    questId: string
    questName: string | null
    items: GameSealOffering['items']
  }[]
  /** Every stated delivery — seals, bridge repairs, upgrades. */
  offerings: GameSealOffering[]
  /**
   * Our location ids for every room that spawns a dig site, from
   * `locations.toml`. This is where the dig-material set can be dug up —
   * everywhere a dig site exists.
   */
  digSiteLocations: string[]
}

/**
 * A display name reduced to its words, sorted and folded.
 *
 * Deliberately narrow in use: this decides whether an *already unconfirmed* id
 * is one we expect to be unconfirmable, so the worst a false match can do is
 * silence one line of a warning. It must never be used to resolve an id —
 * "Golden Apple" and "Apple Golden" are the same word set and could easily be
 * two different things.
 */
export const wordKey = (name: string): string =>
  name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word !== '')
    .sort()
    .join(' ')

export interface WeatherOddsEntry {
  /** The game weather class this is drawn from. */
  pool: string
  /** The **pool's** days per season, not this weather's share of them. */
  minDays: number
  maxDays: number
  /** True when this weather is the pool's only member in this season. */
  exact: boolean
}

/**
 * How often each of our six weathers happens, per season, in days out of 28.
 *
 * The game counts two classes and we name six states, so this is a fold — and
 * the fold is lossy in a way that has to be shipped rather than hidden. Rain and
 * storm are the *same* four-to-six wet days: `heavy_inclement` is drawn from the
 * `inclement` pool and the split is nowhere in the files. Giving each of them a
 * flat range and letting a consumer add them would report twelve wet days in a
 * twenty-eight day season, which is why every entry names its pool.
 *
 * `exact` is then a property of the fold, not a hedge: a weather that is its
 * pool's only member in that season has the pool's exact count, and one that
 * shares a pool has an upper bound.
 *
 * Clear is the remainder — what is left after the other classes — so its range
 * inverts theirs: the *fewest* clear days is 28 minus the most of everything else.
 */
export function weatherOdds(
  weather: GameSeasonWeather[],
  map: WeatherClassMap,
  daysPerSeason: number,
): Record<string, Record<string, WeatherOddsEntry>> {
  const odds: Record<string, Record<string, WeatherOddsEntry>> = {}

  for (const row of weather) {
    const season = row.season
    if (!isSeason(season)) continue

    const bySeason: Record<string, WeatherOddsEntry> = {}
    const set = (pool: string, cls: string, minDays: number, maxDays: number): void => {
      const name = map[cls]?.[season]
      if (typeof name !== 'string' || !isWeather(name)) return
      bySeason[name] = { pool, minDays, maxDays, exact: false }
    }

    const [incMin, incMax] = row.inclement
    const [spMin, spMax] = row.special

    set('inclement', 'inclement', incMin, incMax)
    set('inclement', 'heavy_inclement', incMin, incMax)
    set('special', 'special', spMin, spMax)
    set('calm', 'calm', Math.max(0, daysPerSeason - incMax - spMax), daysPerSeason - incMin - spMin)

    // A pool with one member in this season gives that member its exact count.
    // Summer's `special` maps to nothing at all, so `heavy_inclement` there is
    // the storm alone — this is computed rather than asserted for that reason.
    const perPool = new Map<string, number>()
    for (const entry of Object.values(bySeason)) {
      perPool.set(entry.pool, (perPool.get(entry.pool) ?? 0) + 1)
    }
    for (const entry of Object.values(bySeason)) {
      entry.exact = perPool.get(entry.pool) === 1
    }

    odds[season] = bySeason
  }

  return odds
}

/**
 * Rarity words the game uses, folded onto our five.
 *
 * The game grades fish commonness five ways below `uncommon`; we grade it once.
 * Losing that detail is deliberate — the app says "common", and a scale nobody
 * renders is a field that only ever goes stale. The chest and junk tiers are
 * absent on purpose: those rules yield driftwood and treasure boxes, and
 * "junk" is not how rare a thing is.
 */
const RARITY_BY_GAME_WORD: Record<string, Rarity> = {
  ultra_common: 'common',
  very_very_common: 'common',
  very_common: 'common',
  common: 'common',
  uncommon: 'uncommon',
  kinda_rare: 'rare',
  rare: 'rare',
  very_rare: 'epic',
  legendary: 'legendary',
}

export const rarityFor = (word: string | null): Rarity | null =>
  word === null ? null : (RARITY_BY_GAME_WORD[word] ?? null)

const isSeason = (value: string): value is Season => (SEASONS as readonly string[]).includes(value)
const isWeather = (value: string): value is Weather =>
  (WEATHERS as readonly string[]).includes(value)

/** The game's season list, or every season when it declares none. */
export function seasonsFor(seasons: string[] | null): Season[] {
  if (seasons === null) return [...SEASONS]
  const known = seasons.filter(isSeason)
  // An unrecognised season name is a vocabulary change, and silently narrowing
  // to the ones we understood would quietly delete availability. All-or-nothing.
  return known.length === seasons.length && known.length > 0 ? known : [...SEASONS]
}

/**
 * `[6, 26]` -> `06:00 -> 02:00`.
 *
 * Null for a rule with no hour restriction, which the caller must read as *any
 * time* rather than *no time*. A window covering the whole game day (06:00 to
 * 02:00) is also null: it is a restriction that restricts nothing, and storing
 * it would badge every daytime bug with a time constraint the player never feels.
 */
export function hoursToRange(hours: [number, number] | null): TimeRange | null {
  if (hours === null) return null
  const [from, to] = hours
  if (from === to) return null
  if (from === 6 && to === 26) return null
  return { from: fromMinutes(from * 60), to: fromMinutes(to * 60) }
}

/**
 * Expand the game's weather classes across a window's seasons.
 *
 * Null means the rule states no weather restriction, which is *all* weather —
 * the caller decides what to do with that, because "all" is season-dependent and
 * the existing narrowing already handles it.
 */
export function weatherFor(
  classes: string[] | null,
  seasons: Season[],
  map: WeatherClassMap,
): Weather[] | null {
  if (classes === null) return null

  const out = new Set<Weather>()
  for (const cls of classes) {
    const bySeason = map[cls]
    if (bySeason === undefined) continue
    for (const season of seasons) {
      const weather = bySeason[season]
      if (typeof weather === 'string' && isWeather(weather)) out.add(weather)
    }
  }

  // A class list that expanded to nothing is either a vocabulary change or a
  // rule that cannot fire in these seasons. Either way it is not "no weather",
  // which would read as impossible; it is unknown, and null says so.
  return out.size > 0 ? [...out].sort() : null
}

/**
 * Every weather the game allows in these seasons.
 *
 * This is what a rule's `weather = false` means, and it must not be confused
 * with unknown: the file states there is no restriction, so the answer is *all*,
 * and the badge stays off. Derived from the same class map rather than from
 * `SEASON_LEGAL_WEATHER`, so the game's narrower claim about wind — spring and
 * fall only — holds for game-sourced windows without changing the app's mask.
 */
export const allGameWeather = (seasons: Season[], map: WeatherClassMap): Weather[] | null =>
  weatherFor(Object.keys(map), seasons, map)

/** A rule's weather, with `no restriction` expanded rather than left unknown. */
export const statedWeather = (
  classes: string[] | null,
  seasons: Season[],
  map: WeatherClassMap,
): Weather[] | null => weatherFor(classes, seasons, map) ?? allGameWeather(seasons, map)

function indexItems(
  items: GameItem[],
): Pick<GameFacts, 'itemIds' | 'idByDisplay' | 'ambiguousDisplayNames' | 'itemById'> {
  const itemIds = new Set<string>()
  const itemById = new Map<string, GameItem>()
  const idByDisplay = new Map<string, string>()
  const ambiguous = new Set<string>()

  for (const item of items) {
    itemIds.add(item.id)
    itemById.set(item.id, item)
    if (item.name === null) continue
    if (idByDisplay.has(item.name)) ambiguous.add(item.name)
    else idByDisplay.set(item.name, item.id)
  }

  // 331 display names are shared, nearly all of them furniture colourways —
  // fifteen chests are all "Basic Wood Chest". A shared name cannot identify one
  // item, so it identifies none, and the ambiguity is reported rather than
  // resolved by taking whichever came first.
  for (const name of ambiguous) idByDisplay.delete(name)

  return {
    itemIds,
    itemById,
    idByDisplay,
    ambiguousDisplayNames: [...ambiguous].sort(),
  }
}

export async function loadGameFacts(): Promise<GameFacts | null> {
  const game = join(SOURCES_DIR, 'game')
  const items = await readJsonFile<GameItemsExtract>(join(game, 'items.json')).catch(() => null)
  if (items === null) return null

  const [spawns, world] = await Promise.all([
    readJsonFile<GameSpawnsExtract>(join(game, 'spawns.json')),
    readJsonFile<GameWorldExtract>(join(game, 'world.json')),
  ])

  const { rooms } = await readJsonFile<{ rooms: Record<string, RoomAlias> }>(
    join(CURATED_DIR, 'aliases', 'game_rooms.json'),
  )

  const fishByItem = new Map<string, GameFish[]>()
  for (const rule of spawns.fish) {
    fishByItem.set(rule.item, [...(fishByItem.get(rule.item) ?? []), rule])
  }

  const forageByItem = new Map<string, GameForageable[]>()
  for (const row of spawns.forageables) {
    forageByItem.set(row.item, [...(forageByItem.get(row.item) ?? []), row])
  }

  // Keyed by harvest, not by crop id: `ash_mushroom` the plant and the item it
  // yields share a name, but `mystery_bag` does not, and our crop records are
  // keyed by the item.
  //
  // **A harvest is not a unique key, and one entry lies about it.** Two things
  // in `crop.toml` claim to harvest a marigold — the crop, and
  // `temple_marigold`, a forageable — so a plain `set` let the forageable
  // overwrite the crop and report the marigold as growing in nought days.
  // And `mystery_bag` declares `harvest = "apple"` above a comment reading
  // `# this is just a lie, for fun!`; it is the Magic Seed, which grows
  // something random. Both are filtered here rather than by every caller:
  //
  // - anything with a single growth stage is picked, not grown (see CLAUDE.md),
  //   which is exactly what `temple_marigold` is;
  // - the declared liar is named, with its citation;
  // - and a surviving collision keeps the first entry rather than the last,
  //   because "whichever came last in the file" is not a decision.
  const CROP_HARVEST_LIARS = new Set(['mystery_bag'])
  const cropByHarvest = new Map<string, GameCrop>()
  for (const crop of spawns.crops) {
    if (CROP_HARVEST_LIARS.has(crop.id)) continue
    if (crop.day_to_stage.length <= 1) continue
    if (!cropByHarvest.has(crop.harvest)) cropByHarvest.set(crop.harvest, crop)
  }

  const fruitTreeByHarvest = plantableTrees(spawns.trees ?? [], items.items)

  // Optional, like everything else here: a clone whose extract predates the
  // artifact work still builds, and its artifacts keep the wiki's answers.
  const artifactExtract = await readJsonFile<GameArtifactsExtract>(
    join(game, 'artifacts.json'),
  ).catch(() => null)

  const machinesExtract = await readJsonFile<GameMachinesExtract>(
    join(game, 'machines.json'),
  ).catch(() => null)
  const questsExtract = await readJsonFile<GameQuestsExtract>(join(game, 'quests.json')).catch(
    () => null,
  )
  const storesExtract = await readJsonFile<GameStoresExtract>(join(game, 'stores.json')).catch(
    () => null,
  )
  const cosmeticsExtract = await readJsonFile<GameCosmeticsExtract>(
    join(game, 'cosmetics.json'),
  ).catch(() => null)
  const cosmetics = cosmeticsExtract?.cosmetics ?? []
  const factories = machinesExtract?.factories ?? []
  const factoryByProduct = new Map<string, GameFactory>()
  for (const factory of factories) {
    for (const product of factory.rewards_map.flat()) {
      factoryByProduct.set(product, factory)
    }
  }

  const locationsByBugTag = new Map<string, string[]>()
  const unmappedRooms: string[] = []
  for (const room of world.locations) {
    if (room.bug_tags.length === 0) continue
    const alias = rooms[room.id]
    // An explicit null is a decision — the Dragonsworn Glade is a landmark
    // inside the Deep Woods, not a location of ours. An absent entry is a room
    // nobody has looked at, and only that is worth reporting.
    if (alias === undefined) {
      unmappedRooms.push(room.id)
      continue
    }
    if (alias.location === null) continue
    for (const tag of room.bug_tags) {
      const list = locationsByBugTag.get(tag) ?? []
      if (!list.includes(alias.location)) list.push(alias.location)
      locationsByBugTag.set(tag, list.sort())
    }
  }

  return {
    version: items.gameVersion,
    ...indexItems(items.items),
    bugById: new Map(spawns.bugs.map((bug) => [bug.id, bug] as const)),
    fishByItem,
    forageByItem,
    cropByHarvest,
    fruitTreeByHarvest,
    npcById: new Map(world.npcs.map((npc) => [npc.id, npc] as const)),
    museumSets: world.museum.flatMap((wing) =>
      wing.sets.map((set) => ({ wing: wing.id, set: set.id, name: set.name, items: set.items })),
    ),
    locationsByBugTag,
    unmappedRooms: unmappedRooms.sort(),
    weather: world.weather,
    nonItemNames: new Set(
      (world.animalCosmetics ?? []).flatMap((c) => (c.name === null ? [] : [wordKey(c.name)])),
    ),
    factories,
    factoryByProduct,
    requestGateByQuest: new Map(
      (questsExtract?.requestGates ?? []).map((gate) => [gate.quest_id, gate] as const),
    ),
    storyQuestById: new Map(
      (questsExtract?.storyQuests ?? []).map((quest) => [quest.id, quest] as const),
    ),
    storeById: new Map((storesExtract?.stores ?? []).map((store) => [store.id, store] as const)),
    cosmetics,
    cosmeticById: new Map(cosmetics.map((cosmetic) => [cosmetic.id, cosmetic] as const)),
    artifactFacts:
      artifactExtract === null
        ? null
        : buildArtifactFacts(
            artifactExtract,
            world.museum,
            spawns.fish,
            world.locations,
            rooms,
            unmappedRooms,
          ),
  }
}

/**
 * The artifact extract, joined into something the builders can consume.
 *
 * The chain the whole feature rests on: `artifacts.toml [locations]` names a
 * *pool* per game room, the archaeology wing's set keys **are** those pool
 * names, and set membership names every item in a pool. Room -> our location
 * goes through `curated/aliases/game_rooms.json`, the same file the bug-room
 * join already trusts — an unmapped room lands in `unmappedRooms` and warns,
 * rather than silently dropping a pool.
 */
export function buildArtifactFacts(
  extract: GameArtifactsExtract,
  museum: GameWorldExtract['museum'],
  fish: GameFish[],
  gameLocations: GameLocation[],
  rooms: Record<string, RoomAlias>,
  unmappedRooms: string[],
): ArtifactFacts {
  const archaeology = museum.find((wing) => wing.id === 'archaeology')

  const poolByItem = new Map<string, string>()
  for (const set of archaeology?.sets ?? []) {
    for (const item of set.items) poolByItem.set(item, set.id)
  }

  const locationsByPool = new Map<string, string[]>()
  for (const [room, pool] of Object.entries(extract.poolByRoom)) {
    const alias = rooms[room]
    if (alias === undefined) {
      unmappedRooms.push(room)
      continue
    }
    if (alias.location === null) continue
    const list = locationsByPool.get(pool) ?? []
    if (!list.includes(alias.location)) list.push(alias.location)
    locationsByPool.set(pool, list.sort())
  }

  const rarityByItem = new Map<string, Rarity | null>()
  for (const [item, word] of Object.entries(extract.lootRarity)) {
    rarityByItem.set(item, rarityFor(word))
  }

  // File order is floor order, so the biome at index N is the Nth biome
  // counting down — which is how the builder joins it to the curated mines
  // file without ever trusting the game's own floor starts (they disagree
  // off-by-one with the ranges the wiki and curated file state).
  const minePoolOrder = new Map<string, number>()
  for (const biome of extract.mineBiomes) {
    if (biome.artifact_set !== null) minePoolOrder.set(biome.artifact_set, biome.index)
  }

  const ritualFloors = extract.ritualChambers
    .map((chamber) => ({ min: chamber.floors[0], max: chamber.floors[1] }))
    .sort((a, b) => a.min - b.min)

  // (D1) The fished and dived artifact rules yield `unidentified_artifact` —
  // the rule's own id is the artifact. `fishByItem` can never find them, so
  // they get their own index.
  const fishRuleByArtifact = new Map<string, GameFish>()
  for (const rule of fish) {
    if (rule.item === 'unidentified_artifact') fishRuleByArtifact.set(rule.id, rule)
  }

  const offeringsByQuest = new Map(extract.sealOfferings.map((o) => [o.quest_id, o] as const))
  const seals = extract.seals.map((seal) => {
    const offering = offeringsByQuest.get(seal.quest_id)
    return {
      id: seal.id,
      questId: seal.quest_id,
      questName: offering?.quest_name ?? null,
      items: offering?.items ?? [],
    }
  })

  return {
    poolByItem,
    locationsByPool,
    rarityByItem,
    minePoolOrder,
    ritualFloors,
    fishRuleByArtifact,
    perkNameById: new Map(
      extract.perks.flatMap((perk) => (perk.name === null ? [] : [[perk.id, perk.name] as const])),
    ),
    skillTreeBySkill: new Map(
      (extract.skillTrees ?? []).map((tree) => [tree.skill, tree.perks] as const),
    ),
    skillTierLevels: extract.skillTierLevels ?? [],
    seals,
    offerings: extract.sealOfferings,
    digSiteLocations: [
      ...new Set(
        gameLocations
          .filter((room) => (room.dig_sites ?? 0) > 0 || (room.special_dig_sites ?? 0) > 0)
          .flatMap((room) => {
            const alias = rooms[room.id]
            return alias?.location == null ? [] : [alias.location]
          }),
      ),
    ].sort(),
  }
}

export async function loadWeatherClasses(): Promise<WeatherClassMap> {
  const vocab = await readJsonFile<{ gameClasses?: WeatherClassMap }>(
    join(CURATED_DIR, 'vocab', 'weather.json'),
  )
  return vocab.gameClasses ?? {}
}
