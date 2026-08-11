/**
 * Where artifacts come from, and what the seals cost — `artifacts.toml`,
 * `dungeons/`, `perks.toml`, `seals.toml` and the story quests' offering lists.
 *
 * This closes the biggest hole the wiki left: 90 of 110 artifacts had no
 * "where do I find this" answer, because the wiki's Items table stores location
 * as prose and mostly doesn't bother for artifacts. The game states it as data,
 * in three joins:
 *
 * **`artifacts.toml [locations]` is a room -> pool map**, and the pool names are
 * the `[sets.*]` keys of the archaeology museum wing. Set membership then names
 * every item in the pool, and `curated/aliases/game_rooms.json` already turns a
 * game room into one of our locations. Room -> pool -> items -> location, all
 * stated.
 *
 * **`dungeons.toml` gives each mine biome an `artifact_set`** — the same pool
 * vocabulary, keyed by floor order.
 *
 * **A seal is a quest, and the quest states its price.** `seals.toml` maps seal
 * -> quest, and the quest's stage carries `supplied_items.items` — exact item
 * ids and counts. The same structure prices the bridge and mill repairs.
 *
 * Not taken, deliberately: perk and quest `description`s, `objective_description`s,
 * and set descriptions. All of those are the game's writing — hard rule 1
 * applies absolutely to prose. Names (titles) are taken on the same footing as
 * item and NPC names.
 */
import { entries, num, readToml, resolveIn, str, strList, table } from './toml.js'

export interface GameMineBiome {
  /** 1-based position in the file, which is floor order. */
  index: number
  name: string | null
  /** The floor the biome starts at, as the game states it. */
  floor: number | null
  /** The archaeology pool found while digging here. */
  artifact_set: string | null
  /**
   * Recipes that drop from this biome's treasure chests, **with the Taste
   * Maker perk**. The perk's own description says so outright.
   *
   * The sibling list `dungeon_delicacies` looks identical and is not the same
   * thing: it drops the finished dish, behind a different perk. The two share
   * entries, so reading either as the other produces confident nonsense, and
   * the only place the difference is stated is the two perk descriptions.
   */
  taste_maker: string[]
  /** Furniture that drops from this biome's treasure chests. */
  furniture: string[]
  /**
   * Armor and weapons that drop from this biome's treasure chests — the
   * crystal set at Deep Earth, the corrupted mistril set in the Ancient
   * Ruins. The only stated source for twelve pieces of equipment.
   */
  armor: string[]
}

export interface GamePerk {
  id: string
  /** The perk's title. The description is in-game prose and is never read. */
  name: string | null
  /** The perk's numeric magnitude, where it has one. */
  value: number | null
}

export interface GameSkillTreePerk {
  id: string
  tier: number
  /** Essence cost to buy the perk, as the skill menu states it. */
  essence: number | null
}

export interface GameSkillTree {
  /** The skill's file stem — `cooking`, `ranching`, … — which is its id. */
  skill: string
  perks: GameSkillTreePerk[]
}

export interface GameSealOffering {
  quest_id: string
  /** The quest's title. */
  quest_name: string | null
  /** The seal this offering breaks, or null for point offerings. */
  seal: string | null
  /** The world point it is delivered to (bridge, mill), or null. */
  point: string | null
  items: { item_id: string; quantity: number }[]
}

export interface GameArtifactsExtract {
  gameVersion: string
  /** `artifacts.toml [locations]`: game room id -> archaeology pool name. */
  poolByRoom: Record<string, string>
  /** `artifacts.toml [loot]`: item id -> rarity word. */
  lootRarity: Record<string, string>
  mineBiomes: GameMineBiome[]
  /** Ritual chambers, one per biome that has one, with their floor bands. */
  ritualChambers: { room: string; floors: [number, number] }[]
  perks: GamePerk[]
  /**
   * `ui/skill_menu/*.toml`: the complete perk tree per skill — which perk
   * sits in which tier at what essence cost. This is where a perk's owning
   * skill is stated; `perks.toml` itself is a flat list.
   */
  skillTrees: GameSkillTree[]
  /**
   * `ui/skill_menu/defaults.toml [category] level_requirements`: the skill
   * level that unlocks each tier, index 0 = tier 1. Stated once, globally —
   * no per-skill file overrides it — with the game's own comment saying so.
   */
  skillTierLevels: number[]
  /** `seals.toml`: seal id -> the quest that breaks it. */
  seals: { id: string; quest_id: string }[]
  /** Every quest stage that demands a delivery of items. */
  sealOfferings: GameSealOffering[]
}

const sortByKey = <T, K extends keyof T>(rows: T[], key: K): T[] =>
  rows.sort((a, b) => (String(a[key]) < String(b[key]) ? -1 : 1))

export async function extractArtifactPools(
  root: string,
): Promise<Pick<GameArtifactsExtract, 'poolByRoom' | 'lootRarity'>> {
  const doc = await readToml(resolveIn(root, 'fiddle', 'artifacts.toml'))

  const poolByRoom: Record<string, string> = {}
  for (const [room, pool] of Object.entries(table(doc.locations) ?? {}).sort()) {
    const name = str(pool)
    if (name !== null) poolByRoom[room] = name
  }

  const lootRarity: Record<string, string> = {}
  for (const [item, rarity] of Object.entries(table(doc.loot) ?? {}).sort()) {
    const word = str(rarity)
    if (word !== null) lootRarity[item] = word
  }

  if (Object.keys(poolByRoom).length === 0) {
    throw new Error('artifacts.toml [locations] parsed to zero rooms.')
  }
  if (Object.keys(lootRarity).length === 0) {
    throw new Error('artifacts.toml [loot] parsed to zero items.')
  }
  return { poolByRoom, lootRarity }
}

export async function extractMineBiomes(root: string): Promise<GameMineBiome[]> {
  const doc = await readToml(resolveIn(root, 'fiddle', 'dungeons', 'dungeons.toml'))
  const biomes = Array.isArray(doc.biomes) ? doc.biomes : []

  const out = biomes.flatMap((raw, i): GameMineBiome[] => {
    const biome = table(raw)
    if (biome === null) return []
    return [
      {
        // File order is floor order — the game descends the array as the
        // player descends the mine — so the index is meaningful and kept.
        index: i + 1,
        name: str(biome.name),
        floor: num(biome.floor),
        artifact_set: str(biome.artifact_set),
        taste_maker: strList(biome.taste_maker) ?? [],
        furniture: strList(biome.furniture) ?? [],
        armor: strList(biome.armor) ?? [],
      },
    ]
  })

  if (out.length === 0) throw new Error('dungeons.toml parsed to zero biomes.')
  return out
}

export async function extractRitualChambers(
  root: string,
): Promise<{ room: string; floors: [number, number] }[]> {
  const doc = await readToml(resolveIn(root, 'fiddle', 'dungeons', 'level_ranges.toml'))

  const out: { room: string; floors: [number, number] }[] = []
  for (const [room, value] of Object.entries(doc).sort()) {
    if (!room.endsWith('_ritual_chamber') || !Array.isArray(value)) continue
    const from = num(value[0])
    const to = num(value[1])
    if (from !== null && to !== null) out.push({ room, floors: [from, to] })
  }

  // Four, not five: the Upper Mines has no ritual chamber. Zero means the file
  // changed shape and the extract must not silently ship without them.
  if (out.length === 0) throw new Error('level_ranges.toml has no *_ritual_chamber rooms.')
  return out
}

export async function extractPerks(root: string): Promise<GamePerk[]> {
  const doc = await readToml(resolveIn(root, 'fiddle', 'perks.toml'))

  const perks = entries(doc).map(
    ([id, entry]): GamePerk => ({
      id,
      name: str(entry.name),
      value: num(entry.value),
      // `description` and `mask` exist on every entry and are never read —
      // one is the game's prose, the other a sprite id this dataset never uses.
    }),
  )

  if (perks.length === 0) throw new Error('perks.toml parsed to zero perks.')
  return sortByKey(perks, 'id')
}

/**
 * The perk trees, one file per skill.
 *
 * `[[tier_N]]` arrays carry `perk`, `essence` and an `icon` sprite key; the
 * sprite is never read (this dataset resolves art through its own manifest,
 * and a game sprite id is useless to it anyway). `defaults.toml` is menu
 * chrome and `mount.toml` is the riding pseudo-skill with no perks of its
 * own shape — both are skipped by the same structural filter: a file with no
 * `tier_*` arrays contributes nothing.
 */
export async function extractSkillTrees(root: string): Promise<GameSkillTree[]> {
  const { readdir } = await import('node:fs/promises')
  const dir = resolveIn(root, 'fiddle', 'ui', 'skill_menu')
  const files = (await readdir(dir)).filter((f) => f.endsWith('.toml')).sort()

  const trees: GameSkillTree[] = []
  for (const file of files) {
    const doc = await readToml(resolveIn(root, 'fiddle', 'ui', 'skill_menu', file))
    const perks: GameSkillTreePerk[] = []

    for (const [key, value] of Object.entries(doc)) {
      const match = /^tier_(\d+)$/.exec(key)
      if (match === null || !Array.isArray(value)) continue
      const tier = Number(match[1])
      for (const raw of value) {
        const entry = table(raw)
        const id = str(entry?.perk)
        if (entry === null || id === null) continue
        perks.push({ id, tier, essence: num(entry.essence) })
      }
    }

    if (perks.length === 0) continue
    perks.sort((a, b) => a.tier - b.tier || (a.id < b.id ? -1 : 1))
    trees.push({ skill: file.replace(/\.toml$/, ''), perks })
  }

  if (trees.length === 0) throw new Error('ui/skill_menu has no tiered perk files.')
  return sortByKey(trees, 'skill')
}

/**
 * The tier -> unlock-level map, from the skill menu's shared defaults.
 *
 * `defaults.toml` is otherwise menu chrome and stays unread; this one array is
 * data — "the minimum level to unlock entries on each tier", in the game's own
 * words — and it is the only statement of perk unlock levels anywhere in the
 * files. The wiki's independently-parsed tier headers agree with it exactly,
 * which is as verified as a number gets around here.
 */
export async function extractSkillTierLevels(root: string): Promise<number[]> {
  const doc = await readToml(resolveIn(root, 'fiddle', 'ui', 'skill_menu', 'defaults.toml'))
  const category = table(doc.category)
  const raw = Array.isArray(category?.level_requirements) ? category.level_requirements : []
  const levels = raw.flatMap((value) => {
    const level = num(value)
    return level === null ? [] : [level]
  })

  if (levels.length === 0) {
    throw new Error('ui/skill_menu/defaults.toml has no [category] level_requirements.')
  }
  return levels
}

export async function extractSeals(root: string): Promise<{ id: string; quest_id: string }[]> {
  const doc = await readToml(resolveIn(root, 'fiddle', 'seals.toml'))

  const seals = entries(doc).flatMap(([id, entry]) => {
    const quest = str(entry.quest)
    return quest === null ? [] : [{ id, quest_id: quest }]
  })

  if (seals.length === 0) throw new Error('seals.toml parsed to zero seals.')
  return sortByKey(seals, 'id')
}

/**
 * Every quest stage that demands a delivery of items.
 *
 * The filter is structural, not a name list: any stage whose requirements carry
 * `supplied_items` is an offering, whether it breaks a seal (`seal = "fire"`)
 * or repairs a bridge (`point = "eastern_road/repair_the_bridge"`). A patch
 * adding a new seal shows up here without anyone editing a list.
 */
export async function extractSealOfferings(root: string): Promise<GameSealOffering[]> {
  const doc = await readToml(resolveIn(root, 'fiddle', 'quests', 'story_quests.toml'))

  const out: GameSealOffering[] = []
  for (const [questId, quest] of entries(doc)) {
    const stages = Array.isArray(quest.stages) ? quest.stages : []
    for (const raw of stages) {
      const stage = table(raw)
      const supplied = table(table(stage?.requirements)?.supplied_items)
      // Older stages spell it without the `requirements.` prefix.
      const alt = table(stage?.supplied_items)
      const source = supplied ?? alt
      if (source === null) continue

      const items = Object.entries(table(source.items) ?? {})
        .flatMap(([item_id, qty]) => {
          const quantity = num(qty)
          return quantity === null ? [] : [{ item_id, quantity }]
        })
        .sort((a, b) => (a.item_id < b.item_id ? -1 : 1))
      if (items.length === 0) continue

      out.push({
        quest_id: questId,
        quest_name: str(quest.name),
        seal: str(source.seal),
        point: str(source.point),
        items,
      })
    }
  }

  if (out.length === 0) throw new Error('story_quests.toml has no supplied_items stages.')
  return sortByKey(out, 'quest_id')
}

export async function extractArtifacts(
  root: string,
  gameVersion: string,
): Promise<GameArtifactsExtract> {
  const [
    pools,
    mineBiomes,
    ritualChambers,
    perks,
    skillTrees,
    skillTierLevels,
    seals,
    sealOfferings,
  ] = await Promise.all([
    extractArtifactPools(root),
    extractMineBiomes(root),
    extractRitualChambers(root),
    extractPerks(root),
    extractSkillTrees(root),
    extractSkillTierLevels(root),
    extractSeals(root),
    extractSealOfferings(root),
  ])
  return {
    gameVersion,
    ...pools,
    mineBiomes,
    ritualChambers,
    perks,
    skillTrees,
    skillTierLevels,
    seals,
    sealOfferings,
  }
}
