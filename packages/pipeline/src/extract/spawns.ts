/**
 * What spawns, when, and where — `fish.toml`, `bugs.toml`, `forageables.toml`
 * and the crop prototypes.
 *
 * This is the half of G1 that is not about ids. The wiki records 801 of 832
 * availability rules with no time of day at all, because `Fish` has no time
 * column and `Bugs.time` is loose prose. The game states hours as numbers.
 *
 * Two conventions run through every file here and both bite if read literally:
 *
 * **`false` means unrestricted, not empty.** `weather = false` on a fish means
 * it bites in every weather. Stored as an empty list it would mean the opposite.
 * Everything below emits `null` for it, and every consumer must read null as
 * *all* — which is the same "unknown does not exclude" rule the app already runs
 * on, arrived at from the other direction.
 *
 * **Hours run past 24.** `hours = [20, 26]` is 8pm to 2am, because the game day
 * ends at 02:00. A reader that clamps to 24 loses the entire night window, and a
 * reader that treats 26 as a literal hour produces a window no clock can match.
 */
import {
  bool,
  defaults,
  entries,
  field,
  num,
  range,
  readToml,
  resolveIn,
  str,
  strList,
  type Table,
  table,
} from './toml.js'

/** The game's four weather classes. Season decides what each one looks like. */
export type GameWeatherClass = 'calm' | 'inclement' | 'heavy_inclement' | 'special'

export interface GameFish {
  /** The fish's own id — a spawn rule, not necessarily an item. */
  id: string
  /** The item it yields. `<..>` means "the item of the same name". */
  item: string
  seasons: string[] | null
  /** `[from, to]` in hours, `to` running past 24 for a window crossing midnight. */
  hours: [number, number] | null
  water_type: string[] | null
  weather: string[] | null
  /** Named locations, on the few rules that restrict to one. Null means anywhere. */
  locations: string[] | null
  size: string | null
  any_size: boolean | null
  legendary: boolean | null
  rarity: string | null
  /** `fishing`, `divespot`, `mines`. */
  retrieval: string[] | null
  is_chest: boolean | null
  /** A perk the player needs before this can spawn at all. */
  has_perk: string | null
  /**
   * The perk that lets this artifact rule fire — `sunken_secrets` on dive
   * spots, `aquatic_antiquities` on fishing. A perk name, not a flag: the
   * `[default]` is `false` ("no perk"), which `str` correctly reads as null.
   * An earlier reading used `bool()` here and silently nulled all ten rules.
   */
  perk_artifact: string | null
  /** Spawns only from bait, and is absent from the normal distribution. */
  bait_only: boolean | null
}

export interface GameBug {
  id: string
  seasons: string[] | null
  hours: [number, number] | null
  weather: string[] | null
  rarity: string | null
  /**
   * Which rooms it spawns in, matched against a location's own `bug_tag`.
   * This is the join that puts a bug on the map.
   */
  tags: string[]
  /** `default`, `canopy`, `rock` — how it is placed in the room. */
  spawn: string[] | null
  can_spawn_on_water: boolean | null
  /** -1 for "any biome"; otherwise the dungeon biome it is restricted to. */
  dungeon_biome: number | null
  /** Spawns only from pheromones, and is absent from the normal distribution. */
  pheromones_only: boolean | null
}

export interface GameForageable {
  item: string
  season: string
  rarity: string
  /** Beach forageables the game files under `common` with a sand condition. */
  sand: boolean
}

export interface GameCrop {
  id: string
  /** The item harvesting yields. */
  harvest: string
  seasons: string[] | null
  /**
   * Sprite stage per day of growth. Its length is the number of days from
   * sowing to the final stage, which is why growth time is derivable from it.
   */
  day_to_stage: number[]
  /** Non-zero means the plant survives harvest and fruits again this often. */
  regrow_days: number | null
  /** How many items one harvest yields. */
  count: number | null
  is_plant: boolean | null
}

/**
 * A tree that fruits — the other half of farming, and the half the wiki's Cargo
 * `Crops` table does not have.
 *
 * `crop.toml` looks like it should hold everything you plant, and it does not:
 * fruit trees are a separate object prototype with a `fruit_data` subtable, and
 * nine of them exist. Four of the nine reached `data/` because the wiki files
 * them under Crops; Lemon, Peach and Pear did not, and shipped as items with an
 * empty availability and an `obtain_method` gap. The app could not answer "where
 * do I get a lemon" at all.
 *
 * `day_to_stage` lives on the tree rather than in `fruit_data`, and the default
 * covers every tree — all nine take the same fifteen entries to reach the last
 * stage.
 */
export interface GameTree {
  /** `tree_lemon`. Not an item id and not a crop id. */
  id: string
  /** The item picking it yields. Absent on the timber trees, which do not fruit. */
  harvest: string | null
  seasons: string[] | null
  regrow_days: number | null
  /**
   * How many fruit one tree carries, counted from the sprite positions the game
   * declares for them. Three positions is three fruit; nothing else states the
   * number, and the wiki independently says three.
   */
  yield: number | null
  day_to_stage: number[]
}

export interface GameSpawnsExtract {
  gameVersion: string
  fish: GameFish[]
  bugs: GameBug[]
  forageables: GameForageable[]
  crops: GameCrop[]
  trees: GameTree[]
}

const numList = (value: unknown): number[] =>
  Array.isArray(value) ? value.map(num).filter((n): n is number => n !== null) : []

const byId = <T extends { id: string }>(rows: T[]): T[] =>
  rows.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

export async function extractFish(root: string): Promise<GameFish[]> {
  const doc = await readToml(resolveIn(root, 'fiddle', 'fish.toml'))
  const base = defaults(doc)

  const fish = entries(doc).map(([id, entry]): GameFish => {
    const get = (key: string): unknown => field(entry, base, key)
    return {
      id,
      // `item = "<..>"` means the item shares the rule's name, which `str`
      // reports as null. Resolving it here keeps the sentinel out of the extract.
      item: str(get('item')) ?? id,
      seasons: strList(get('seasons')),
      hours: range(get('hours')),
      water_type: strList(get('water_type')),
      weather: strList(get('weather')),
      locations: strList(get('locations')),
      size: str(get('size')),
      any_size: bool(get('any_size')),
      legendary: bool(get('legendary')),
      rarity: str(get('rarity')),
      retrieval: strList(get('retrieval')),
      is_chest: bool(get('is_chest')),
      has_perk: str(get('has_perk')),
      perk_artifact: str(get('perk_artifact')),
      bait_only: bool(get('bait_only')),
    }
  })

  if (fish.length === 0) throw new Error('fiddle/fish.toml parsed to zero spawn rules.')
  return byId(fish)
}

export async function extractBugs(root: string): Promise<GameBug[]> {
  const doc = await readToml(resolveIn(root, 'fiddle', 'bugs.toml'))
  const base = defaults(doc)

  const bugs = entries(doc).map(([id, entry]): GameBug => {
    const get = (key: string): unknown => field(entry, base, key)
    return {
      id,
      seasons: strList(get('seasons')),
      hours: range(get('hours')),
      weather: strList(get('weather')),
      rarity: str(get('rarity')),
      // Singular in the game, plural here: it is a list everywhere it is used,
      // and the singular name is what made the room join easy to miss.
      tags: strList(get('tag')) ?? [],
      spawn: strList(get('spawn')),
      can_spawn_on_water: bool(get('can_spawn_on_water')),
      dungeon_biome: num(get('dungeon_biome')),
      pheromones_only: bool(get('pheromones_only')),
    }
  })

  if (bugs.length === 0) throw new Error('fiddle/bugs.toml parsed to zero spawn rules.')
  return byId(bugs)
}

/** The rarity buckets `forageables.toml` groups each season's items into. */
const FORAGE_RARITIES = ['common', 'uncommon', 'rare', 'legendary'] as const

export async function extractForageables(root: string): Promise<GameForageable[]> {
  const doc = await readToml(resolveIn(root, 'fiddle', 'forageables.toml'))
  const sand = new Set(strList(doc.sand_forageables) ?? [])

  const out: GameForageable[] = []
  // `[votes]` is the spawn weighting table, not a season. Anything else with
  // rarity buckets is one, so seasons are found rather than assumed — a fifth
  // season would appear in the diff instead of being dropped.
  for (const [season, entry] of entries(doc, { skip: ['default', 'votes'] })) {
    for (const rarity of FORAGE_RARITIES) {
      for (const item of strList((entry as Table)[rarity]) ?? []) {
        out.push({ item, season, rarity, sand: sand.has(item) })
      }
    }
  }

  if (out.length === 0) throw new Error('fiddle/forageables.toml parsed to zero forageables.')
  return out.sort((a, b) =>
    a.item !== b.item ? (a.item < b.item ? -1 : 1) : a.season < b.season ? -1 : 1,
  )
}

export async function extractCrops(root: string): Promise<GameCrop[]> {
  const doc = await readToml(resolveIn(root, 'fiddle', 'object_prototypes', 'crop.toml'))
  const base = defaults(doc)

  const crops = entries(doc).map(([id, entry]): GameCrop => {
    const get = (key: string): unknown => field(entry, base, key)
    return {
      id,
      harvest: str(get('harvest')) ?? id,
      // The default is `seasons = -1`, a "you must set this" marker rather than
      // a value; `strList` reports it as null, which reads as unrestricted.
      seasons: strList(get('seasons')),
      day_to_stage: numList(get('day_to_stage')),
      regrow_days: num(get('regrow_days')),
      count: num(get('count')),
      is_plant: bool(get('is_plant')),
    }
  })

  if (crops.length === 0) throw new Error('crop.toml parsed to zero crops.')
  return byId(crops)
}

export async function extractTrees(root: string): Promise<GameTree[]> {
  const doc = await readToml(resolveIn(root, 'fiddle', 'object_prototypes', 'tree.toml'))
  const base = defaults(doc)

  const trees = entries(doc).map(([id, entry]): GameTree => {
    const fruit = table(entry.fruit_data)
    const positions = fruit === null ? null : fruit.positions

    return {
      id,
      // No `<..>` fallback here, unlike a crop. A timber tree has no
      // `fruit_data` at all, and `tree_oak` yielding an item called `tree_oak`
      // is exactly the kind of plausible id that would pass every reference
      // check by accident.
      harvest: str(fruit?.harvest),
      seasons: strList(fruit?.seasons),
      regrow_days: num(fruit?.regrow_days),
      yield: Array.isArray(positions) ? positions.length : null,
      day_to_stage: numList(field(entry, base, 'day_to_stage')),
    }
  })

  if (trees.length === 0) throw new Error('tree.toml parsed to zero trees.')
  return byId(trees)
}

export async function extractSpawns(root: string, gameVersion: string): Promise<GameSpawnsExtract> {
  const [fish, bugs, forageables, crops, trees] = await Promise.all([
    extractFish(root),
    extractBugs(root),
    extractForageables(root),
    extractCrops(root),
    extractTrees(root),
  ])
  return { gameVersion, fish, bugs, forageables, crops, trees }
}
