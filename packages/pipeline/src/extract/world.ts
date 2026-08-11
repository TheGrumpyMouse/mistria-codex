/**
 * The world around the items — museum wings, villagers, and rooms.
 *
 * Three things here are worth more than they look:
 *
 * **The museum wings are the set roster, stated.** `curated/` has carried 82
 * hand-transcribed sets since D3, and the wings declare exactly 82 with 409
 * items. That the two agree is the useful outcome; that the game says so is what
 * makes it checkable rather than believed.
 *
 * **Every villager has a birthday here.** The wiki has 33 of 34.
 *
 * **A bug's `tag` and a room's `bug_tag` are the same vocabulary**, which is the
 * join that puts an insect on a map. Nothing on the wiki expresses it.
 *
 * Not taken: `bio`, `job`, set descriptions, gossip lines, barks. All of those
 * are the game's writing. Names, ids, dates and lists of ids are not.
 */
import { join } from 'node:path'
import {
  bool,
  defaults,
  entries,
  field,
  num,
  readToml,
  resolveIn,
  str,
  strList,
  table,
  tomlFiles,
} from './toml.js'

export interface GameMuseumSet {
  /** `sets.<id>` — unique within its wing, not across the museum. */
  id: string
  name: string | null
  /** Item ids, in the order the game lists them. */
  items: string[]
}

export interface GameMuseumReward {
  /**
   * Position in the wing's reward list.
   *
   * Rewards are declared as a bare `[[rewards]]` array with no set key. There
   * are as many as there are sets, which suggests they pair by order — but
   * "suggests" is not a fact, so they are emitted unpaired and nothing joins
   * them to a set until something states the pairing.
   */
  index: number
  items: string[]
  cosmetics: string[]
  crafting_scrolls: string[]
}

export interface GameMuseumWing {
  /** File stem — `fish`, `insect`, `flora`, `archaeology`. */
  id: string
  name: string | null
  sets: GameMuseumSet[]
  rewards: GameMuseumReward[]
}

export interface GameNpc {
  id: string
  name: string | null
  birthday: { season: string; day: number } | null
  tags: string[]
  dateable: boolean | null
  /** Item ids. The game states these exactly; the wiki infers them per item. */
  loved_gifts: string[]
  liked_gifts: string[]
  /** Item *tags*, not ids — a whole class of thing this villager dislikes. */
  disliked_gift_tags: string[]
  /** Tags that cannot be given at all, distinct from merely disliked. */
  banned_gift_tags: string[]
  /** The one item they hate. Singular in the game. */
  hated_gift: string | null
  children: string[]
}

export interface GameLocation {
  id: string
  name: string | null
  outdoor: boolean | null
  farm: boolean | null
  /** Bug classes that spawn here. Matches a bug's own `tags`. */
  bug_tags: string[]
  /** How many forageables the room tries to spawn each day. */
  forageables: number | null
  /** How many bugs the room tries to spawn on entry. */
  bugs: number | null
  dig_sites: number | null
  special_dig_sites: number | null
  /** A villager farms here (Celine, Hayden). */
  npc_farm: boolean | null
  /** Greenhouses, where a crop's season does not apply. */
  ignore_seasons: boolean | null
  /**
   * The outdoor map this room sits on, as the game states it — Celine's
   * Cottage carries `map_location = "town"`. The join that places an interior
   * schedule stop somewhere a player can be sent.
   */
  map_location: string | null
}

/**
 * How many days of each weather a season gets.
 *
 * This is the only honest source of odds in the project, and the reverse-lookup
 * screen needs it: weather is rolled per season, so "when can I next catch this"
 * cannot name a date for anything weather-gated. It can say *how often*.
 *
 * `weather.toml` counts two classes and not four. `heavy_inclement` is drawn
 * from the same pool as `inclement` and the split is not stated anywhere, so a
 * storm's own odds are unknown — "some of the season's wet days" is the true
 * answer and the extract must not pretend to a better one.
 */
export interface GameSeasonWeather {
  season: string
  /** `[min, max]` days per 28-day season. */
  inclement: [number, number]
  special: [number, number]
}

/**
 * A hat for a chicken.
 *
 * Extracted for one reason: **the wiki calls these items and the game does
 * not.** They live under `[cosmetics.*]` in `ranching/animals/`, outside the
 * `ItemId` enum entirely, so 134 of our item records can never be confirmed
 * against the game — and without this list that reads as a hole in the
 * extraction rather than as a difference of opinion about what an item is.
 *
 * A gate that cannot ever go green teaches everyone to skim past the ones that
 * can. This is what lets `validate` subtract them and report only the residue.
 */
/** One room from `locations.toml`, plus which outdoor map it sits on. */
export interface GameAnimalCosmetic {
  /** The animal it belongs to — the file stem. */
  animal: string
  /** `cosmetics.<key>`, unique within its animal and not across them. */
  key: string
  name: string | null
}

export interface GameWorldExtract {
  gameVersion: string
  museum: GameMuseumWing[]
  npcs: GameNpc[]
  locations: GameLocation[]
  weather: GameSeasonWeather[]
  animalCosmetics: GameAnimalCosmetic[]
}

function readRewards(value: unknown): GameMuseumReward[] {
  if (!Array.isArray(value)) return []

  return value.map((raw, index): GameMuseumReward => {
    const reward = table(raw)
    const list = Array.isArray(reward?.entries) ? reward.entries : []
    const pick = (key: string): string[] =>
      list.map((e) => str(table(e)?.[key])).filter((v): v is string => v !== null)

    return {
      index,
      items: pick('item'),
      cosmetics: pick('cosmetic'),
      crafting_scrolls: pick('crafting_scroll'),
    }
  })
}

export async function extractMuseum(root: string): Promise<GameMuseumWing[]> {
  const files = await tomlFiles(root, join('fiddle', 'museum_wings'))
  if (files.length === 0) throw new Error('fiddle/museum_wings/ holds no TOML files.')

  const wings: GameMuseumWing[] = []
  for (const file of files) {
    const doc = await readToml(resolveIn(root, 'fiddle', 'museum_wings', file))
    const sets = table(doc.sets) ?? {}

    wings.push({
      id: file.replace(/\.toml$/, ''),
      name: str(doc.name),
      sets: entries(sets, { skip: [] })
        .map(
          ([id, entry]): GameMuseumSet => ({
            id,
            name: str(entry.name),
            items: strList(entry.items) ?? [],
          }),
        )
        .sort((a, b) => (a.id < b.id ? -1 : 1)),
      rewards: readRewards(doc.rewards),
    })
  }

  const total = wings.reduce((n, w) => n + w.sets.length, 0)
  if (total === 0) throw new Error('museum_wings/ declared no sets.')
  return wings.sort((a, b) => (a.id < b.id ? -1 : 1))
}

export async function extractNpcs(root: string): Promise<GameNpc[]> {
  const files = await tomlFiles(root, join('fiddle', 'npcs'))
  if (files.length === 0) throw new Error('fiddle/npcs/ holds no TOML files.')

  const npcs: GameNpc[] = []
  for (const file of files) {
    const doc = await readToml(resolveIn(root, 'fiddle', 'npcs', file))
    const birthday = table(doc.birthday)
    const season = str(birthday?.season)
    const day = num(birthday?.day)

    npcs.push({
      id: file.replace(/\.toml$/, ''),
      name: str(doc.name),
      // Both halves or neither. A season with no day is not a birthday, and
      // half a date is the kind of value that renders as "Spring undefined".
      birthday: season !== null && day !== null ? { season, day } : null,
      tags: strList(doc.tags) ?? [],
      dateable: bool(doc.dateable),
      loved_gifts: strList(doc.loved_gifts) ?? [],
      liked_gifts: strList(doc.liked_gifts) ?? [],
      disliked_gift_tags: strList(doc.disliked_gift_tags) ?? [],
      banned_gift_tags: strList(doc.banned_gift_tags) ?? [],
      hated_gift: str(doc.hated_gift),
      children: strList(doc.children) ?? [],
    })
  }

  return npcs.sort((a, b) => (a.id < b.id ? -1 : 1))
}

export async function extractLocations(root: string): Promise<GameLocation[]> {
  const doc = await readToml(resolveIn(root, 'fiddle', 'locations.toml'))
  const base = defaults(doc)

  const locations = entries(doc).map(([id, entry]): GameLocation => {
    const get = (key: string): unknown => field(entry, base, key)
    return {
      id,
      // The default is the literal string "MISSING NAME" — a marker for an
      // indoor room that never shows one, not a name. Only a room's own name
      // counts, so it is read off the entry rather than through the default.
      name: str(entry.name),
      outdoor: bool(get('outdoor')),
      farm: bool(get('farm')),
      bug_tags: strList(get('bug_tag')) ?? [],
      forageables: num(get('forageables')),
      bugs: num(get('bugs')),
      dig_sites: num(get('dig_sites')),
      special_dig_sites: num(get('special_dig_sites')),
      npc_farm: bool(get('npc_farm')),
      ignore_seasons: bool(get('ignore_seasons')),
      map_location: str(entry.map_location),
    }
  })

  if (locations.length === 0) throw new Error('fiddle/locations.toml parsed to zero locations.')
  return locations.sort((a, b) => (a.id < b.id ? -1 : 1))
}

export async function extractWeather(root: string): Promise<GameSeasonWeather[]> {
  const doc = await readToml(resolveIn(root, 'fiddle', 'weather.toml'))
  const counts = table(doc.seasonal_counts)
  if (counts === null) throw new Error('fiddle/weather.toml has no [seasonal_counts].')

  const out: GameSeasonWeather[] = []
  for (const [season, entry] of entries(counts, { skip: [] })) {
    const inclement = twoNumbers(entry.inclement)
    const special = twoNumbers(entry.special)
    // Both or neither. Half a range would render as "4 to undefined days".
    if (inclement === null || special === null) continue
    out.push({ season, inclement, special })
  }

  if (out.length === 0) throw new Error('[seasonal_counts] declared no seasons.')
  return out.sort((a, b) => (a.season < b.season ? -1 : 1))
}

const twoNumbers = (value: unknown): [number, number] | null => {
  if (!Array.isArray(value) || value.length !== 2) return null
  const min = num(value[0])
  const max = num(value[1])
  return min === null || max === null ? null : [min, max]
}

export async function extractAnimalCosmetics(root: string): Promise<GameAnimalCosmetic[]> {
  const files = await tomlFiles(root, join('fiddle', 'ranching', 'animals'))
  const out: GameAnimalCosmetic[] = []

  for (const file of files) {
    const doc = await readToml(resolveIn(root, 'fiddle', 'ranching', 'animals', file))
    const cosmetics = table(doc.cosmetics)
    if (cosmetics === null) continue

    for (const [key, entry] of entries(cosmetics, { skip: ['default'] })) {
      // `[cosmetics.default.male]` is a base sprite, not a hat. Only an entry
      // with a display name is a thing a player can own.
      const name = str(entry.name)
      if (name === null) continue
      out.push({ animal: file.replace(/\.toml$/, ''), key, name })
    }
  }

  return out.sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''))
}

export async function extractWorld(root: string, gameVersion: string): Promise<GameWorldExtract> {
  const [museum, npcs, locations, weather, animalCosmetics] = await Promise.all([
    extractMuseum(root),
    extractNpcs(root),
    extractLocations(root),
    extractWeather(root),
    extractAnimalCosmetics(root),
  ])
  return { gameVersion, museum, npcs, locations, weather, animalCosmetics }
}
