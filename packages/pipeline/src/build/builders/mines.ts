import type { Item, MineBiome, Requirement } from '@mistria/schema'
import { toSnakeId } from '@mistria/schema'
import type { BuildContext } from '../context.js'

/**
 * Build the five mine biomes.
 *
 * The floor range is the load-bearing field. `depth` on an availability window
 * is already a floor range, so a biome record is what lets the app turn "floors
 * 21-39" into "the Tide Caverns" in a sentence, and back again when a player
 * asks where an item is.
 *
 * `fish_item_ids` is derived rather than curated: every fish already carries the
 * biome as a location on its availability window, so repeating the list by hand
 * would create a second copy to drift out of sync with the first. The same
 * reasoning is why forageables and bugs are not copied here at all — the item
 * records own that relationship, and a query by location answers it.
 */
export function buildMines(
  ctx: BuildContext,
  items: Item[],
  monstersByBiome: Map<string, string[]>,
): MineBiome[] {
  const { mines } = ctx

  // Item ids for anything found in the biome, keyed by the biome's location.
  const fishByLocation = new Map<string, string[]>()
  for (const item of items) {
    if (item.category !== 'fish') continue
    for (const window of item.availability) {
      for (const locationId of window.locations) {
        const list = fishByLocation.get(locationId) ?? []
        if (!list.includes(item.id)) list.push(item.id)
        fishByLocation.set(locationId, list)
      }
    }
  }

  return mines.biomes.map((biome) => {
    const monsterIds = monstersByBiome.get(biome.id) ?? []
    const gaps: string[] = []
    // Every biome has monsters; an empty list means the Monsters page stopped
    // naming this one, not that it is peaceful.
    if (monsterIds.length === 0) gaps.push('monster_ids')

    const oreIds: string[] = []
    for (const oreName of [...biome.ore_item_names, ...mines.commonDropItemNames]) {
      // An ore that isn't in Items means the wiki renamed it. Recording the gap
      // beats quietly shipping a biome whose ore list is one short.
      if (!ctx.itemByName.has(oreName)) {
        gaps.push(`ore:${ctx.idFor(oreName)}`)
        continue
      }
      const id = ctx.idFor(oreName)
      if (!oreIds.includes(id)) oreIds.push(id)
    }

    // The quest that opens this biome. Quests are not ingested yet, so the key
    // is a provisional slug of the quest's name — which is exactly what the
    // quest's own id will be when they land, so nothing has to be rewritten.
    const gate: Requirement[] =
      biome.unlock_quest === null
        ? []
        : [{ type: 'quest', key: toSnakeId(biome.unlock_quest), op: 'done', value: null }]

    const fishIds = [...(fishByLocation.get(biome.location_id) ?? [])].sort()

    return {
      id: biome.id,
      name: biome.name,
      numeric_id: null,
      numeric_id_game_version: null,
      id_status: 'provisional' as const,
      former_ids: [],
      game_version: null,
      version_added: null,
      confidence: 'wiki' as const,
      prov: { '*': 'manual' as const },
      data_gaps: gaps,
      icon_key: `mine/${biome.id}`,
      wiki_page: biome.wiki_page,
      blurb: null,

      floors: biome.floors,
      ore_item_ids: oreIds,
      monster_ids: monsterIds,
      fish_item_ids: fishIds,
      artifact_set_ids: biome.artifact_set_ids,
      hazards: biome.hazards,
      gate,
      location_id: biome.location_id,
    }
  })
}
