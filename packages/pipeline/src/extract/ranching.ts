/**
 * Ranch animals, their stables, and the ranching rulebook — read from
 * `fiddle/ranching/animals/*.toml`, `fiddle/object_prototypes/building.toml`
 * and `fiddle/ranching/misc.toml`.
 *
 * **`default.toml` is a separate FILE the eight animal files inherit from**,
 * per leaf table per key — chicken's `[breeding]` states `days_until_adult`
 * but inherits `incubation_days = 3` from default.toml's `[breeding]`. That is
 * a different mechanism from the in-file `[default]` table `defaults()`
 * handles, so `leaf()` below merges the two documents table-by-table.
 *
 * The riskiest inherited value is `[breeding].treat`, which default.toml sets
 * to the **chicken** treat — a mammal file that forgot to override it would
 * silently breed cows with chicken treats. Every animal file states its own
 * (verified), but the extract still reads through the merge so a future animal
 * that omits one inherits exactly what the game would use.
 *
 * **`[variants.default]` is a template, not a variant.** Its `name` is
 * `"<n/a>"`; each real variant falls back to the file's `[variants.default]`,
 * which falls back to default.toml's — that chain is where `tier = 1`,
 * `born_in = [all four]` and `default_unlocked = false` live. The horse's
 * `giant_chicken_*` variants are real content, not noise.
 *
 * `production_tiers` is the whole golden-produce story: at 8 hearts golden is
 * a 10% *chance*, at 10 production flips to golden-only. Numbers are extracted
 * verbatim; deriving thresholds is the builder's job.
 */
import { join } from 'node:path'
import {
  bool,
  entries,
  num,
  readToml,
  resolveIn,
  str,
  strList,
  type Table,
  table,
  tomlFiles,
} from './toml.js'

export interface GameAnimalProduction {
  days_to_produce: number | null
  /** Internal item ids (`egg`, `golden_feather`) — never display names. */
  normal_product: string | null
  golden_product: string | null
}

export interface GameAnimalVariant {
  key: string
  name: string | null
  tier: number | null
  /** Seasons this variant can be conceived in. Null means unrestricted. */
  born_in: string[] | null
  /** Purchasable at Hayden's without breeding it first. */
  default_unlocked: boolean
  acquirable: boolean
  renown_value: number | null
  /** An animal-cosmetic key from the same file's `[cosmetics.*]`, worn from birth. */
  default_cosmetic: string | null
  /**
   * The palette-strip sprite this variant recolours the base art through
   * (`spr_animal_cow_lut`), usually stated on the `[variants.default]`
   * template. Null when the variant writes `"<n/a>"` — those have a dedicated
   * sprite of their own instead (chicken gold, the horse's mistmare). A
   * variant is one or the other, and reading only one path loses the rest.
   */
  lut: string | null
  /** Which entry of the LUT strip is this variant's palette. */
  lut_index: number | null
}

export interface GameAnimal {
  /** The file stem — `chicken`, `cow` — which is also this dataset's record id. */
  id: string
  name: string | null
  size: 'small' | 'large' | null
  requirements: {
    repaired_haydens_farm: boolean | null
    reached_date: { season: string; day: number; year: number } | null
    /** Requirement keys nobody reads yet — never silence a new gate. */
    unread_keys: string[]
  }
  production: { male: GameAnimalProduction; female: GameAnimalProduction }
  breeding: {
    uses_egg: boolean | null
    /** Only meaningful when `uses_egg` — the builder marks it not-applicable otherwise. */
    incubation_days: number | null
    days_until_adult: number | null
    /** Internal item id of the breeding treat. */
    treat: string | null
  }
  eating: { kind: string | null; hunger: number | null }
  petting: { kind: string | null; essence_points: number | null; stamina_cost: number | null }
  pricing: {
    buy_price: number | null
    baby_sell_price: number | null
    /** Sell price per heart level, index 0 = 0 hearts. 11 entries in practice. */
    adult_sell_prices: number[]
    /** Multiplier per variant tier. 7 entries as written. */
    tier_sell_price_multipliers: number[]
  }
  is_mount: boolean | null
  variants: GameAnimalVariant[]
}

export interface GameStable {
  /** `small_barn` … `large_coop`. */
  id: string
  name: string | null
  max_occupants: number | null
  permitted_animal_size: string | null
  manger_size: number | null
  double_manger: boolean | null
  /** Egg slots. Barns state 0 — a fact, not a gap. */
  incubators: number | null
}

export interface GameProductionTier {
  hearts_required: number
  normal: { count: number; additional_chance: number }
  golden: { count: number; additional_chance: number }
}

export interface GameRanchingExtract {
  gameVersion: string
  files: string[]
  animals: GameAnimal[]
  stables: GameStable[]
  misc: {
    min_heart_level_for_breeding: number | null
    /** Cumulative points to reach heart 1..10. */
    heart_point_table: number[]
    production_tiers: GameProductionTier[]
    heart_points: Record<string, number | number[]>
    xp: Record<string, number>
    festival_scoring: { tier: number[]; heart: number[] }
  }
}

/**
 * The leaf table at `path` in `doc`, with `base`'s table at the same path as
 * per-key fallback. This is the file-level inheritance: `doc` is an animal
 * file, `base` is default.toml.
 */
function leaf(doc: Table, base: Table, ...path: string[]): Table {
  let d: Table | null = doc
  let b: Table | null = base
  for (const step of path) {
    d = d === null ? null : table(d[step])
    b = b === null ? null : table(b[step])
  }
  return { ...(b ?? {}), ...(d ?? {}) }
}

/** A list of finite numbers, read verbatim — never padded or truncated. */
function numList(value: unknown): number[] {
  if (!Array.isArray(value)) return []
  return value.filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
}

function readProduction(doc: Table, base: Table, sex: 'male' | 'female'): GameAnimalProduction {
  const t = leaf(doc, base, 'production', sex)
  return {
    days_to_produce: num(t.days_to_produce),
    normal_product: str(t.normal_product),
    golden_product: str(t.golden_product),
  }
}

function readRequirements(doc: Table): GameAnimal['requirements'] {
  const core = table(doc.core) ?? {}
  const reqs = table(core.requirements) ?? {}
  const unread: string[] = []
  let repaired: boolean | null = null
  let reached: { season: string; day: number; year: number } | null = null
  for (const [key, value] of Object.entries(reqs)) {
    if (key === 'repaired_haydens_farm' && typeof value === 'boolean') {
      repaired = value
    } else if (key === 'reached_date') {
      const t = table(value)
      const season = t === null ? null : str(t.season)
      const day = t === null ? null : num(t.day)
      const year = t === null ? null : num(t.year)
      if (season !== null && day !== null && year !== null) reached = { season, day, year }
      else unread.push(key)
    } else {
      unread.push(key)
    }
  }
  return { repaired_haydens_farm: repaired, reached_date: reached, unread_keys: unread }
}

function readVariants(doc: Table, base: Table): GameAnimalVariant[] {
  // Each variant falls back to the file's [variants.default], which falls back
  // to default.toml's [variants.default]. leaf() merges those two templates.
  const template = leaf(doc, base, 'variants', 'default')
  const variants = table(doc.variants) ?? {}
  const out: GameAnimalVariant[] = []
  for (const [key, raw] of Object.entries(variants)) {
    if (key === 'default') continue
    const entry = table(raw)
    if (entry === null) continue
    const get = (k: string): unknown => (entry[k] !== undefined ? entry[k] : template[k])
    out.push({
      key,
      name: str(get('name')),
      tier: num(get('tier')),
      born_in: strList(get('born_in')),
      default_unlocked: bool(get('default_unlocked')) ?? false,
      acquirable: bool(get('acquirable')) ?? true,
      renown_value: num(get('renown_value')),
      default_cosmetic: str(get('default_cosmetic')),
      // `"<n/a>"` reads as null via str() — the variant has a dedicated
      // sprite, not a recolour.
      lut: str(get('lut')),
      lut_index: num(get('lut_index')),
    })
  }
  return out
}

async function readStables(root: string): Promise<GameStable[]> {
  const doc = await readToml(resolveIn(root, 'fiddle', 'object_prototypes', 'building.toml'))
  const out: GameStable[] = []
  for (const [id, entry] of entries(doc)) {
    const stable = table(entry.stable)
    if (stable === null) continue
    out.push({
      id,
      name: str(entry.name),
      max_occupants: num(stable.max_occupants),
      permitted_animal_size: str(stable.permitted_animal_size),
      manger_size: num(stable.manger_size),
      double_manger: bool(stable.double_manger),
      incubators: num(stable.incubators),
    })
  }
  out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return out
}

function readProductionTiers(value: unknown): GameProductionTier[] {
  if (!Array.isArray(value)) return []
  const out: GameProductionTier[] = []
  for (const raw of value) {
    const entry = table(raw)
    if (entry === null) continue
    const hearts = num(entry.hearts_required)
    const readRoll = (v: unknown): { count: number; additional_chance: number } | null => {
      const t = table(v)
      if (t === null) return null
      const count = num(t.count)
      const chance = num(t.additional_chance)
      return count === null || chance === null ? null : { count, additional_chance: chance }
    }
    const normal = readRoll(entry.normal)
    const golden = readRoll(entry.golden)
    if (hearts === null || normal === null || golden === null) continue
    out.push({ hearts_required: hearts, normal, golden })
  }
  return out
}

async function readMisc(root: string): Promise<GameRanchingExtract['misc']> {
  const doc = await readToml(resolveIn(root, 'fiddle', 'ranching', 'misc.toml'))
  const heartPoints: Record<string, number | number[]> = {}
  for (const [key, value] of Object.entries(table(doc.heart_points) ?? {})) {
    const n = num(value)
    if (n !== null) heartPoints[key] = n
    else {
      const list = numList(value)
      if (list.length > 0) heartPoints[key] = list
    }
  }
  const xp: Record<string, number> = {}
  for (const [key, value] of Object.entries(table(doc.xp) ?? {})) {
    const n = num(value)
    if (n !== null) xp[key] = n
  }
  const scoring = table(doc.festival_scoring) ?? {}
  return {
    min_heart_level_for_breeding: num(doc.min_heart_level_for_breeding),
    heart_point_table: numList(doc.heart_point_table),
    production_tiers: readProductionTiers(doc.production_tiers),
    heart_points: heartPoints,
    xp,
    festival_scoring: { tier: numList(scoring.tier), heart: numList(scoring.heart) },
  }
}

export async function extractRanching(
  root: string,
  gameVersion: string,
): Promise<GameRanchingExtract> {
  const dir = join('fiddle', 'ranching', 'animals')
  const files = await tomlFiles(root, dir)
  const animalFiles = files.filter((f) => f !== 'default.toml')
  if (animalFiles.length === 0) {
    throw new Error(
      'fiddle/ranching/animals/ holds no animal TOML files. Refusing to write an empty ' +
        'ranching extract over a good one — check MISTRIA_GAME_DIR.',
    )
  }

  const base = await readToml(resolveIn(root, dir, 'default.toml'))
  const animals: GameAnimal[] = []
  for (const file of animalFiles) {
    const doc = await readToml(resolveIn(root, dir, file))
    const core = leaf(doc, base, 'core')
    const breeding = leaf(doc, base, 'breeding')
    const eating = leaf(doc, base, 'eating')
    const petting = leaf(doc, base, 'petting')
    const pricing = leaf(doc, base, 'pricing')
    const mounting = leaf(doc, base, 'mounting')
    const size = str(core.size)
    animals.push({
      id: file.replace(/\.toml$/, ''),
      name: str(core.name),
      size: size === 'small' || size === 'large' ? size : null,
      requirements: readRequirements(doc),
      production: {
        male: readProduction(doc, base, 'male'),
        female: readProduction(doc, base, 'female'),
      },
      breeding: {
        uses_egg: bool(breeding.uses_egg),
        incubation_days: num(breeding.incubation_days),
        days_until_adult: num(breeding.days_until_adult),
        treat: str(breeding.treat),
      },
      eating: { kind: str(eating.kind), hunger: num(eating.hunger) },
      petting: {
        kind: str(petting.kind),
        essence_points: num(petting.essence_points),
        stamina_cost: num(petting.stamina_cost),
      },
      pricing: {
        buy_price: num(pricing.buy_price),
        baby_sell_price: num(pricing.baby_sell_price),
        adult_sell_prices: numList(pricing.adult_sell_prices),
        tier_sell_price_multipliers: numList(pricing.tier_sell_price_multipliers),
      },
      is_mount: bool(mounting.is_mount),
      variants: readVariants(doc, base),
    })
  }

  const [stables, misc] = await Promise.all([readStables(root), readMisc(root)])
  if (stables.length === 0) throw new Error('building.toml parsed to zero stables.')
  if (misc.production_tiers.length === 0) {
    throw new Error('ranching/misc.toml parsed to zero production tiers.')
  }

  return { gameVersion, files: animalFiles, animals, stables, misc }
}
