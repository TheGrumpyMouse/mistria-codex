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
import { join } from 'node:path'
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
  tomlFiles,
} from './toml.js'

export interface GameFestivalChallenge {
  /**
   * The join to the quest reward block that states the tier thresholds —
   * `[[<quest>.rewards]]` carries the same `artifact_key`.
   */
  artifact_key: string | null
  /**
   * `tier_results[].cutscene`, in stated order. The names carry the placing
   * (`spring_festival_third_place`…), which is the only place the game says
   * which tier is which; the *scores* live on the quest side, index-aligned.
   */
  tier_cutscenes: (string | null)[]
}

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
  /** The judged contests, verbatim — see GameFestivalChallenge. */
  challenges: GameFestivalChallenge[]
}

export interface GameQuestRewardTiers {
  /** `<file>.<quest key>`, for the report when a join goes wrong. */
  quest: string
  artifact_key: string
  cumulative: boolean | null
  /**
   * `tiers[].required_score`, in stated order — index-aligned with the
   * matching challenge's `tier_cutscenes`. A tier that states no score keeps
   * its slot as `null` so the alignment cannot silently shift.
   */
  scores: (number | null)[]
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
  /**
   * Every tiered reward block under `quests/` that names an `artifact_key` —
   * the contest score thresholds (`required_score`). The festival side of the
   * join is `challenges[].artifact_key` above.
   */
  questRewardTiers: GameQuestRewardTiers[]
}

function readDate(value: unknown): { season: string; day: number } | null {
  const t = table(value)
  if (t === null) return null
  const season = str(t.season)
  const day = num(t.day)
  return season === null || day === null ? null : { season, day }
}

function readChallenges(value: unknown): GameFestivalChallenge[] {
  if (!Array.isArray(value)) return []
  const out: GameFestivalChallenge[] = []
  for (const raw of value) {
    const challenge = table(raw)
    if (challenge === null) continue
    const results = Array.isArray(challenge.tier_results) ? challenge.tier_results : []
    out.push({
      artifact_key: str(challenge.artifact_key),
      tier_cutscenes: results.map((entry) => str(table(entry)?.cutscene)),
    })
  }
  return out
}

/** Every `[[<quest>.rewards]]` block with an `artifact_key` and `tiers`. */
async function extractQuestRewardTiers(root: string): Promise<GameQuestRewardTiers[]> {
  const files = await tomlFiles(root, join('fiddle', 'quests'))
  if (files.length === 0) throw new Error('fiddle/quests/ holds no TOML files.')

  const out: GameQuestRewardTiers[] = []
  for (const file of files.sort()) {
    const doc = await readToml(resolveIn(root, 'fiddle', 'quests', file))
    for (const [key, entry] of entries(doc)) {
      if (!Array.isArray(entry.rewards)) continue
      for (const raw of entry.rewards) {
        const block = table(raw)
        const artifactKey = str(block?.artifact_key)
        if (block === null || artifactKey === null || !Array.isArray(block.tiers)) continue
        out.push({
          quest: `${file.replace(/\.toml$/, '')}.${key}`,
          artifact_key: artifactKey,
          cumulative: typeof block.cumulative === 'boolean' ? block.cumulative : null,
          scores: block.tiers.map((tier) => num(table(tier)?.required_score)),
        })
      }
    }
  }
  return out
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
      challenges: readChallenges(challenges),
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
    questRewardTiers: (await extractQuestRewardTiers(root)).sort((a, b) =>
      `${a.artifact_key}.${a.quest}`.localeCompare(`${b.artifact_key}.${b.quest}`),
    ),
  }
}
