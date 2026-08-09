/**
 * Every place the game hands you something, from the game's own files.
 *
 * **Two tokens teach a recipe, not one.** `recipe_scroll` is the cooking one
 * and `crafting_scroll` is the furniture one, and they are otherwise identical
 * — same table shape, same arrays, often side by side. Reading only the first
 * finds 88 grants and concludes furniture recipes are unlocked by skill level
 * alone; reading both finds the museum reward tiers, the Stillwell and
 * Taliferro challenge boards, and twelve more shop lines.
 *
 * **Three tokens give an item.** `item`, `item_id` and `item_name` are the same
 * field under three spellings — the stores and festivals write `item`, the
 * letters write `item_name`. Reading one of the three silently drops 94 grants.
 *
 * Recipes and items come out of the same pass because they sit in the same
 * arrays. Splitting them would mean walking every file twice and getting the
 * two halves out of step; the build decides what to do with each.
 *
 * **An unrecognised key is reported, never dropped.** `unreadGrantKeys` carries
 * every sibling key the reader did not understand, so a patch that adds a new
 * grant token shows up in the committed diff and in the console rather than
 * quietly narrowing the dataset. That is the whole failure mode this module
 * exists to correct — `crafting_scroll` had been sitting in these files the
 * entire time.
 *
 * **Nothing here reads prose.** The letters carry their body in `local` and a
 * `subject_line`; the quests carry `description` and `objective_description`.
 * None is read. What is read is `npc`, `requirements`, the grant arrays, and a
 * quest's `name` — a label in the same class as an item name, and the only
 * thing that can join a game quest key to a wiki-derived quest record.
 *
 * Two grant sites are deliberately elsewhere or absent:
 *
 * - `dungeons/dungeons.toml` states its chest pools as per-biome lists rather
 *   than as grant tables, so `extractMineBiomes` reads them where the rest of
 *   the biome already is.
 * - `cutscenes.toml` holds one grant, of an **item** that happens to be a
 *   scroll (`engagement_ring_recipe_scroll`). Reading a file that is mostly
 *   dialogue for one row is not worth the exposure to prose.
 */
import { join } from 'node:path'
import { type GameQuestRequirement, readRequirements } from './quests.js'
import { entries, num, readToml, resolveIn, str, table, tomlFiles } from './toml.js'

/** Teaches a recipe. Two spellings, one meaning. */
const RECIPE_KEYS = ['recipe_scroll', 'crafting_scroll'] as const
/** Gives the thing itself. Three spellings, one meaning. */
const ITEM_KEYS = ['item', 'item_id', 'item_name'] as const

/**
 * Keys a grant table may carry that are not a grant of a recipe or an item, and
 * are therefore not this module's business. Listed so that "ignored" is always
 * a decision: anything outside both this set and the two above is reported.
 */
const NON_GRANT_KEYS = new Set([
  'count',
  // Currencies and standing, handled by the quest builder.
  'renown',
  'gold',
  'tesserae',
  // Other grant kinds, each modelled (or deliberately not) elsewhere.
  'cosmetic',
  'animal',
  'animal_cosmetic',
  'pet_cosmetic',
  'artifact_key',
  'purse',
  'quest',
  // Line gates and presentation.
  'requires',
  'requirements',
  'has_unlocked_animal',
  'tier_required',
  'cumulative',
  'tiers',
  'preview_sprite',
])

/** What a grant hands over. At least one of the two is set. */
export interface GameGrant {
  /** The recipe taught, from `recipe_scroll` or `crafting_scroll`. */
  recipe: string | null
  /** The item given, from `item`, `item_id` or `item_name`. */
  item: string | null
  /** How many, where the line states it. */
  count: number | null
}

export interface GameLetterGrant extends GameGrant {
  /** The letter's key, so one letter sending two things stays one letter. */
  letter: string
  /** Who signs it. */
  npc: string | null
  /**
   * What makes it arrive — `shipped_item = "potato"`, `donated_item =
   * "sweetroot"`, `reached_date`. The post is this game's milestone reward
   * system, so this is the real condition rather than flavour.
   */
  requirements: GameQuestRequirement[]
  unread_requirement_keys: string[]
}

export interface GameQuestGrant extends GameGrant {
  /** The section key in the quest file. */
  quest: string
  /** Which file it came from — `fetch_quests`, `tali_challenges`. */
  source_file: string
  /** The display name: the join key, since our quest ids are wiki-derived. */
  quest_name: string | null
  /** `npc_for_icon`, which disambiguates the requests that share a name. */
  npc: string | null
}

export interface GameFestivalGrant extends GameGrant {
  /** The festival's section key — `harvest`, `animal`. */
  festival: string
  /** The stall's key within `[<festival>.stocks]`. */
  stall: string
}

export interface GameMuseumRewardGrant extends GameGrant {
  /** The wing file — `archaeology`, `fish`, `flora`, `insect`. */
  wing: string
  /** 1-based position in the wing's `rewards` array, which is the tier order. */
  tier: number
}

export interface GameRollGrant extends GameGrant {
  /** The pool it sits in — `common.small_roll`, `common.large_roll`. */
  pool: string
}

export interface GameUnlocksExtract {
  gameVersion: string
  letters: GameLetterGrant[]
  quests: GameQuestGrant[]
  festivals: GameFestivalGrant[]
  museumRewards: GameMuseumRewardGrant[]
  wishingWell: GameRollGrant[]
  chickenStatue: GameRollGrant[]
  /**
   * Keys seen inside a grant table that this reader does not understand.
   *
   * Expected to be empty. A non-empty list in the committed diff is the game
   * having added a way to give you something that nothing here collects.
   */
  unreadGrantKeys: string[]
}

/** Collects unrecognised keys across a whole run, so one report covers every file. */
type Unread = Set<string>

/**
 * One grant table, or null when it grants neither a recipe nor an item.
 *
 * A `null` return still records unknown keys: a table of pure currency is not a
 * grant *here*, but a table with a token nobody has modelled must be visible.
 */
function readGrant(raw: unknown, unread: Unread): GameGrant | null {
  const entry = table(raw)
  if (entry === null) return null

  let recipe: string | null = null
  for (const key of RECIPE_KEYS) recipe ??= str(entry[key])
  let item: string | null = null
  for (const key of ITEM_KEYS) item ??= str(entry[key])

  for (const key of Object.keys(entry)) {
    const known =
      (RECIPE_KEYS as readonly string[]).includes(key) ||
      (ITEM_KEYS as readonly string[]).includes(key) ||
      NON_GRANT_KEYS.has(key)
    if (!known) unread.add(key)
  }

  if (recipe === null && item === null) return null
  return { recipe, item, count: num(entry.count) }
}

/** Every grant table in an array, in file order. */
const readGrants = (value: unknown, unread: Unread): GameGrant[] =>
  Array.isArray(value)
    ? value.map((raw) => readGrant(raw, unread)).filter((g): g is GameGrant => g !== null)
    : []

async function extractLetters(root: string, unread: Unread): Promise<GameLetterGrant[]> {
  const doc = await readToml(resolveIn(root, 'fiddle', 'letters.toml'))
  const out: GameLetterGrant[] = []

  for (const [letter, section] of entries(doc)) {
    const grants = readGrants(section.items, unread)
    if (grants.length === 0) continue
    const { requirements, unread: unreadReqs } = readRequirements(section.requirements)
    for (const grant of grants) {
      out.push({
        ...grant,
        letter,
        npc: str(section.npc),
        requirements,
        unread_requirement_keys: unreadReqs,
      })
    }
  }

  if (out.length === 0) throw new Error('letters.toml parsed to zero grants.')
  return out
}

/**
 * Quest rewards, from **every** file under `quests/`.
 *
 * Structural rather than a name list, for the same reason the factory scan is:
 * `fetch_quests.toml` was the file nobody had opened, and the two challenge
 * boards were the files nobody knew granted recipes. A registry file with no
 * `rewards` array simply yields nothing.
 */
async function extractQuestGrants(root: string, unread: Unread): Promise<GameQuestGrant[]> {
  const files = await tomlFiles(root, join('fiddle', 'quests'))
  if (files.length === 0) throw new Error('fiddle/quests/ holds no TOML files.')

  const out: GameQuestGrant[] = []
  for (const file of files) {
    const doc = await readToml(resolveIn(root, 'fiddle', 'quests', file))
    for (const [quest, section] of entries(doc)) {
      for (const grant of readGrants(section.rewards, unread)) {
        out.push({
          ...grant,
          quest,
          source_file: file.replace(/\.toml$/, ''),
          quest_name: str(section.name),
          npc: str(section.npc_for_icon),
        })
      }
    }
  }

  if (out.length === 0) throw new Error('the quest files parsed to zero reward grants.')
  return out
}

/**
 * Festival stall stock.
 *
 * `[<festival>.stocks]` is a table of stalls, each an array of grants. A line
 * also carries `tier_required`, the festival rank gate — not read, because
 * nothing models festival tiers yet and a number with no meaning attached is
 * worse than its absence.
 */
async function extractFestivalGrants(root: string, unread: Unread): Promise<GameFestivalGrant[]> {
  const doc = await readToml(resolveIn(root, 'fiddle', 'festivals.toml'))
  const out: GameFestivalGrant[] = []

  for (const [festival, section] of entries(doc)) {
    for (const [stall, list] of Object.entries(table(section.stocks) ?? {}).sort()) {
      for (const grant of readGrants(list, unread)) out.push({ ...grant, festival, stall })
    }
  }

  if (out.length === 0) throw new Error('festivals.toml parsed to zero stall grants.')
  return out
}

/**
 * Museum reward tiers — the largest scroll surface in the game, and the one
 * that answers "where do furniture recipes come from".
 *
 * Each wing file carries a `rewards` array whose position *is* the tier: fill
 * the fifth band of the archaeology wing and you are handed the Explorer bed
 * plus its crafting scroll. The wings are read here rather than in
 * `extractWorld`, which already parses them for set rosters — the parse is
 * cheap and keeping every grant surface in one module is what makes the
 * unknown-key report meaningful.
 */
async function extractMuseumRewards(
  root: string,
  unread: Unread,
): Promise<GameMuseumRewardGrant[]> {
  const files = await tomlFiles(root, join('fiddle', 'museum_wings'))
  if (files.length === 0) throw new Error('fiddle/museum_wings/ holds no TOML files.')

  const out: GameMuseumRewardGrant[] = []
  for (const file of files) {
    const doc = await readToml(resolveIn(root, 'fiddle', 'museum_wings', file))
    const wing = file.replace(/\.toml$/, '')
    const rewards = Array.isArray(doc.rewards) ? doc.rewards : []
    for (const [index, raw] of rewards.entries()) {
      const reward = table(raw)
      if (reward === null) continue
      for (const grant of readGrants(reward.entries, unread)) {
        out.push({ ...grant, wing, tier: index + 1 })
      }
    }
  }

  if (out.length === 0) throw new Error('the museum wing files parsed to zero reward grants.')
  return out
}

/**
 * The Wishing Well and the Chicken Statue: a paid roll against a stated pool.
 *
 * Both files are arrays of grants under named pools, so one reader serves both.
 * The pool name is kept because it is the odds — a `large_roll` costs more than
 * a `small_roll` — even though nothing renders that yet.
 */
async function extractRollGrants(
  root: string,
  file: string,
  unread: Unread,
): Promise<GameRollGrant[]> {
  const doc = await readToml(resolveIn(root, 'fiddle', file))
  const out: GameRollGrant[] = []

  const walk = (value: unknown, pool: string): void => {
    if (Array.isArray(value)) {
      for (const grant of readGrants(value, unread)) out.push({ ...grant, pool })
      return
    }
    const nested = table(value)
    if (nested === null) return
    for (const [key, child] of Object.entries(nested).sort()) {
      walk(child, pool === '' ? key : `${pool}.${key}`)
    }
  }

  walk(doc, '')
  if (out.length === 0) throw new Error(`${file} parsed to zero grants.`)
  return out
}

export async function extractUnlocks(
  root: string,
  gameVersion: string,
): Promise<GameUnlocksExtract> {
  const unread: Unread = new Set()

  // Sequential rather than concurrent: they share the unknown-key set, and a
  // handful of small TOML files is not where this command spends its time.
  const letters = await extractLetters(root, unread)
  const quests = await extractQuestGrants(root, unread)
  const festivals = await extractFestivalGrants(root, unread)
  const museumRewards = await extractMuseumRewards(root, unread)
  const wishingWell = await extractRollGrants(root, 'wishing_well.toml', unread)
  const chickenStatue = await extractRollGrants(root, 'chicken_statue.toml', unread)

  // Sorted on the way out, like every other extract: the file is committed and
  // CI diffs it, so file order must not leak into the snapshot.
  const sorted = <T extends GameGrant>(rows: T[], key: (row: T) => string): T[] =>
    rows.sort((a, b) =>
      `${key(a)}|${a.recipe ?? ''}|${a.item ?? ''}`.localeCompare(
        `${key(b)}|${b.recipe ?? ''}|${b.item ?? ''}`,
      ),
    )

  return {
    gameVersion,
    letters: sorted(letters, (r) => r.letter),
    quests: sorted(quests, (r) => `${r.source_file}.${r.quest}`),
    festivals: sorted(festivals, (r) => `${r.festival}.${r.stall}`),
    museumRewards: sorted(museumRewards, (r) => `${r.wing}.${String(r.tier).padStart(3, '0')}`),
    wishingWell: sorted(wishingWell, (r) => r.pool),
    chickenStatue: sorted(chickenStatue, (r) => r.pool),
    unreadGrantKeys: [...unread].sort(),
  }
}
