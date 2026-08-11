/**
 * Festival facts, read from `fiddle/festivals.toml` and `fiddle/misc.toml`.
 *
 * The stall *stocks* were already extracted as grants (see unlocks.ts); this
 * reads the festival's own row: where it happens, what weather it forces,
 * which quest introduces it, and which mechanics it carries. The mechanics are
 * booleans over stated tables — a festival with a `challenges` array holds a
 * judged contest, one with an `npc_date` table lets you invite someone — not
 * readings of any prose.
 *
 * The Animal Festival's placement prizes live in `misc.toml` as *templated*
 * ids (`white_{AnimalKind}_wall_ribbon`). They are extracted verbatim: the
 * expansion over animal kinds belongs to the builder, which can check each
 * expanded id against the items that actually exist rather than minting names.
 */
import {
  defaults,
  entries,
  field,
  num,
  readToml,
  resolveIn,
  str,
  type Table,
  table,
} from './toml.js'

export interface GameFestival {
  key: string
  name: string | null
  date: { season: string; day: number } | null
  /** Game room id — resolves through `curated/aliases/game_rooms.json`. */
  location: string | null
  /** Game weather class (`calm`, `special`…), not our vocabulary. */
  forced_weather: string | null
  implemented: boolean | null
  associated_quest: string | null
  /** The festival holds a judged contest (`challenges` is non-empty). */
  has_contest: boolean
  /** The festival lets you invite an NPC (`npc_date` table present). */
  has_npc_date: boolean
  /** Stall keys under `stocks`, sorted — the stall stock itself is in unlocks.json. */
  stalls: string[]
}

export interface GameFestivalsExtract {
  gameVersion: string
  festivals: GameFestival[]
  /**
   * Placement prizes, verbatim from misc.toml: `placeables` are templated item
   * ids (`white_{AnimalKind}_wall_ribbon`), `cosmetics` are animal-cosmetic
   * keys (`ribbon_white`) worn by the placing animal.
   */
  animalRewards: {
    small: { placeables: string[]; cosmetics: string[] }
    large: { placeables: string[]; cosmetics: string[] }
  }
}

function readDate(value: unknown): { season: string; day: number } | null {
  const t = table(value)
  if (t === null) return null
  const season = str(t.season)
  const day = num(t.day)
  return season === null || day === null ? null : { season, day }
}

function readRewardTemplates(value: unknown): { placeables: string[]; cosmetics: string[] } {
  const placeables: string[] = []
  const cosmetics: string[] = []
  if (!Array.isArray(value)) return { placeables, cosmetics }
  for (const raw of value) {
    const entry = table(raw)
    if (entry === null) continue
    const placeable = str(entry.placeable)
    if (placeable !== null) placeables.push(placeable)
    const cosmetic = str(entry.cosmetic)
    if (cosmetic !== null) cosmetics.push(cosmetic)
  }
  return { placeables, cosmetics }
}

export async function extractFestivals(
  root: string,
  gameVersion: string,
): Promise<GameFestivalsExtract> {
  const doc = await readToml(resolveIn(root, 'fiddle', 'festivals.toml'))
  const base = defaults(doc)

  const festivals: GameFestival[] = []
  for (const [key, entry] of entries(doc)) {
    const get = (k: string): unknown => field(entry, base, k)
    const challenges = get('challenges')
    festivals.push({
      key,
      name: str(get('name')),
      date: readDate(get('date')),
      location: str(get('location')),
      forced_weather: str(get('forced_weather')),
      implemented: typeof get('implemented') === 'boolean' ? (get('implemented') as boolean) : null,
      associated_quest: str(get('associated_quest')),
      has_contest: Array.isArray(challenges) && challenges.length > 0,
      has_npc_date: table(get('npc_date')) !== null,
      stalls: Object.keys(table(get('stocks')) ?? {}).sort(),
    })
  }
  if (festivals.length === 0) throw new Error('festivals.toml parsed to zero festivals.')

  const misc: Table = await readToml(resolveIn(root, 'fiddle', 'misc.toml'))
  return {
    gameVersion,
    festivals,
    animalRewards: {
      small: readRewardTemplates(misc.small_animal_festival_rewards),
      large: readRewardTemplates(misc.large_animal_festival_rewards),
    },
  }
}
