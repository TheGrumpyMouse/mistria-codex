/**
 * Quest gating, from the game's own quest files.
 *
 * Two reads, both structural:
 *
 * **`quests/request_board.toml`** — each request's `requirements` table is the
 * real answer to "when can this request appear", stated as data. The wiki's
 * condition column predates 1.0 and never knew the apiary chain existed.
 * Only scalar-valued requirement entries are taken; the two table-valued ones
 * (`reached_skill_level = { mining = 40 }`-style) are left for a later pass
 * and counted, never silently dropped.
 *
 * **`quests/story_quests.toml`** — id, title, icon NPC and stated rewards per
 * story quest, so a quest another record names as its gate can exist as a
 * record instead of an unexplained "locked". `description` and
 * `objective_description` are the game's prose and are never read — the same
 * rule extractSealOfferings already follows in this file's sibling.
 */
import { entries, num, readToml, resolveIn, str, table } from './toml.js'

export interface GameQuestRequirement {
  key: string
  value: string | number | boolean
}

export interface GameRequestGate {
  quest_id: string
  requirements: GameQuestRequirement[]
  /** Requirement entries whose value is a nested table — present, not yet modelled. */
  unread_requirement_keys: string[]
}

export interface GameStoryQuest {
  id: string
  name: string | null
  /** `npc_for_icon` — the character whose face fronts the quest. */
  npc: string | null
  reward_renown: number | null
  reward_tesserae: number | null
  reward_item_ids: string[]
}

export interface GameQuestsExtract {
  gameVersion: string
  storyQuests: GameStoryQuest[]
  requestGates: GameRequestGate[]
}

/** Scalar requirement entries from a `requirements` table; table-valued keys are reported, not read. */
export function readRequirements(value: unknown): {
  requirements: GameQuestRequirement[]
  unread: string[]
} {
  const requirements: GameQuestRequirement[] = []
  const unread: string[] = []
  for (const [key, raw] of Object.entries(table(value) ?? {})) {
    if (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean') {
      requirements.push({ key, value: raw })
    } else {
      unread.push(key)
    }
  }
  return { requirements, unread: unread.sort() }
}

export async function extractQuests(root: string, gameVersion: string): Promise<GameQuestsExtract> {
  const board = await readToml(resolveIn(root, 'fiddle', 'quests', 'request_board.toml'))
  const story = await readToml(resolveIn(root, 'fiddle', 'quests', 'story_quests.toml'))

  const requestGates: GameRequestGate[] = []
  for (const [id, quest] of entries(board)) {
    const { requirements, unread } = readRequirements(quest.requirements)
    if (requirements.length === 0 && unread.length === 0) continue
    requestGates.push({ quest_id: id, requirements, unread_requirement_keys: unread })
  }

  const storyQuests: GameStoryQuest[] = []
  for (const [id, quest] of entries(story)) {
    let renown: number | null = null
    let tesserae: number | null = null
    const items: string[] = []
    const rewards = Array.isArray(quest.rewards) ? quest.rewards : []
    for (const raw of rewards) {
      const reward = table(raw)
      if (reward === null) continue
      renown = renown ?? num(reward.renown)
      tesserae = tesserae ?? num(reward.tesserae)
      const item = str(reward.item)
      if (item !== null) items.push(item)
      // `crafting_scroll` rewards teach a recipe rather than granting an item;
      // recipe unlock provenance is a later pass.
    }

    storyQuests.push({
      id,
      name: str(quest.name),
      npc: str(quest.npc_for_icon),
      reward_renown: renown,
      reward_tesserae: tesserae,
      reward_item_ids: items.sort(),
    })
  }

  if (storyQuests.length === 0) throw new Error('story_quests.toml parsed to zero quests.')
  if (requestGates.length === 0)
    throw new Error('request_board.toml parsed to zero gated requests.')

  return {
    gameVersion,
    storyQuests: storyQuests.sort((a, b) => (a.id < b.id ? -1 : 1)),
    requestGates: requestGates.sort((a, b) => (a.quest_id < b.quest_id ? -1 : 1)),
  }
}
