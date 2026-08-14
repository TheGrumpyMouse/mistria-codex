/**
 * Quest gating, from the game's own quest files.
 *
 * Three reads, all structural:
 *
 * **`quests/request_board.toml`** — each request's `requirements` table is the
 * real answer to "when can this request appear", stated as data. The wiki's
 * condition column predates 1.0 and never knew the apiary chain existed.
 * Only scalar-valued requirement entries are taken; the two table-valued ones
 * (`reached_skill_level = { mining = 40 }`-style) are left for a later pass
 * and counted, never silently dropped.
 *
 * **`quests/fetch_quests.toml`** — the request definitions themselves. Each
 * table states the request's title, its giver (`npc_for_icon` — request_board
 * itself names nobody), its rewards, and what is wanted as exact internal
 * item ids with counts: `has_item = { egg = 3 }`, or a bare string for one.
 * The wiki lists these by display name and misses eleven item lists and
 * twenty-odd whole requests; the game states all of them.
 *
 * **`quests/story_quests.toml`** — id, title, icon NPC and stated rewards per
 * story quest, so a quest another record names as its gate can exist as a
 * record instead of an unexplained "locked". `description` and
 * `objective_description` are the game's prose and are never read — the same
 * rule extractSealOfferings already follows in this file's sibling, and it
 * applies to fetch_quests just as hard: every request's flavour text sits
 * three lines from its data.
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

export interface GameBoardRequest {
  id: string
  name: string | null
  /** `npc_for_icon` — the stated giver. request_board.toml itself names nobody. */
  npc: string | null
  /** Wanted items as exact internal ids. A bare-string `has_item` is one of quantity 1. */
  items: { id: string; quantity: number }[]
  reward_gold: number | null
  reward_renown: number | null
  reward_item_ids: string[]
  /** `recipe_scroll` rewards — the request teaches this recipe rather than handing an item. */
  reward_recipe_ids: string[]
  /** Stage requirement keys other than `has_item` — present, not yet modelled. */
  unread_stage_keys: string[]
}

export interface GameQuestsExtract {
  gameVersion: string
  storyQuests: GameStoryQuest[]
  requestGates: GameRequestGate[]
  boardRequests: GameBoardRequest[]
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

/**
 * A stage's `has_item`, which the game writes three ways: `"obsidian"` is one
 * of quantity 1, `{ smallmouth_bass = 2 }` is each entry with its count, and
 * `[{ sod = 1 }, { peat = 1 }]` is a list of the second form — the gardening
 * request is the only one, and it is how the array case was found. All 226
 * requests have exactly one stage today, but a multi-stage request would
 * union.
 */
export function readWantedItems(value: unknown): { id: string; quantity: number }[] {
  const one = str(value)
  if (one !== null) return [{ id: one, quantity: 1 }]
  if (Array.isArray(value)) return value.flatMap(readWantedItems)
  const many = table(value)
  if (many === null) return []
  const out: { id: string; quantity: number }[] = []
  for (const [id, raw] of Object.entries(many)) {
    const quantity = num(raw)
    if (quantity !== null) out.push({ id, quantity })
  }
  return out
}

export async function extractQuests(root: string, gameVersion: string): Promise<GameQuestsExtract> {
  const board = await readToml(resolveIn(root, 'fiddle', 'quests', 'request_board.toml'))
  const fetch = await readToml(resolveIn(root, 'fiddle', 'quests', 'fetch_quests.toml'))
  const story = await readToml(resolveIn(root, 'fiddle', 'quests', 'story_quests.toml'))

  const requestGates: GameRequestGate[] = []
  for (const [id, quest] of entries(board)) {
    const { requirements, unread } = readRequirements(quest.requirements)
    if (requirements.length === 0 && unread.length === 0) continue
    requestGates.push({ quest_id: id, requirements, unread_requirement_keys: unread })
  }

  const boardRequests: GameBoardRequest[] = []
  for (const [id, quest] of entries(fetch)) {
    let gold: number | null = null
    let renown: number | null = null
    const rewardItems: string[] = []
    const rewardRecipes: string[] = []
    for (const raw of Array.isArray(quest.rewards) ? quest.rewards : []) {
      const reward = table(raw)
      if (reward === null) continue
      gold = gold ?? num(reward.gold)
      renown = renown ?? num(reward.renown)
      const item = str(reward.item)
      if (item !== null) rewardItems.push(item)
      const recipe = str(reward.recipe_scroll)
      if (recipe !== null) rewardRecipes.push(recipe)
    }

    // Union across stages, keeping the larger count if an id repeats. A stage
    // requirement that is not `has_item` is a gate nobody models yet — counted,
    // because "the game added a kind of ask" must not be silence.
    const wanted = new Map<string, number>()
    const unreadKeys = new Set<string>()
    for (const raw of Array.isArray(quest.stages) ? quest.stages : []) {
      const stage = table(raw)
      if (stage === null) continue
      const requirements = table(stage.requirements) ?? {}
      for (const [key, value] of Object.entries(requirements)) {
        if (key !== 'has_item') {
          unreadKeys.add(key)
          continue
        }
        for (const item of readWantedItems(value)) {
          wanted.set(item.id, Math.max(wanted.get(item.id) ?? 0, item.quantity))
        }
      }
    }

    boardRequests.push({
      id,
      name: str(quest.name),
      npc: str(quest.npc_for_icon),
      items: [...wanted].map(([itemId, quantity]) => ({ id: itemId, quantity })),
      reward_gold: gold,
      reward_renown: renown,
      reward_item_ids: rewardItems.sort(),
      reward_recipe_ids: rewardRecipes.sort(),
      unread_stage_keys: [...unreadKeys].sort(),
    })
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
  if (boardRequests.length === 0) throw new Error('fetch_quests.toml parsed to zero requests.')

  return {
    gameVersion,
    storyQuests: storyQuests.sort((a, b) => (a.id < b.id ? -1 : 1)),
    requestGates: requestGates.sort((a, b) => (a.quest_id < b.quest_id ? -1 : 1)),
    boardRequests: boardRequests.sort((a, b) => (a.id < b.id ? -1 : 1)),
  }
}
