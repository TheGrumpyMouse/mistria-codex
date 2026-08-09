/**
 * The game's production machines — `object_prototypes/furniture.toml`'s
 * `*.factory` tables. Exactly two exist at 1.0.0: the Apiary and the Terrarium.
 *
 * A factory states, as data: which item tags it accepts (`legal_tags` minus
 * `illegal_tags` — the terrarium takes `bugs` and refuses `bee`), how many days
 * a batch takes, what each input-rarity tier yields (`rewards_map`, indexed by
 * rarity), which items it *requests* per season, and where the object can be
 * placed. This is the only source anywhere for "which bee gives Legendary
 * Honey" and "what do I feed the terrarium in fall".
 *
 * The scan is structural — any prototype with a `.factory` subtable is a
 * machine — so a patch that adds a third factory shows up without a name list.
 * Sprite keys, sounds and UI offsets in the same table are chrome and are
 * never read.
 *
 * **Two things come out of this file, not one.** Every placeable object's
 * footprint is here too, as `size = [w, h]`, and it is the one fact a player
 * arranging a room needs that no other source states — the wiki's furniture
 * table has no column for it. Parsing 1,503 tables twice to keep the two reads
 * in separate modules would cost more than the honesty is worth, so the extract
 * carries both and is named for the file rather than for the factories.
 */
import { entries, num, range, readToml, resolveIn, str, strList, table } from './toml.js'

export interface GameFactoryRequest {
  item: string
  /** The season it is asked for in, or null when unconditional. */
  season: string | null
  /** True when the request only appears after the General Store is repaired. */
  repaired_general_store: boolean
}

export interface GameFactory {
  /** The prototype key — `apiary`, `terrarium` — which is also the item id. */
  id: string
  legal_tags: string[]
  illegal_tags: string[]
  days_to_produce: number | null
  inventory_size: number | null
  /**
   * Reward pools by input rarity, index 0 = common. The apiary writes a bare
   * item per tier and the terrarium a list per tier; both normalise to lists.
   */
  rewards_map: string[][]
  requests: GameFactoryRequest[]
  placeable_locations: string[]
}

export interface GameMachinesExtract {
  gameVersion: string
  factories: GameFactory[]
  /**
   * Object prototype id -> `[width, height]` in tiles, for the 865 prototypes
   * that state one.
   *
   * **Only a stated size.** The file's `[default]` table declares `[2, 2]`, and
   * inheriting it would hand a footprint to every rug and wall hanging in the
   * game on the strength of a fallback nobody has checked applies. An absent
   * size stays absent, which is the correct answer to a question no source has
   * answered.
   */
  objectSizes: Record<string, [number, number]>
}

/** The keys a request's `requirements` may carry. Anything new must be looked at, not dropped. */
const KNOWN_REQUEST_KEYS = new Set(['is_season', 'repaired_general_store'])

function readRequests(value: unknown, factoryId: string): GameFactoryRequest[] {
  if (!Array.isArray(value)) return []

  return value.flatMap((raw): GameFactoryRequest[] => {
    const entry = table(raw)
    const item = str(entry?.item)
    if (entry === null || item === null) return []

    const requirements = table(entry.requirements) ?? {}
    for (const key of Object.keys(requirements)) {
      if (!KNOWN_REQUEST_KEYS.has(key)) {
        throw new Error(
          `${factoryId}.factory requests: unknown requirement key "${key}" on ${item}. ` +
            'A new gate must be modelled, not silently dropped.',
        )
      }
    }

    return [
      {
        item,
        season: str(requirements.is_season),
        repaired_general_store: requirements.repaired_general_store === true,
      },
    ]
  })
}

/** `rewards_map` rows are a bare item id or a list of them; both become lists. */
function readRewards(value: unknown): string[][] {
  if (!Array.isArray(value)) return []
  return value.map((row) => {
    const single = str(row)
    if (single !== null) return [single]
    return strList(row) ?? []
  })
}

export async function extractMachines(
  root: string,
  gameVersion: string,
): Promise<GameMachinesExtract> {
  const doc = await readToml(resolveIn(root, 'fiddle', 'object_prototypes', 'furniture.toml'))

  const factories: GameFactory[] = []
  const objectSizes: Record<string, [number, number]> = {}
  for (const [id, prototype] of entries(doc)) {
    const size = range(prototype.size)
    if (size !== null) objectSizes[id] = size

    const factory = table(prototype.factory)
    if (factory === null) continue

    factories.push({
      id,
      legal_tags: strList(factory.legal_tags) ?? [],
      illegal_tags: strList(factory.illegal_tags) ?? [],
      days_to_produce: num(factory.days_to_produce),
      inventory_size: num(factory.inventory_size),
      rewards_map: readRewards(factory.rewards_map),
      requests: readRequests(factory.requests, id),
      placeable_locations: strList(prototype.placeable_locations) ?? [],
    })
  }

  if (factories.length === 0) {
    throw new Error('object_prototypes/furniture.toml has no *.factory tables.')
  }
  if (Object.keys(objectSizes).length === 0) {
    throw new Error('object_prototypes/furniture.toml parsed to zero stated sizes.')
  }
  return {
    gameVersion,
    factories: factories.sort((a, b) => (a.id < b.id ? -1 : 1)),
    objectSizes: Object.fromEntries(Object.entries(objectSizes).sort()),
  }
}
