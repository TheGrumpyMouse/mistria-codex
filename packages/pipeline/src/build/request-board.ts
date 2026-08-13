/**
 * The request board, flattened for the app.
 *
 * `data/` keeps quests normalised and reviewable: a request references an item
 * by id and a gate by key, and resolving either means loading another dataset.
 * That is right for a file people read in pull requests and wrong for a screen —
 * `items.json` is a megabyte, and downloading all of it to print 193 names is
 * exactly the multi-megabyte parse the plan says freezes a mid-range phone.
 *
 * So this is a shipped form, like `availability.json`: one row per request with
 * the names already in it. About 60KB for the whole board.
 *
 * **The pool is fixed; the draw is random.** The wiki says the posted requests
 * "are generally randomized, however some will not appear until certain
 * conditions are met" — so this file is the complete set of things that can ever
 * be asked of you, and `gates` is what decides whether a given one is in the hat
 * yet. A board that listed all 212 regardless would be true of the pool and
 * false of the game.
 */
import type { Item, Location, Quest, Requirement, Skill } from '@mistria/schema'

export interface BoardItem {
  id: string
  name: string
  icon_key: string | null
  /**
   * The item's category, so the board can group by it without loading
   * `items.json` — joined here, from the record itself, never re-derived from
   * an icon prefix. Bundles shipped before it existed lack the field.
   */
  category: string | null
  quantity: number
}

export interface BoardRequest {
  id: string
  name: string
  giver_id: string | null
  giver_name: string | null
  /**
   * The giver is a spoiler-veiled record (Caldarus). The name still ships —
   * the veil withholds it at render, exactly like every other screen — but the
   * board needs the flag because this file deliberately never loads the
   * display index that carries it everywhere else.
   */
  giver_spoiler?: true
  items: BoardItem[]
  /** Null means all year, which is different from an unknown season. */
  seasons: string[] | null
  /**
   * What has to be true before this can appear. Empty means "from day one".
   * `key` rides along so quest and location gates can link to their pages;
   * the label alone was a sentence nothing could navigate from.
   */
  gates: { type: Requirement['type']; key: string; label: string }[]
  rewards: { tesserae: number | null; renown: number | null } | null
}

export interface RequestBoard {
  /** Every request that exists, whether or not it is in the hat yet. */
  requests: BoardRequest[]
}

/**
 * A gate, in words.
 *
 * Written here rather than in the app so the label and the key cannot drift
 * apart, and so the screen does not have to load quests, locations and skills
 * just to say "after Cop Some Ore".
 *
 * A key that resolves to nothing keeps its raw form rather than being dropped:
 * a gate you cannot name is still a gate, and hiding it would make a request
 * look freely available.
 */
export function gateLabel(
  requirement: Requirement,
  names: {
    quests: Map<string, string>
    locations: Map<string, string>
    skills: Map<string, string>
  },
): string {
  const pretty = (key: string): string => key.replace(/_/g, ' ')

  switch (requirement.type) {
    case 'year':
      return `Year ${requirement.value}`
    case 'quest':
      return `after ${names.quests.get(requirement.key) ?? pretty(requirement.key)}`
    case 'location':
      return `${names.locations.get(requirement.key) ?? pretty(requirement.key)} unlocked`
    case 'skill':
      return `${names.skills.get(requirement.key) ?? pretty(requirement.key)} Lv.${requirement.value}`
    case 'building':
      return `a ${pretty(requirement.key)}`
    case 'tool':
    case 'item':
      return `holding a ${pretty(requirement.key)}`
    default:
      return pretty(requirement.key)
  }
}

export function buildRequestBoard(
  quests: Quest[],
  items: Item[],
  characters: { id: string; name: string; spoiler?: boolean }[],
  locations: Pick<Location, 'id' | 'name'>[],
  skills: Pick<Skill, 'id' | 'name'>[],
): RequestBoard {
  const itemById = new Map(items.map((i) => [i.id, i]))
  const characterById = new Map(characters.map((c) => [c.id, c]))
  const names = {
    quests: new Map(quests.map((q) => [q.id, q.name])),
    locations: new Map(locations.map((l) => [l.id, l.name])),
    skills: new Map(skills.map((s) => [s.id, s.name])),
  }

  const requests = quests
    .filter((quest) => quest.kind === 'request')
    .map((quest): BoardRequest => {
      const boardItems = quest.objectives.flatMap((objective): BoardItem[] => {
        if (objective.target_id === null) return []
        const item = itemById.get(objective.target_id)
        if (item === undefined) return []
        return [
          {
            id: item.id,
            name: item.name,
            icon_key: item.icon_key,
            category: item.category ?? null,
            // The wiki omits the count when it is one, which is a shorthand
            // rather than an unknown.
            quantity: objective.quantity ?? 1,
          },
        ]
      })

      const giver =
        quest.giver_character_id === null ? undefined : characterById.get(quest.giver_character_id)

      return {
        id: quest.id,
        name: quest.name,
        giver_id: quest.giver_character_id,
        giver_name: giver?.name ?? null,
        ...(giver?.spoiler === true ? { giver_spoiler: true as const } : {}),
        items: boardItems,
        seasons: quest.season_restriction,
        gates: quest.prerequisites.map((requirement) => ({
          type: requirement.type,
          key: requirement.key,
          label: gateLabel(requirement, names),
        })),
        rewards:
          quest.rewards === null
            ? null
            : { tesserae: quest.rewards.tesserae, renown: quest.rewards.renown },
      }
    })

  requests.sort((a, b) => a.id.localeCompare(b.id))
  return { requests }
}
