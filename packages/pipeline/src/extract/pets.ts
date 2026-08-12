/**
 * Pets, read from `fiddle/pets.toml`.
 *
 * Pets are not ranch animals: they have no production, no hearts-for-produce,
 * and live in one file keyed by variant (`cat_tabby`), each naming its
 * `pet_kind`. The kind itself has **no stated display name** anywhere — only
 * variants are named — so kind names are curated, never derived from the
 * token.
 *
 * The three `[jobs.*]` tables are global: every pet works the same jobs, and
 * the 11-row `reward_table` is indexed by the pet's heart level (0–10). The
 * forageables job's `reward = "custom"` is a sentinel for a pooled roll, not
 * an item id.
 */
import { num, readToml, resolveIn, str, table } from './toml.js'

export interface GamePetVariant {
  key: string
  pet_kind: string | null
  name: string | null
  /** Sprite names — carried in sources/ so the asset pass can want them; never shipped in data/. */
  ui_icon: string | null
  map_icon: string | null
  /**
   * The palette-strip sprite this variant recolours its `ui_icon` through —
   * the Black Cat is the tabby's icon through `spr_animal_cat_lut` row 2.
   * Same two-path shape as the ranch animals: a variant with a distinct
   * dedicated icon states no useful lut_index, and reading only one path
   * loses the other's variants.
   */
  lut: string | null
  lut_index: number | null
}

export interface GamePetJob {
  /** `wood` | `stone` | `forageables` — the table key. */
  key: string
  /** Game room id (`town`, `narrows`) — resolves through the room alias chain. */
  location_room: string | null
  /** Internal item id, or null when the reward is the custom forage pool. */
  reward_item: string | null
  reward_custom: boolean
  /** `[min, max]` per heart level, index 0 = 0 hearts. 11 rows in practice. */
  reward_table: [number, number][]
}

export interface GamePetCosmetic {
  key: string
  pet_kind: string | null
  cosmetic_set: string | null
}

export interface GamePetsExtract {
  gameVersion: string
  variants: GamePetVariant[]
  jobs: GamePetJob[]
  cosmetics: GamePetCosmetic[]
}

function readRewardTable(value: unknown): [number, number][] {
  if (!Array.isArray(value)) return []
  const out: [number, number][] = []
  for (const row of value) {
    if (!Array.isArray(row) || row.length !== 2) continue
    const min = num(row[0])
    const max = num(row[1])
    if (min !== null && max !== null) out.push([min, max])
  }
  return out
}

export async function extractPets(root: string, gameVersion: string): Promise<GamePetsExtract> {
  const doc = await readToml(resolveIn(root, 'fiddle', 'pets.toml'))

  const variants: GamePetVariant[] = []
  for (const [key, raw] of Object.entries(table(doc.variants) ?? {})) {
    const entry = table(raw)
    if (entry === null) continue
    variants.push({
      key,
      pet_kind: str(entry.pet_kind),
      name: str(entry.name),
      ui_icon: str(entry.ui_icon),
      map_icon: str(entry.map_icon),
      lut: str(entry.lut),
      lut_index: num(entry.lut_index),
    })
  }
  if (variants.length === 0) {
    throw new Error(
      'pets.toml parsed to zero variants. Refusing to write an empty pet extract over a ' +
        'good one — check MISTRIA_GAME_DIR.',
    )
  }
  variants.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))

  const jobs: GamePetJob[] = []
  for (const [key, raw] of Object.entries(table(doc.jobs) ?? {})) {
    const entry = table(raw)
    if (entry === null) continue
    const reward = str(entry.reward)
    jobs.push({
      key,
      location_room: str(entry.location_id),
      reward_item: reward === 'custom' ? null : reward,
      reward_custom: reward === 'custom',
      reward_table: readRewardTable(entry.reward_table),
    })
  }
  if (jobs.length === 0) throw new Error('pets.toml parsed to zero jobs.')
  jobs.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))

  const cosmetics: GamePetCosmetic[] = []
  for (const [key, raw] of Object.entries(table(doc.cosmetics) ?? {})) {
    const entry = table(raw)
    if (entry === null) continue
    cosmetics.push({
      key,
      pet_kind: str(entry.pet_kind),
      cosmetic_set: str(entry.cosmetic_set),
    })
  }
  cosmetics.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))

  return { gameVersion, variants, jobs, cosmetics }
}
