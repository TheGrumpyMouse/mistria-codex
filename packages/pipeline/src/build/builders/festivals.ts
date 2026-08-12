import { type Festival, toSnakeId } from '@mistria/schema'
import { consola } from 'consola'
import type { BuildContext } from '../context.js'
import { predates1_0 } from '../freshness.js'

type ContestPlace = Festival['contest_tiers'][number]['place']

/**
 * The place a tier is, read out of its result cutscene's name — the only
 * place the game states it (`spring_festival_third_place`). Longest suffix
 * first, or `first_place_plus` would read as `first_place`.
 */
const PLACE_SUFFIXES: [string, ContestPlace][] = [
  ['first_place_plus', 'first_place_plus'],
  ['first_place', 'first_place'],
  ['second_place', 'second_place'],
  ['third_place', 'third_place'],
  ['no_place', 'no_place'],
]

const placeOf = (cutscene: string | null): ContestPlace | null => {
  if (cutscene === null) return null
  for (const [suffix, place] of PLACE_SUFFIXES) if (cutscene.endsWith(suffix)) return place
  return null
}

/**
 * Build the annual festivals.
 *
 * Ten records for four live events. The six unimplemented ones are kept and
 * flagged rather than dropped: a player who sees Fall 28 blank wants to know
 * whether we checked, and the app can say "the files have a Halloween Festival,
 * the game does not run it" — which is both true and more useful than silence.
 *
 * The four live ones join to the game's own rows in `festivals.toml`, matched
 * on the display name the file states. What that fills is structural, never
 * prose: `activities` is a controlled vocabulary read off stated tables — a
 * `challenges` array is a judged contest, an `npc_date` table means you can
 * invite someone, `stocks` means stalls — and the UI owns the words. The
 * Animal Festival's placement prizes come from misc.toml's templated ids,
 * expanded only against item ids the game actually declares.
 *
 * `time` stays empty deliberately: it is nowhere in the files or on any of the
 * four pages, so it is a gap rather than a guess. A festival with an unknown
 * time still matches every time of day in a query and is badged — the same
 * rule that keeps thin time data from hiding correct answers everywhere else.
 */
export function buildFestivals(ctx: BuildContext, builtItemIds: Set<string>): Festival[] {
  const { festivals } = ctx

  // The templated prize ids (`white_{AnimalKind}_wall_ribbon`), expanded
  // against the ids the game declares — never minted. An expansion that ships
  // no record is dropped and counted below, not guessed at.
  const gameItemIds = ctx.game === null ? new Set<string>() : ctx.game.itemIds
  const expandTemplates = (templates: string[]): { shipped: string[]; dropped: string[] } => {
    const shipped: string[] = []
    const dropped: string[] = []
    for (const template of templates) {
      const pattern = new RegExp(`^${template.replace('{AnimalKind}', '[a-z_]+')}$`)
      for (const id of gameItemIds) {
        if (!pattern.test(id)) continue
        if (builtItemIds.has(id)) shipped.push(id)
        else dropped.push(id)
      }
    }
    return { shipped: shipped.sort(), dropped: dropped.sort() }
  }

  let droppedRewards: string[] = []
  const droppedContests: string[] = []
  const built = festivals.festivals.map((festival) => {
    const id = toSnakeId(festival.name)
    const gaps: string[] = ['time']

    const game = ctx.game?.gameFestivalByName.get(festival.name) ?? null

    // The wiki's location cell is a display name ("Mistria", "The Summit");
    // the game's is a room id (`town`). Both resolve through their own alias
    // tables, and the game's answer wins where both exist — it is the row the
    // event actually runs from.
    const wikiResolved =
      festival.location === null
        ? null
        : ctx.resolver.resolveLocations([festival.location], `festival:${id}`)
    const gameLocation =
      game?.location == null ? null : (ctx.game?.locationByRoom.get(game.location) ?? null)
    const locationId = gameLocation ?? wikiResolved?.locations[0] ?? null
    if (locationId === null) gaps.push('location_id')

    // Structural mechanics -> controlled vocabulary. The UI owns the words;
    // an unknown token must render as nothing, never raw.
    const activities: string[] = []
    if (game?.has_contest === true) activities.push('contest')
    if (game?.has_npc_date === true) activities.push('invite')
    if (game !== null && game.stalls.length > 0) activities.push('stalls')
    if (game === null || activities.length === 0) gaps.push('activities')

    let rewards: string[] = []
    if (id === 'animal_festival' && ctx.game !== null) {
      const expanded = expandTemplates([
        ...ctx.game.animalRewardTemplates.small.placeables,
        ...ctx.game.animalRewardTemplates.large.placeables,
      ])
      rewards = expanded.shipped
      droppedRewards = [...droppedRewards, ...expanded.dropped]
    }
    if (rewards.length === 0) gaps.push('rewards')

    // The contest placings: challenge tier_results (which place each tier
    // is) joined to the quest's required_score list on their shared
    // artifact_key, index-aligned. A challenge whose two halves disagree on
    // length ships nothing — a misaligned place is a wrong fact — and is
    // counted below rather than guessed at.
    const contestTiers: Festival['contest_tiers'] = []
    for (const challenge of game?.challenges ?? []) {
      const tiers =
        challenge.artifact_key === null
          ? undefined
          : ctx.game?.questRewardTiersByArtifact.get(challenge.artifact_key)
      if (tiers === undefined) continue
      if (tiers.scores.length !== challenge.tier_cutscenes.length) {
        droppedContests.push(
          `${id}: ${challenge.artifact_key} states ${challenge.tier_cutscenes.length} tier ` +
            `result(s) but ${tiers.quest} states ${tiers.scores.length} score(s)`,
        )
        continue
      }
      for (const [index, cutscene] of challenge.tier_cutscenes.entries()) {
        const place = placeOf(cutscene)
        const score = tiers.scores[index] ?? null
        if (place === null || score === null) {
          droppedContests.push(`${id}: tier ${index} of ${challenge.artifact_key} names no place`)
          continue
        }
        contestTiers.push({ place, score })
      }
    }

    // The contest collectible (Breath of Spring, Queen Berry) — gathered
    // before the day, ranked on it. Not a stall currency; the stalls charge
    // tesserae. See curated/vocab/calendar.json.
    const contestItemName = festivals.contestItems[festival.name]
    const contestItemId =
      contestItemName === undefined
        ? null
        : ctx.itemByName.has(contestItemName)
          ? ctx.idFor(contestItemName)
          : null

    if (predates1_0(festivals.lastEdited)) gaps.push('predates_1_0')

    const prov: Festival['prov'] = { '*': 'wiki_page' }
    if (gameLocation !== null) prov.location_id = 'game_files'
    if (activities.length > 0) prov.activities = 'game_files'
    if (rewards.length > 0) prov.rewards = 'game_files'
    if (contestTiers.length > 0) prov.contest_tiers = 'game_files'

    return {
      id,
      name: festival.name,
      // The wiki's calendar marks these with an asterisk: described for a
      // future update, not run by the game. The UI veils them accordingly.
      ...(festival.implemented ? {} : { unreleased: true as const }),
      numeric_id: null,
      numeric_id_game_version: null,
      id_status: 'provisional' as const,
      former_ids: [],
      also_known_as: [],
      game_version: game === null ? festivals.wikiVersionStamp : (ctx.game?.version ?? null),
      version_added: null,
      confidence: game === null ? ('wiki' as const) : ('verified' as const),
      prov,
      data_gaps: gaps,
      icon_key: `festival/${id}`,
      wiki_page: festival.page,
      blurb: null,

      date: { season: festival.season, day: festival.day },
      implemented: festival.implemented,
      location_id: locationId,
      time: null,
      contest_item_id: contestItemId,
      contest_tiers: contestTiers,
      activities,
      rewards,
      prerequisites: [],
      // Filled by the stamp-afterwards pass in data.ts, once the grant index
      // has resolved against the final records.
      goods: [],
    } as Festival
  })

  if (droppedRewards.length > 0) {
    consola.info(
      `festivals: ${droppedRewards.length} stated prize id(s) ship no record and were dropped — ` +
        [...new Set(droppedRewards)].slice(0, 4).join(', ') +
        '…',
    )
  }
  if (droppedContests.length > 0) {
    consola.warn(
      `festivals: ${droppedContests.length} contest tier(s) dropped — ${droppedContests.join('; ')}`,
    )
  }
  return built
}
