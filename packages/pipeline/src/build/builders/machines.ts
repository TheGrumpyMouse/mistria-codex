import type { Machine, Rarity, Season } from '@mistria/schema'
import { RARITIES, SEASONS } from '@mistria/schema'
import { consola } from 'consola'
import type { BuildContext } from '../context.js'

/**
 * Production machines, from the game's factory prototypes.
 *
 * The item record says an Apiary exists and what it costs to craft; this
 * dataset says what it *does* — which bees it takes, which honey each rarity
 * yields, which flowers it asks for in spring. Everything is resolved to item
 * ids here so the app never sees a game tag: "accepts `bee`" becomes the
 * seven bee item ids, read off the items' own tag lists.
 */
export function buildMachines(ctx: BuildContext, itemIds: Set<string>): Machine[] {
  const game = ctx.game
  if (game === null) return []

  const machines: Machine[] = []
  for (const factory of game.factories) {
    // Same gate as recipes: the machine ships when its item record does.
    if (!itemIds.has(factory.id)) continue
    const item = game.itemById.get(factory.id)

    // legal minus illegal, over the game's own item tags. The terrarium
    // accepts `bugs` and refuses `bee` — bees go in the apiary.
    const accepts = [...game.itemById.values()]
      .filter(
        (candidate) =>
          candidate.tags.some((tag) => factory.legal_tags.includes(tag)) &&
          !candidate.tags.some((tag) => factory.illegal_tags.includes(tag)) &&
          itemIds.has(candidate.id),
      )
      .map((candidate) => candidate.id)
      .sort()

    // `rewards_map` is indexed by input rarity. Five entries, five rarities —
    // a sixth would mean the game changed its rarity model, which must be
    // looked at rather than mislabelled.
    if (factory.rewards_map.length !== RARITIES.length) {
      throw new Error(
        `${factory.id}: rewards_map has ${factory.rewards_map.length} tiers, ` +
          `expected ${RARITIES.length} (one per rarity). The rarity model changed — remap it.`,
      )
    }
    const yields = factory.rewards_map.map((row, index) => ({
      input_rarity: RARITIES[index] as Rarity,
      item_ids: [...new Set(row.filter((id) => itemIds.has(id)))].sort(),
    }))

    let droppedRequests = 0
    const requests = factory.requests.flatMap((request) => {
      if (!itemIds.has(request.item)) {
        droppedRequests += 1
        return []
      }
      const season = SEASONS.find((s) => s === request.season) ?? null
      return [
        {
          item_id: request.item,
          season: season as Season | null,
          // The game's `repaired_general_store` gate is the story quest, which
          // already ships — the same fact in the vocabulary the app reads.
          requires: request.repaired_general_store
            ? [
                {
                  type: 'quest' as const,
                  key: 'repair_the_general_store',
                  op: 'done' as const,
                  value: null,
                },
              ]
            : [],
        },
      ]
    })
    if (droppedRequests > 0) {
      consola.info(`machines: ${factory.id} has ${droppedRequests} requests for un-ingested items`)
    }

    machines.push({
      id: factory.id,
      name: item?.name ?? factory.id,
      numeric_id: null,
      numeric_id_game_version: null,
      id_status: 'confirmed',
      former_ids: [],
      also_known_as: [],
      game_version: game.version,
      version_added: null,
      confidence: 'verified',
      prov: { '*': 'game_files' },
      data_gaps: [],
      // The same key as the item record, so both resolve to one sprite.
      icon_key: `misc/${factory.id}`,
      wiki_page: null,
      blurb: null,

      item_id: factory.id,
      days_to_produce: factory.days_to_produce,
      capacity: factory.inventory_size,
      accepts_item_ids: accepts,
      yields,
      requests,
    })
  }

  return machines
}
