import type { Monster } from '@mistria/schema'
import { toSnakeId } from '@mistria/schema'
import type { BuildContext } from '../context.js'
import { predates1_0 } from '../freshness.js'

/**
 * Build the mines' monsters.
 *
 * Two judgements live here, and both are about what not to say.
 *
 * **A perk-gated drop is not a drop.** Every family drops a pet skin at 5%,
 * but only once Friend-Shaped is unlocked, and `drops` has nowhere to put a
 * condition. Emitting it anyway would state a 5% chance that is zero for most
 * players, so those move to a `perk_gated_drops` gap.
 *
 * **A short list is not the same as a complete one.** The Mimic's drop table
 * names a hat and then links away, because what it drops depends on the biome
 * it was fed in. Without the `drops` gap that record would read as a monster
 * that drops one hat and nothing else.
 */
export function buildMonsters(ctx: BuildContext): Monster[] {
  const extract = ctx.monsters
  const incomplete = new Set(extract.incompleteKeys)

  // Biome order is floor order, the same reading `{{BiomesQuick|3}}` uses.
  const inFloorOrder = [...ctx.mines.biomes].sort((a, b) => a.floors.min - b.floors.min)

  return extract.monsters.map((monster): Monster => {
    const id = toSnakeId(monster.name)
    const gaps: string[] = []

    // The Mimic's row says "All", which is written out rather than left as an
    // empty list. An empty list would read exactly like "we don't know", and
    // those two must never look the same. Expanding is safe because the biome
    // list is curated in this repo, so "all" cannot silently mean "all but the
    // one added last week".
    const biomeIds =
      monster.biomeOrders.length === 0
        ? inFloorOrder.map((biome) => biome.id)
        : monster.biomeOrders
            .map((order) => inFloorOrder[order - 1]?.id)
            .filter((biomeId): biomeId is string => biomeId !== undefined)
    if (monster.biomeOrders.length > 0 && biomeIds.length !== monster.biomeOrders.length) {
      gaps.push('biome_ids')
    }

    const drops: Monster['drops'] = []
    let perkGated = false
    for (const drop of extract.dropsByKey[monster.dropsKey] ?? []) {
      if (drop.requiresPerk !== null) {
        perkGated = true
        continue
      }
      if (!ctx.itemByName.has(drop.item)) {
        ctx.resolver.recordUnresolved(drop.item, 'monster_drop', `monster:${id}`)
        // A hat that the wiki files under Accessories is a category we have not
        // ingested, not a hole in the loot table. Naming those apart is what
        // stops thirty-three `drops` gaps from reading as thirty-three
        // monsters whose loot we failed to parse.
        gaps.push(drop.kind === 'accessory' ? 'cosmetic_drops' : 'drops')
        continue
      }
      drops.push({ item_id: ctx.idFor(drop.item), chance: drop.chance, quantity: null })
    }

    if (perkGated) gaps.push('perk_gated_drops')
    if (incomplete.has(monster.dropsKey)) gaps.push('drops')
    // Neither page states either number for any monster.
    gaps.push('hp', 'combat_xp')
    if (predates1_0(extract.lastEdited)) gaps.push('predates_1_0')

    return {
      id,
      name: monster.name,
      numeric_id: null,
      numeric_id_game_version: null,
      id_status: 'provisional',
      former_ids: [],
      also_known_as: [],
      game_version: null,
      version_added: null,
      confidence: 'wiki',
      prov: { '*': 'wiki_page' },
      data_gaps: [...new Set(gaps)].sort(),
      icon_key: `monster/${id}`,
      wiki_page: monster.family.replace(/ /g, '_'),
      blurb: null,

      biome_ids: biomeIds,
      hp: null,
      drops: drops.sort((a, b) => a.item_id.localeCompare(b.item_id)),
      combat_xp: null,
    }
  })
}

/** Which monsters live in each biome, derived rather than authored twice. */
export function monstersByBiome(monsters: Monster[]): Map<string, string[]> {
  const byBiome = new Map<string, string[]>()
  for (const monster of monsters) {
    for (const biomeId of monster.biome_ids) {
      const list = byBiome.get(biomeId) ?? []
      list.push(monster.id)
      byBiome.set(biomeId, list)
    }
  }
  for (const list of byBiome.values()) list.sort()
  return byBiome
}
