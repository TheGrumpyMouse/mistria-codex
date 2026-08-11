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
import { entries, num, readToml, resolveIn, str, strList, table, tomlFiles } from './toml.js'

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
  // `given_items` spells the count `quantity` and may carry an `infusion` —
  // a modifier on the granted item, not a different grant.
  'quantity',
  'infusion',
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

/** What a grant hands over. At least one of recipe / item / accessory is set. */
export interface GameGrant {
  /** The recipe taught, from `recipe_scroll` or `crafting_scroll`. */
  recipe: string | null
  /** The item given, from `item`, `item_id` or `item_name`. */
  item: string | null
  /**
   * A ranch-animal accessory, as the `(animal, animal_cosmetic)` pair the
   * Chicken Statue's rolls state. Not an item id — the pair resolves to one
   * through the accessory's display name, in the build. Reading only `item`
   * here was why every unsold accessory had no source at all.
   */
  animal: string | null
  animal_cosmetic: string | null
  /**
   * A wardrobe piece, by its `player_assets` key — which is the id its record
   * ships under, so no resolution step exists to get wrong. Elsie's festival
   * stalls and the statue's rolls grant these.
   */
  cosmetic: string | null
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

/**
 * A letter that *starts a quest*, and the quest that must be finished first.
 *
 * `letters.toml` is where the story chain is actually stated: the Repair the
 * Beach Bridge letter arrives three days after Repair the General Store is
 * done. That is a prerequisite for the started quest and, read the other way,
 * the follow-up the finished quest unlocks — both directions from one row.
 */
export interface GameLetterQuest {
  letter: string
  npc: string | null
  /** The quest this letter starts. */
  quest_to_start: string
  /** The quest that must be complete before the letter can arrive, if stated. */
  requires_completed_quest: string | null
  /** Days after that completion before it arrives, where the table form states one. */
  days_after: number | null
  /**
   * `reached_heart_level = { ryis = 4 }` — the heart threshold that makes the
   * letter arrive, and with it the quest it starts. The only stated source for
   * which heart scene fires at which level.
   */
  reached_heart_level: { npc: string; level: number } | null
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

export interface GameCutsceneGrant extends GameGrant {
  /** The cutscene's key — the only identity a scene has that is not prose. */
  cutscene: string
}

export interface GameUnlocksExtract {
  gameVersion: string
  /**
   * What a new game hands you before you take a step: `starting_inventory`
   * plus the five `starting_armor` pieces from `misc.toml [ari_stats]`. The
   * test-mode list is dev tooling and is deliberately not read.
   */
  startingItems: string[]
  letters: GameLetterGrant[]
  letterQuests: GameLetterQuest[]
  quests: GameQuestGrant[]
  festivals: GameFestivalGrant[]
  museumRewards: GameMuseumRewardGrant[]
  wishingWell: GameRollGrant[]
  chickenStatue: GameRollGrant[]
  /**
   * Items handed over mid-scene — `given_items` in `cutscenes.toml`, "directly
   * stuffed into Ari's inventory" by the file's own comment. The only stated
   * source for the story's one-off grants: the worn axe, the star brooch, the
   * dragonsworn cloaks.
   */
  cutscenes: GameCutsceneGrant[]
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
  const animal = str(entry.animal)
  const animalCosmetic = str(entry.animal_cosmetic)
  const cosmetic = str(entry.cosmetic)

  for (const key of Object.keys(entry)) {
    const known =
      (RECIPE_KEYS as readonly string[]).includes(key) ||
      (ITEM_KEYS as readonly string[]).includes(key) ||
      NON_GRANT_KEYS.has(key)
    if (!known) unread.add(key)
  }

  if (recipe === null && item === null && animalCosmetic === null && cosmetic === null) return null
  return {
    recipe,
    item,
    animal,
    animal_cosmetic: animalCosmetic,
    cosmetic,
    count: num(entry.count) ?? num(entry.quantity),
  }
}

/** Every grant table in an array, in file order. */
const readGrants = (value: unknown, unread: Unread): GameGrant[] =>
  Array.isArray(value)
    ? value.map((raw) => readGrant(raw, unread)).filter((g): g is GameGrant => g !== null)
    : []

async function extractLetters(
  root: string,
  unread: Unread,
): Promise<{ grants: GameLetterGrant[]; quests: GameLetterQuest[] }> {
  const doc = await readToml(resolveIn(root, 'fiddle', 'letters.toml'))
  const grants: GameLetterGrant[] = []
  const quests: GameLetterQuest[] = []

  for (const [letter, section] of entries(doc)) {
    // The quest chain, stated on any letter with a `quest_to_start` — grants
    // or no grants. `completed_quest` comes in two spellings: a bare string,
    // and a `{ quest, days_after }` table the scalar reader cannot see.
    const questToStart = str(section.quest_to_start)
    if (questToStart !== null) {
      const reqs = table(section.requirements) ?? {}
      const completedRaw = reqs.completed_quest
      const completedTable = table(completedRaw)
      // `reached_heart_level = { ryis = 4 }` — one NPC, one threshold. A table
      // with several entries would be a shape nobody has seen; the first entry
      // is read and a second would simply not be, which the committed diff
      // would show as a heart event that never appears.
      const heartTable = table(reqs.reached_heart_level)
      const heartEntry = heartTable === null ? undefined : Object.entries(heartTable)[0]
      const heartLevel = heartEntry === undefined ? null : num(heartEntry[1])
      quests.push({
        letter,
        npc: str(section.npc),
        quest_to_start: questToStart,
        requires_completed_quest: str(completedRaw) ?? str(completedTable?.quest),
        days_after: num(completedTable?.days_after),
        reached_heart_level:
          heartEntry === undefined || heartLevel === null
            ? null
            : { npc: heartEntry[0], level: heartLevel },
      })
    }

    const lineGrants = readGrants(section.items, unread)
    if (lineGrants.length === 0) continue
    const { requirements, unread: unreadReqs } = readRequirements(section.requirements)
    for (const grant of lineGrants) {
      grants.push({
        ...grant,
        letter,
        npc: str(section.npc),
        requirements,
        unread_requirement_keys: unreadReqs,
      })
    }
  }

  if (grants.length === 0) throw new Error('letters.toml parsed to zero grants.')
  if (quests.length === 0) throw new Error('letters.toml parsed to zero quest starts.')
  return { grants, quests }
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
  const misc = await readToml(resolveIn(root, 'fiddle', 'misc.toml'))
  const ariStats = table(misc.ari_stats) ?? {}
  const startingItems = [
    ...(strList(ariStats.starting_inventory) ?? []),
    ...Object.values(table(ariStats.starting_armor) ?? {}).flatMap((v) => {
      const id = str(v)
      return id === null ? [] : [id]
    }),
  ].sort()
  if (startingItems.length === 0) {
    throw new Error('misc.toml [ari_stats] parsed to zero starting items.')
  }

  // Cutscene grants: `given_items` per scene. `item_id` rides the ordinary
  // grant reader (it is one of the three item spellings); `drop_items` are
  // scene props, not grants, and are not read.
  const cutsceneDoc = await readToml(resolveIn(root, 'fiddle', 'cutscenes.toml'))
  const cutscenes: GameCutsceneGrant[] = []
  for (const [cutscene, section] of entries(cutsceneDoc)) {
    for (const grant of readGrants(section.given_items, unread)) {
      cutscenes.push({ ...grant, cutscene })
    }
  }
  if (cutscenes.length === 0) throw new Error('cutscenes.toml parsed to zero given_items grants.')

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
    startingItems,
    letters: sorted(letters.grants, (r) => r.letter),
    letterQuests: letters.quests.sort((a, b) => a.letter.localeCompare(b.letter)),
    quests: sorted(quests, (r) => `${r.source_file}.${r.quest}`),
    festivals: sorted(festivals, (r) => `${r.festival}.${r.stall}`),
    museumRewards: sorted(museumRewards, (r) => `${r.wing}.${String(r.tier).padStart(3, '0')}`),
    wishingWell: sorted(wishingWell, (r) => r.pool),
    chickenStatue: sorted(chickenStatue, (r) => r.pool),
    cutscenes: sorted(cutscenes, (r) => r.cutscene),
    unreadGrantKeys: [...unread].sort(),
  }
}
