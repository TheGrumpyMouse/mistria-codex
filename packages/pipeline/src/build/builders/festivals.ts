import { type Festival, toSnakeId } from '@mistria/schema'
import type { BuildContext } from '../context.js'
import { predates1_0 } from '../freshness.js'

/**
 * Build the annual festivals.
 *
 * Ten records for four live events. The six unimplemented ones are kept and
 * flagged rather than dropped: a player who sees Fall 28 blank wants to know
 * whether we checked, and the app can say "the files have a Halloween Festival,
 * the game does not run it" — which is both true and more useful than silence.
 *
 * Two fields stay empty deliberately. `activities` would be a copy of the wiki's
 * own sentences describing what happens at the festival, which this project does
 * not do; and `time` is nowhere on any of the four pages, so it is a gap rather
 * than a guess. A festival with an unknown time still matches every time of day
 * in a query and is badged — the same rule that keeps thin time data from
 * hiding correct answers everywhere else.
 */
export function buildFestivals(ctx: BuildContext): Festival[] {
  const { festivals } = ctx

  return festivals.festivals.map((festival) => {
    const id = toSnakeId(festival.name)
    const gaps: string[] = ['time', 'activities', 'rewards']

    // The location cell is a display name ("Mistria", "The Summit"), resolved
    // through the same alias table as every other place in the dataset.
    const resolved =
      festival.location === null
        ? null
        : ctx.resolver.resolveLocations([festival.location], `festival:${id}`)
    const locationId = resolved?.locations[0] ?? null
    if (locationId === null) gaps.push('location_id')

    const currencyName = festivals.currencies[festival.name]
    const currencyId =
      currencyName === undefined
        ? null
        : ctx.itemByName.has(currencyName)
          ? ctx.idFor(currencyName)
          : null

    if (predates1_0(festivals.lastEdited)) gaps.push('predates_1_0')

    return {
      id,
      name: festival.name,
      numeric_id: null,
      numeric_id_game_version: null,
      id_status: 'provisional' as const,
      former_ids: [],
      also_known_as: [],
      game_version: festivals.wikiVersionStamp,
      version_added: null,
      confidence: 'wiki' as const,
      prov: { '*': 'wiki_page' as const },
      data_gaps: gaps,
      icon_key: `festival/${id}`,
      wiki_page: festival.page,
      blurb: null,

      date: { season: festival.season, day: festival.day },
      implemented: festival.implemented,
      location_id: locationId,
      time: null,
      currency_item_id: currencyId,
      activities: [],
      rewards: [],
      prerequisites: [],
    } as Festival
  })
}
