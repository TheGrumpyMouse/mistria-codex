import type { Quest, Requirement, Season } from '@mistria/schema'
import { toSnakeId } from '@mistria/schema'
import type { ExtractedCondition } from '../../enrich/quests.js'
import type { BuildContext } from '../context.js'
import { predates1_0 } from '../freshness.js'

/**
 * Build the quest list.
 *
 * The point of this dataset is that gates become nameable. Mine biomes and shop
 * stock already carry `{type: "quest", key: "breaking_the_fire_seal"}`, and
 * until the quest exists the app can only say "locked" without saying by what.
 *
 * `objectives` is populated only where the wiki writes a deliverable as
 * `{{ItemIcon|Heather}} (3)` — 220 of the requests do. The rest have a sentence
 * describing what to do, which is prose we do not copy and could not turn into
 * a structured objective without inventing one. Those carry an `objectives` gap.
 */

/** Reward currency tokens, as the wiki writes them in `{{Price|N|token}}`. */
const CURRENCY_TOKENS: Record<string, 'tesserae' | 'renown' | 'essence'> = {
  '': 'tesserae',
  renown: 'renown',
  ess: 'essence',
}

/**
 * Ids, disambiguated only where they need to be.
 *
 * Seven request names are used by more than one villager — three characters
 * each want "Request for Berries" — so the name alone is not a key. The giver
 * is appended only for the duplicates, so the common case keeps a clean,
 * guessable id and the gates that already reference one keep working.
 */
export function questIds(quests: { name: string; giver: string | null }[]): string[] {
  const counts = new Map<string, number>()
  for (const quest of quests) {
    const base = toSnakeId(quest.name)
    counts.set(base, (counts.get(base) ?? 0) + 1)
  }

  const used = new Set<string>()
  return quests.map((quest) => {
    const base = toSnakeId(quest.name)
    if ((counts.get(base) ?? 0) === 1) {
      used.add(base)
      return base
    }

    const withGiver = quest.giver === null ? base : `${base}_${toSnakeId(quest.giver)}`
    if (!used.has(withGiver)) {
      used.add(withGiver)
      return withGiver
    }

    // Same name, same giver, twice. Numbered rather than dropped: the second
    // one is a real row on the page and silently losing it is worse than an
    // id with a 2 on the end.
    for (let n = 2; ; n += 1) {
      const numbered = `${withGiver}_${n}`
      if (!used.has(numbered)) {
        used.add(numbered)
        return numbered
      }
    }
  })
}

/**
 * Turn the wiki's "Requirements to Receive" into structured gates.
 *
 * This is what makes the request board answerable rather than just listable:
 * the board's *draw* is random, but its *pool* is this fixed list of 212, and a
 * request only enters the pool once its conditions are met. Without them the
 * app can say "someone might ask you for a Mistril Ingot" on day one, which is
 * true of the pool and false of the game.
 *
 * **Anything that does not resolve is dropped, not guessed.** A condition
 * naming an item or quest we do not hold would otherwise become a dangling
 * reference that refint catches later and nobody can explain.
 */
export function resolvePrerequisites(
  ctx: BuildContext,
  conditions: ExtractedCondition[],
  questIdByName: Map<string, string>,
): Requirement[] {
  // Biome order is read from the floor ranges rather than hardcoded: the wiki
  // writes `{{BiomesQuick|3|icon}}`, and 3 means the third biome by depth. A
  // literal list here would silently mean something else the day a biome is
  // inserted.
  const biomesByOrder = [...ctx.mines.biomes]
    .sort((a, b) => a.floors.min - b.floors.min)
    .map((b) => b.id)

  const out: Requirement[] = []
  const seen = new Set<string>()

  const add = (requirement: Requirement): void => {
    const key = `${requirement.type}:${requirement.key}:${requirement.op}:${requirement.value}`
    if (seen.has(key)) return
    seen.add(key)
    out.push(requirement)
  }

  for (const condition of conditions) {
    switch (condition.kind) {
      case 'year':
        add({ type: 'year', key: 'year', op: '>=', value: Number(condition.value) })
        break

      case 'item': {
        if (!ctx.itemByName.has(condition.value)) break
        const id = ctx.idFor(condition.value)
        // A tool is an item you must be holding; the schema keeps the two apart
        // so the app can say "you need a pickaxe" rather than "you need one
        // pickaxe in the donation box".
        add({
          type:
            /worn|copper|iron|silver|mistril/i.test(condition.value) &&
            /axe|pickaxe|net|rod|hoe|can|shovel/i.test(condition.value)
              ? 'tool'
              : 'item',
          key: id,
          op: 'has',
          value: null,
        })
        break
      }

      case 'quest': {
        const id = questIdByName.get(condition.value)
        if (id !== undefined) add({ type: 'quest', key: id, op: 'done', value: null })
        break
      }

      case 'biome': {
        const id = biomesByOrder[Number(condition.value) - 1]
        if (id !== undefined) add({ type: 'location', key: `the_${id}`, op: 'has', value: null })
        break
      }

      case 'location': {
        const id = LOCATION_BY_LABEL[condition.value.toLowerCase()]
        if (id !== undefined) add({ type: 'location', key: id, op: 'has', value: null })
        break
      }

      case 'building':
        add({ type: 'building', key: toSnakeId(condition.value), op: 'has', value: null })
        break

      case 'skill':
        add({
          type: 'skill',
          key: toSnakeId(condition.value),
          op: '>=',
          value: condition.level ?? 1,
        })
        break
    }
  }

  return out
}

/**
 * The two place labels the condition column uses, spelled its way.
 *
 * Only two, and both differ from our ids, so they are written down rather than
 * slugified — `Mines` would become `mines` and our location is `the_mines`.
 */
const LOCATION_BY_LABEL: Record<string, string> = {
  mines: 'the_mines',
  'the mines': 'the_mines',
  'the deep woods': 'the_deep_woods',
}

export function buildQuests(ctx: BuildContext): Quest[] {
  const { quests } = ctx
  const characterIds = new Set(ctx.characterRules.roster.map((n) => toSnakeId(n)))
  const ids = questIds(quests.quests)

  const questIdByName = new Map(quests.quests.map((q, i) => [q.name, ids[i] ?? toSnakeId(q.name)]))

  return quests.quests.map((quest, index) => {
    const gaps: string[] = []
    const id = ids[index] ?? toSnakeId(quest.name)

    const prerequisites = resolvePrerequisites(ctx, quest.conditions, questIdByName)
    // A request that states no condition is not a request whose conditions are
    // unknown — the wiki writes "No Requirements to Appear" for exactly that
    // case. Only a quest kind the page does not gate at all keeps the gap.
    if (prerequisites.length === 0 && quest.kind !== 'request') gaps.push('prerequisites')

    const giverId = quest.giver === null ? null : toSnakeId(quest.giver)
    const giver = giverId !== null && characterIds.has(giverId) ? giverId : null
    if (giver === null) gaps.push('giver_character_id')

    // Only deliverables the wiki wrote as an item template. A sentence saying
    // "talk to Adeline" is an objective we cannot express and will not invent.
    const objectives = quest.objectives
      .filter((o) => ctx.itemByName.has(o.itemName))
      .map((o) => ({
        type: 'deliver',
        target_id: ctx.idFor(o.itemName),
        quantity: o.quantity,
      }))
    if (objectives.length === 0) gaps.push('objectives')

    const rewardItems = quest.rewardItems
      .filter((r) => ctx.itemByName.has(r.name))
      .map((r) => ctx.idFor(r.name))

    let tesserae: number | null = null
    let renown: number | null = null
    for (const reward of quest.rewardCurrency) {
      const currency = CURRENCY_TOKENS[reward.token.toLowerCase()]
      if (currency === 'tesserae') tesserae = reward.amount
      if (currency === 'renown') renown = reward.amount
    }

    const hasReward = tesserae !== null || renown !== null || rewardItems.length > 0
    if (predates1_0(quests.lastEdited)) gaps.push('predates_1_0')

    return {
      id,
      name: quest.name,
      numeric_id: null,
      numeric_id_game_version: null,
      id_status: 'provisional' as const,
      former_ids: [],
      game_version: quests.wikiVersionStamp,
      version_added: null,
      confidence: 'wiki' as const,
      prov: { '*': 'wiki_page' as const },
      data_gaps: gaps,
      icon_key: `quest/${quest.kind}`,
      wiki_page: 'Quests',
      blurb: null,

      kind: quest.kind as Quest['kind'],
      giver_character_id: giver,
      prerequisites,
      objectives,
      rewards: hasReward ? { renown, tesserae, item_ids: rewardItems } : null,
      repeatable: quest.repeatable,
      // Empty is different from "no restriction": a request with no season
      // condition is available all year, which is what null means here.
      season_restriction: quest.seasons.length > 0 ? (quest.seasons as Season[]) : null,
    }
  })
}
