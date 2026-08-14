import type { Quest, Recipe, Requirement, Season, Shop } from '@mistria/schema'
import { toSnakeId } from '@mistria/schema'
import { consola } from 'consola'
import type { ExtractedCondition } from '../../enrich/quests.js'
import type { GameBoardRequest } from '../../extract/quests.js'
import type { BuildContext } from '../context.js'
import { predates1_0 } from '../freshness.js'
import { buildLocations } from './fish-crops.js'
import { foldName, type GrantIndex } from './grants.js'

/**
 * Build the quest list.
 *
 * The point of this dataset is that gates become nameable. Mine biomes and shop
 * stock already carry `{type: "quest", key: "breaking_the_fire_seal"}`, and
 * until the quest exists the app can only say "locked" without saying by what.
 *
 * `objectives` is game-first for requests: `fetch_quests.toml` states every
 * request's wanted items as exact ids with counts (see `withGameRequests`).
 * The wiki path survives as the no-extract fallback, populated only where the
 * wiki writes a deliverable as `{{ItemIcon|Heather}} (3)` — a sentence
 * describing what to do is prose we do not copy and could not turn into a
 * structured objective without inventing one. Those carry an `objectives` gap.
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

export function buildQuests(ctx: BuildContext, builtItemIds: Set<string>): Quest[] {
  const { quests } = ctx
  const characterIds = new Set(ctx.characterRules.roster.map((n) => toSnakeId(n)))
  const ids = questIds(quests.quests)

  const questIdByName = new Map(quests.quests.map((q, i) => [q.name, ids[i] ?? toSnakeId(q.name)]))

  const built = quests.quests.map((quest, index) => {
    const gaps: string[] = []
    const id = ids[index] ?? toSnakeId(quest.name)

    const prerequisites = resolvePrerequisites(ctx, quest.conditions, questIdByName)
    // A request that states no condition is not a request whose conditions are
    // unknown — the wiki writes "No Requirements to Appear" for exactly that
    // case. Only a quest kind the page does not gate at all keeps the gap.
    if (prerequisites.length === 0 && quest.kind !== 'request') gaps.push('prerequisites')

    // The alias first: "Caldarus Human" and "Seridia Human" are the human
    // forms the two late-game characters take, and only a curated judgement
    // can say so (see curated/aliases/quest_givers.json). Everything else
    // slugifies, and either way the id must name a real villager — an alias
    // pointing at nobody is a typo, not an attribution.
    const giverId =
      quest.giver === null ? null : (ctx.questGiverAliases[quest.giver] ?? toSnakeId(quest.giver))
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
      also_known_as: [],
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

      // Stamped by `withQuestUnlocks` after shops and recipes are final —
      // these are reverse indexes over datasets that do not exist yet here.
      required_items: [],
      unlocks_shop_ids: [],
      unlocks_stock_shop_ids: [],
      unlocks_location_ids: [],
      unlocks_mine_ids: [],
      teaches_recipe_ids: [],
      unlocks_quest_ids: [],
    }
  })

  const { quests: withRequests, gameIdByQuest } = withGameRequests(
    ctx,
    built,
    characterIds,
    builtItemIds,
  )
  return withGameGates(ctx, withRequests, characterIds, builtItemIds, gameIdByQuest)
}

/**
 * Pair game board requests with our request records, inside folded-name
 * groups so a duplicate title cannot claim someone else's record.
 *
 * The game numbers its duplicates (`request_for_wood`, `request_for_wood_2`)
 * while ours carry the giver, so a straight id-first join pairs the wiki's
 * record with whichever game row happens to share its slug — Landen's row
 * claimed the record whose stated giver was Landen only by luck of the fold.
 * Within a group: giver agreement first, id equality second, lone leftovers
 * third. Game rows left over when every record is spoken for are pool entries
 * the wiki never listed — returned as `unmatched` for appending. Rows left
 * facing an unclaimed record are genuinely ambiguous (the two Eiland
 * strawberry requests share a name *and* a giver) and everything keeps its
 * wiki facts; the count is the only thing that makes that visible.
 */
export function pairBoardRequests<
  T extends { id: string; name: string; giver_character_id: string | null },
>(
  records: T[],
  rows: GameBoardRequest[],
  giverFor: (npc: string | null) => string | null,
): {
  gameByQuest: Map<string, GameBoardRequest>
  unmatched: GameBoardRequest[]
  ambiguous: number
} {
  const recordsByName = new Map<string, T[]>()
  for (const record of records) {
    const key = foldName(record.name)
    recordsByName.set(key, [...(recordsByName.get(key) ?? []), record])
  }
  const rowsByName = new Map<string, GameBoardRequest[]>()
  for (const row of rows) {
    const key = foldName(row.name ?? row.id)
    rowsByName.set(key, [...(rowsByName.get(key) ?? []), row])
  }

  const gameByQuest = new Map<string, GameBoardRequest>()
  const unmatched: GameBoardRequest[] = []
  let ambiguous = 0
  for (const [key, group] of rowsByName) {
    const unclaimed = [...(recordsByName.get(key) ?? [])]
    let remaining = [...group]
    const claim = (record: T, row: GameBoardRequest): void => {
      gameByQuest.set(record.id, row)
      unclaimed.splice(unclaimed.indexOf(record), 1)
      remaining = remaining.filter((r) => r !== row)
    }

    for (const row of [...remaining]) {
      const giver = giverFor(row.npc)
      if (giver === null) continue
      const byGiver = unclaimed.filter((q) => q.giver_character_id === giver)
      const rowsWithGiver = remaining.filter((r) => giverFor(r.npc) === giver)
      if (byGiver.length === 1 && rowsWithGiver.length === 1 && byGiver[0] !== undefined) {
        claim(byGiver[0], row)
      }
    }
    for (const row of [...remaining]) {
      const byId = unclaimed.find((q) => q.id === row.id)
      if (byId !== undefined) claim(byId, row)
    }
    if (remaining.length === 1 && unclaimed.length === 1) {
      const record = unclaimed[0]
      const row = remaining[0]
      if (record !== undefined && row !== undefined) claim(record, row)
    }

    if (unclaimed.length === 0) unmatched.push(...remaining)
    else ambiguous += remaining.length
  }

  return { gameByQuest, unmatched, ambiguous }
}

/**
 * The game-first pass over board requests.
 *
 * `fetch_quests.toml` states, per request, everything the wiki lists and more,
 * as data rather than display names: the title, the giver (`npc_for_icon` —
 * request_board.toml itself names nobody, which is why thirteen requests spent
 * a release attributed through a curated judgement), the wanted items as exact
 * internal ids with counts, and the gold/renown reward. Where both sources
 * state a field the game wins — same precedence as sell value — and the wiki
 * remains the fallback for the no-extract build.
 *
 * The join runs through `pairBoardRequests`, by folded title because our ids
 * are wiki-derived: the game's `request_for_egg` is our `request_for_eggs`.
 * Ambiguity resolves to nothing, never to a guess.
 *
 * Game requests that match no record become records: the shipped board claims
 * to be the complete pool, and until now it was the *wiki's* pool. New records
 * take the game id — they have no wiki id to preserve — so the gate and grant
 * joins hit them directly.
 */
function withGameRequests(
  ctx: BuildContext,
  built: Quest[],
  characterIds: Set<string>,
  builtItemIds: Set<string>,
): { quests: Quest[]; gameIdByQuest: Map<string, string> } {
  const game = ctx.game
  if (game === null || game.boardRequests.length === 0) {
    return { quests: built, gameIdByQuest: new Map() }
  }

  // `gameNpcIds` maps our display name to the game's npc id ("Priestess" ->
  // "seridia"); the giver join needs it the other way round.
  const characterIdByNpc = new Map(
    Object.entries(ctx.characterRules.gameNpcIds ?? {}).map(
      ([display, npcId]) => [npcId, toSnakeId(display)] as const,
    ),
  )
  const giverFor = (npc: string | null): string | null => {
    if (npc === null) return null
    const id = characterIdByNpc.get(npc) ?? npc
    return characterIds.has(id) ? id : null
  }

  const { gameByQuest, unmatched, ambiguous } = pairBoardRequests(
    built.filter((quest) => quest.kind === 'request'),
    game.boardRequests,
    giverFor,
  )

  let objectivesFilled = 0
  let giversFilled = 0
  const merged = built.map((quest): Quest => {
    const request = gameByQuest.get(quest.id)
    if (request === undefined) return quest

    const gaps = new Set(quest.data_gaps)
    const prov = { ...quest.prov }

    // Objectives: exact ids, no name matching. An id that shipped no record
    // would silently narrow the ask, so the whole list only replaces the
    // wiki's when every entry resolved.
    const wanted = request.items.filter((item) => builtItemIds.has(item.id))
    let objectives = quest.objectives
    if (wanted.length > 0 && wanted.length === request.items.length) {
      objectives = wanted.map((item) => ({
        type: 'deliver',
        target_id: item.id,
        quantity: item.quantity,
      }))
      prov.objectives = 'game_files'
      if (quest.objectives.length === 0) objectivesFilled += 1
      gaps.delete('objectives')
    }

    // The giver. The game states one for every request; the wiki's column had
    // thirteen human-form names only a curated alias could place and eleven
    // blanks. Game first, and the stamp says so.
    const giver = giverFor(request.npc)
    let giverId = quest.giver_character_id
    if (giver !== null) {
      if (quest.giver_character_id === null) giversFilled += 1
      giverId = giver
      prov.giver_character_id = 'game_files'
      gaps.delete('giver_character_id')
    }

    // Gold is tesserae in the game's spelling. Item rewards stay with the
    // grants index, which already reads the same file's reward tables.
    const tesserae = request.reward_gold ?? quest.rewards?.tesserae ?? null
    const renown = request.reward_renown ?? quest.rewards?.renown ?? null
    const itemIds = quest.rewards?.item_ids ?? []
    const hasReward = tesserae !== null || renown !== null || itemIds.length > 0
    if (request.reward_gold !== null || request.reward_renown !== null) {
      prov.rewards = 'game_files'
    }

    return {
      ...quest,
      giver_character_id: giverId,
      objectives,
      rewards: hasReward ? { renown, tesserae, item_ids: itemIds } : null,
      prov,
      data_gaps: [...gaps],
    }
  })

  // The pool members the wiki never listed. They are requests like any other:
  // real records, game-first, gated by the same request_board.toml pass that
  // runs after this one (through `gameIdByQuest`, because a game id may be
  // taken — the wiki's lone "Request for Wood" claimed `request_for_wood`
  // while the game's row of that id is Landen's separate ask, which lands
  // here and takes a giver-suffixed id instead).
  const appended: Quest[] = []
  const appendedGameIds = new Map<string, string>()
  const takenIds = new Set(built.map((quest) => quest.id))
  for (const request of unmatched) {
    const giver = giverFor(request.npc)
    const wanted = request.items.filter((item) => builtItemIds.has(item.id))
    const gaps: string[] = []
    if (giver === null) gaps.push('giver_character_id')
    if (wanted.length === 0) gaps.push('objectives')
    // The game does not state whether a request can be drawn again; the
    // schema's default is a claim, so the gap says the truth.
    gaps.push('repeatable')

    let id = request.id
    if (takenIds.has(id)) id = giver === null ? `${id}_game` : `${id}_${giver}`
    takenIds.add(id)
    appendedGameIds.set(id, request.id)

    const tesserae = request.reward_gold
    const renown = request.reward_renown
    appended.push({
      id,
      name: request.name ?? request.id,
      numeric_id: null,
      numeric_id_game_version: null,
      id_status: 'confirmed',
      former_ids: [],
      also_known_as: [],
      game_version: game.version,
      version_added: null,
      confidence: 'verified',
      prov: { '*': 'game_files' },
      data_gaps: gaps,
      icon_key: 'quest/request',
      wiki_page: null,
      blurb: null,

      kind: 'request',
      giver_character_id: giver,
      prerequisites: [],
      objectives: wanted.map((item) => ({
        type: 'deliver',
        target_id: item.id,
        quantity: item.quantity,
      })),
      rewards: tesserae !== null || renown !== null ? { renown, tesserae, item_ids: [] } : null,
      repeatable: false,
      season_restriction: null,

      required_items: [],
      unlocks_shop_ids: [],
      unlocks_stock_shop_ids: [],
      unlocks_location_ids: [],
      unlocks_mine_ids: [],
      teaches_recipe_ids: [],
      unlocks_quest_ids: [],
    })
  }

  consola.info(
    `quests: ${gameByQuest.size} of ${game.boardRequests.length} game requests joined — ` +
      `${objectivesFilled} objective list(s) and ${giversFilled} giver(s) filled, ` +
      `${appended.length} game-only request(s) appended` +
      (ambiguous > 0 ? `, ${ambiguous} ambiguous name(s) kept their wiki facts` : ''),
  )

  const gameIdByQuest = new Map([
    ...[...gameByQuest].map(([questId, request]) => [questId, request.id] as const),
    ...appendedGameIds,
  ])
  return { quests: [...merged, ...appended], gameIdByQuest }
}

/**
 * The game-union pass over quest gates.
 *
 * `request_board.toml` states each request's appearance conditions as data —
 * the wiki's condition column predates 1.0 and never heard of the apiary
 * chain, so eight requests shipped as available from day one that the game
 * holds behind a story quest. Two requirement spellings are mapped:
 * `completed_quest = "x"` directly, and `broke_X_seal = true` through the
 * seals table to the quest that breaks that seal. Everything else the file
 * states is counted and reported, never guessed at and never dropped
 * silently.
 *
 * A gate naming a quest the wiki does not list — `apiaries_and_terrariums` —
 * would dangle, so the referenced story quest is appended from the game's own
 * statement of it: title, icon NPC, stated rewards. Only *referenced* story
 * quests are appended; mirroring the whole story file would drown the list
 * in cutscene beats no other record points at.
 */
function withGameGates(
  ctx: BuildContext,
  built: Quest[],
  characterIds: Set<string>,
  builtItemIds: Set<string>,
  gameIdByQuest: Map<string, string>,
): Quest[] {
  const game = ctx.game
  if (game === null || game.requestGateByQuest.size === 0) return built

  const sealQuestBySeal = new Map(
    (game.artifactFacts?.seals ?? []).map((seal) => [seal.id, seal.questId] as const),
  )
  const knownIds = new Set(built.map((quest) => quest.id))

  // First pass: which quests do the gates reference that we do not hold?
  const referenced = new Set<string>()
  const gateFor = (quest: Quest): Requirement[] => {
    // The board's gates are keyed by the game's id, which for a wiki-derived
    // record differs — `request_for_egg` vs `request_for_eggs`. Looking up by
    // our id alone silently left those requests ungated.
    const gate = game.requestGateByQuest.get(gameIdByQuest.get(quest.id) ?? quest.id)
    if (gate === undefined) return []

    const out: Requirement[] = []
    for (const requirement of gate.requirements) {
      if (requirement.key === 'completed_quest' && typeof requirement.value === 'string') {
        referenced.add(requirement.value)
        out.push({ type: 'quest', key: requirement.value, op: 'done', value: null })
        continue
      }
      const seal = /^broke_(.+)_seal$/.exec(requirement.key)
      if (seal !== null && requirement.value === true) {
        const questId = sealQuestBySeal.get(seal[1] ?? '')
        if (questId !== undefined) {
          referenced.add(questId)
          out.push({ type: 'quest', key: questId, op: 'done', value: null })
        }
        continue
      }
      // `reached_skill_level` arrives expanded to `skill_level:<skill>` per
      // skill — a third of the board is gated this way (the fishing requests
      // behind Fishing 2, the shipping bin behind Woodcrafting 4).
      if (requirement.key.startsWith('skill_level:') && typeof requirement.value === 'number') {
        out.push({
          type: 'skill',
          key: requirement.key.slice('skill_level:'.length),
          op: '>=',
          value: requirement.value,
        })
        continue
      }
      // A `repaired_*`-style flag is a quest through the curated flag alias,
      // the same chain the shops builder resolves.
      if (requirement.value === true) {
        const flagQuest = game.questByFlag.get(requirement.key)
        if (flagQuest !== undefined) {
          referenced.add(flagQuest)
          out.push({ type: 'quest', key: flagQuest, op: 'done', value: null })
        }
      }
      // Other keys (is_season, reached_date, heart levels…) are real gates the
      // wiki often also states; mapping them is a later pass and they are
      // visible in sources/game/quests.json meanwhile.
    }
    return out
  }

  const gates = new Map(built.map((quest) => [quest.id, gateFor(quest)] as const))

  // Append the referenced story quests the wiki does not list.
  const appended: Quest[] = []
  for (const id of [...referenced].sort()) {
    if (knownIds.has(id)) continue
    const story = game.storyQuestById.get(id)
    if (story === undefined) continue

    const giver = story.npc !== null && characterIds.has(story.npc) ? story.npc : null
    const rewardItems = story.reward_item_ids.filter((itemId) => builtItemIds.has(itemId))
    const hasReward =
      story.reward_renown !== null || story.reward_tesserae !== null || rewardItems.length > 0

    appended.push({
      id,
      name: story.name ?? id,
      numeric_id: null,
      numeric_id_game_version: null,
      id_status: 'confirmed',
      former_ids: [],
      also_known_as: [],
      game_version: game.version,
      version_added: null,
      confidence: 'verified',
      prov: { '*': 'game_files' },
      // Objectives are stated only as prose stage descriptions, which are
      // never read; the gap says so instead of paraphrasing them.
      data_gaps: ['objectives', 'prerequisites'],
      icon_key: 'quest/story',
      wiki_page: null,
      blurb: null,

      kind: 'story',
      giver_character_id: giver,
      prerequisites: [],
      objectives: [],
      rewards: hasReward
        ? {
            renown: story.reward_renown,
            tesserae: story.reward_tesserae,
            item_ids: rewardItems,
          }
        : null,
      repeatable: false,
      season_restriction: null,

      required_items: [],
      unlocks_shop_ids: [],
      unlocks_stock_shop_ids: [],
      unlocks_location_ids: [],
      unlocks_mine_ids: [],
      teaches_recipe_ids: [],
      unlocks_quest_ids: [],
    })
    knownIds.add(id)
  }
  if (appended.length > 0) {
    consola.info(
      `quests: appended ${appended.length} game story quest(s) referenced as gates — ` +
        appended.map((quest) => quest.id).join(', '),
    )
  }

  // Second pass: merge the mapped gates in, dropping any quest gate whose
  // target record still does not exist (a dangling gate helps nobody and
  // fails refint). A skill gate names a skill, not a quest, so it skips that
  // check and dedupes against whatever the wiki already stated.
  let gated = 0
  const merged = built.map((quest) => {
    const extra = (gates.get(quest.id) ?? []).filter(
      (requirement) =>
        (requirement.type !== 'quest' || knownIds.has(requirement.key)) &&
        !quest.prerequisites.some((p) => p.type === requirement.type && p.key === requirement.key),
    )
    if (extra.length === 0) return quest
    gated += 1
    return {
      ...quest,
      prerequisites: [...quest.prerequisites, ...extra],
      data_gaps: quest.data_gaps.filter((gap) => gap !== 'prerequisites'),
    }
  })
  if (gated > 0) consola.info(`quests: ${gated} requests gained appearance gates from the game`)

  return [...merged, ...appended]
}

/**
 * The stamp-afterwards pass: what a quest costs, unlocks and teaches.
 *
 * Runs from `data.ts` once shops and recipes are final, because every field it
 * fills is a **reverse index over facts stated elsewhere** — a shop whose
 * `unlock_requires` names the quest, a mine biome curated as opening after it,
 * a recipe whose sources already carry the quest id, a delivery the game
 * states as `supplied_items`. Nothing here is a new claim, which is why no
 * entry carries its own confidence: anything not flatly stated stays out, and
 * a join that does not resolve is dropped and counted, never guessed.
 *
 * This is what turns "Repair the Bridge — no rewards recorded" into the
 * answer the player wanted: what to bring, and that the six Saturday Market
 * stalls are the reward.
 */
export function withQuestUnlocks(
  ctx: BuildContext,
  quests: Quest[],
  inputs: {
    shops: Shop[]
    recipes: Recipe[]
    grants: GrantIndex
    builtItemIds: Set<string>
  },
): Quest[] {
  const { shops, recipes, grants, builtItemIds } = inputs
  const questIds = new Set(quests.map((quest) => quest.id))

  const push = (map: Map<string, string[]>, questId: string, value: string): void => {
    const list = map.get(questId) ?? []
    if (!list.includes(value)) list.push(value)
    map.set(questId, list)
  }

  const shopsByQuest = new Map<string, string[]>()
  for (const shop of shops) {
    for (const gate of shop.unlock_requires) {
      if (gate.type === 'quest' && questIds.has(gate.key)) push(shopsByQuest, gate.key, shop.id)
    }
  }

  // Stock-line gates, kept apart from whole-shop gates: Hayden's barn upgrade
  // adds 24 lines to a shop that was open all along, and "unlocks Hayden's
  // Shop" would be a false statement about a true fact.
  const stockShopsByQuest = new Map<string, string[]>()
  for (const shop of shops) {
    for (const line of shop.stock) {
      for (const gate of line.requires) {
        if (gate.type === 'quest' && questIds.has(gate.key)) {
          push(stockShopsByQuest, gate.key, shop.id)
        }
      }
    }
  }

  const locationsByQuest = new Map<string, string[]>()
  for (const location of buildLocations(ctx)) {
    for (const gate of location.unlock_requires) {
      if (gate.type === 'quest' && questIds.has(gate.key)) {
        push(locationsByQuest, gate.key, location.id)
      }
    }
  }

  // The same curated join `buildSeals` runs — from the biome's own statement,
  // not from the seals dataset, so a future biome gated by a non-seal quest
  // still lands here.
  const minesByQuest = new Map<string, string[]>()
  for (const biome of ctx.mines.biomes) {
    if (biome.unlock_quest === null) continue
    const questId = toSnakeId(biome.unlock_quest)
    if (questIds.has(questId)) push(minesByQuest, questId, biome.id)
  }

  // Museum reward tiers ship `method: 'quest'` with a null source_id and are
  // correctly invisible here — a reward band is not a quest record.
  const recipesByQuest = new Map<string, string[]>()
  for (const recipe of recipes) {
    for (const source of recipe.sources) {
      if (source.method === 'quest' && source.source_id !== null) {
        push(recipesByQuest, source.source_id, recipe.id)
      }
    }
  }

  // What each quest asks the player to hand over: the game's `supplied_items`
  // stages — seal offerings and the bridge/mill/inn repairs alike. Joined by
  // id first, folded title second; multiple stages concatenate in extract
  // order, never summed — arithmetic the source does not state.
  const questsByName = new Map<string, Quest[]>()
  for (const quest of quests) {
    const key = foldName(quest.name)
    questsByName.set(key, [...(questsByName.get(key) ?? []), quest])
  }

  // A game quest id -> our record id: direct hit first, then through the
  // display name the game itself states — `repair_haydens_barn` is titled
  // "Upgrade Hayden's Barn", which is exactly our wiki-derived id. Ambiguous
  // or unknown resolves to null, never to a guess.
  const resolveGameQuest = (gameId: string): string | null => {
    if (questIds.has(gameId)) return gameId
    const name = ctx.game?.storyQuestById.get(gameId)?.name ?? null
    if (name === null) return null
    const byName = questsByName.get(foldName(name)) ?? []
    return byName.length === 1 ? (byName[0]?.id ?? null) : null
  }

  // The letter chain, both ways round: a letter that starts Q and waits on P
  // being done makes P a stated prerequisite of Q, and Q the follow-up P
  // unlocks. A row naming a quest no record holds is counted, never guessed.
  const nextQuestsByQuest = new Map<string, string[]>()
  const chainGateByQuest = new Map<string, string>()
  let unresolvedChains = 0
  for (const chain of ctx.game?.unlocks?.letterQuests ?? []) {
    if (chain.requires_completed_quest === null) continue
    const started = resolveGameQuest(chain.quest_to_start)
    const gate = resolveGameQuest(chain.requires_completed_quest)
    if (started === null || gate === null) {
      unresolvedChains += 1
      continue
    }
    push(nextQuestsByQuest, gate, started)
    chainGateByQuest.set(started, gate)
  }
  if (unresolvedChains > 0) {
    consola.info(
      `quests: ${unresolvedChains} letter chain(s) name a quest no record holds — dropped.`,
    )
  }

  const costByQuest = new Map<string, { item_id: string; quantity: number }[]>()
  let unresolvedOfferings = 0
  let droppedOfferingItems = 0
  for (const offering of ctx.game?.artifactFacts?.offerings ?? []) {
    let questId: string | null = questIds.has(offering.quest_id) ? offering.quest_id : null
    if (questId === null && offering.quest_name !== null) {
      const byName = questsByName.get(foldName(offering.quest_name)) ?? []
      questId = byName.length === 1 ? (byName[0]?.id ?? null) : null
    }
    if (questId === null) {
      unresolvedOfferings += 1
      continue
    }
    const kept = offering.items.filter((entry) => builtItemIds.has(entry.item_id))
    droppedOfferingItems += offering.items.length - kept.length
    const sorted = [...kept].sort((a, b) => a.item_id.localeCompare(b.item_id))
    costByQuest.set(questId, [...(costByQuest.get(questId) ?? []), ...sorted])
  }
  if (unresolvedOfferings > 0) {
    consola.info(
      `quests: ${unresolvedOfferings} delivery stage(s) name a quest no record holds — ` +
        'the cost stays in game facts, the quest ships without it.',
    )
  }
  if (droppedOfferingItems > 0) {
    consola.info(
      `quests: ${droppedOfferingItems} delivery item(s) did not ship as records and were dropped.`,
    )
  }

  let stamped = 0
  const result = quests.map((quest) => {
    const requiredItems = costByQuest.get(quest.id) ?? []
    const shopIds = [...(shopsByQuest.get(quest.id) ?? [])].sort()
    const stockShopIds = [...(stockShopsByQuest.get(quest.id) ?? [])].sort()
    const locationIds = [...(locationsByQuest.get(quest.id) ?? [])].sort()
    const mineIds = [...(minesByQuest.get(quest.id) ?? [])].sort()
    const recipeIds = [...(recipesByQuest.get(quest.id) ?? [])].sort()
    const nextQuestIds = [...(nextQuestsByQuest.get(quest.id) ?? [])].sort()
    const chainGate = chainGateByQuest.get(quest.id) ?? null
    const gainsChainGate =
      chainGate !== null &&
      !quest.prerequisites.some((p) => p.type === 'quest' && p.key === chainGate)
    const grantItems = grants.itemsByQuest.get(quest.id) ?? []

    const untouched =
      requiredItems.length === 0 &&
      shopIds.length === 0 &&
      stockShopIds.length === 0 &&
      locationIds.length === 0 &&
      mineIds.length === 0 &&
      recipeIds.length === 0 &&
      nextQuestIds.length === 0 &&
      !gainsChainGate &&
      grantItems.length === 0
    if (untouched) return quest
    stamped += 1

    // Game grant items union into the reward the record already states — the
    // same field the wiki fills, deduplicated, so the UI keeps one list.
    const rewards =
      grantItems.length === 0
        ? quest.rewards
        : {
            renown: quest.rewards?.renown ?? null,
            tesserae: quest.rewards?.tesserae ?? null,
            item_ids: [...new Set([...(quest.rewards?.item_ids ?? []), ...grantItems])].sort(),
          }

    // Per-field provenance, only where a field actually got a value: the
    // deliveries and taught recipes are read from the game files, the unlock
    // gates from curated statements.
    const prov = { ...quest.prov }
    if (requiredItems.length > 0) prov.required_items = 'game_files'
    if (recipeIds.length > 0) prov.teaches_recipe_ids = 'game_files'
    if (shopIds.length > 0) prov.unlocks_shop_ids = 'manual'
    if (stockShopIds.length > 0) prov.unlocks_stock_shop_ids = 'game_files'
    if (locationIds.length > 0) prov.unlocks_location_ids = 'manual'
    if (mineIds.length > 0) prov.unlocks_mine_ids = 'manual'
    if (nextQuestIds.length > 0) prov.unlocks_quest_ids = 'game_files'
    if (gainsChainGate) prov.prerequisites = 'game_files'

    const dropGaps = new Set<string>()
    // A stated delivery answers "what does it ask for" — the gap closes.
    if (requiredItems.length > 0) dropGaps.add('objectives')
    if (gainsChainGate) dropGaps.add('prerequisites')

    return {
      ...quest,
      required_items: requiredItems,
      unlocks_shop_ids: shopIds,
      unlocks_stock_shop_ids: stockShopIds,
      unlocks_location_ids: locationIds,
      unlocks_mine_ids: mineIds,
      teaches_recipe_ids: recipeIds,
      unlocks_quest_ids: nextQuestIds,
      prerequisites: gainsChainGate
        ? [
            ...quest.prerequisites,
            { type: 'quest' as const, key: chainGate, op: 'done' as const, value: null },
          ]
        : quest.prerequisites,
      rewards,
      prov,
      data_gaps: quest.data_gaps.filter((gap) => !dropGaps.has(gap)),
    }
  })
  if (stamped > 0) {
    consola.info(`quests: ${stamped} quest(s) gained costs, unlocks or grant rewards`)
  }

  return result
}
