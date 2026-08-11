import type { Monster } from '@mistria/schema'
import { toSnakeId } from '@mistria/schema'
import { consola } from 'consola'
import type { GameMonsterDrop } from '../../extract/monsters.js'
import type { BuildContext } from '../context.js'
import { predates1_0 } from '../freshness.js'

/**
 * Build the mines' monsters: the wiki's roster, the game's numbers.
 *
 * The wiki names the 35 monsters, their families and their floors, and that
 * stays the spine of the dataset. What it almost never records is a number —
 * no hp, no damage, and drop chances of varying age — and all of those are
 * stated per variant in `fiddle/monsters/`, joined here through
 * `curated/aliases/game_monsters.json`.
 *
 * The game's drop lists also carry exact internal ids, including `cosmetic`
 * entries that name `player_assets` keys directly — which is what dissolved
 * the 34 unresolved "Rockclod Hat" tokens the wiki's display names produced.
 *
 * **A perk-gated drop ships gated, not silenced.** Every family's pet skin
 * drops only with Friend-Shaped active (`MonsterUtils.gml` checks the perk
 * wherever the item carries `pet_skin_unlock`), so the line carries
 * `requires_perk` and the UI badges it. The old behaviour — dropping the line
 * and noting a gap — stated less than the game does.
 *
 * Where no game extract exists the wiki path below still runs whole, so a
 * clone without `sources/game/monsters.json` builds the bestiary it always had.
 */
export function buildMonsters(ctx: BuildContext, builtItemIds: Set<string>): Monster[] {
  const extract = ctx.monsters
  const incomplete = new Set(extract.incompleteKeys)
  const gameJoined = ctx.game !== null && ctx.game.monsterFactsById.size > 0

  // Biome order is floor order, the same reading `{{BiomesQuick|3}}` uses.
  const inFloorOrder = [...ctx.mines.biomes].sort((a, b) => a.floors.min - b.floors.min)

  let unresolvedGameDrops = 0
  const readGameDrops = (
    monsterId: string,
    drops: GameMonsterDrop[],
    gaps: string[],
  ): Monster['drops'] => {
    const out: Monster['drops'] = []
    for (const drop of drops) {
      if (!builtItemIds.has(drop.id)) {
        // An exact internal id that ships no record — count it and say so; a
        // dropped drop must never be silence.
        ctx.resolver.recordUnresolved(drop.id, 'monster_drop', `monster:${monsterId}`)
        unresolvedGameDrops += 1
        gaps.push('drops')
        continue
      }
      const gameItem = ctx.game?.itemById.get(drop.id)
      out.push({
        item_id: drop.id,
        // The file writes percent; the schema stores 0..1 like the wiki path.
        chance: drop.chance === null ? null : drop.chance / 100,
        quantity:
          drop.count_range === null ? null : { min: drop.count_range[0], max: drop.count_range[1] },
        requires_perk:
          gameItem?.pet_skin_unlock !== null && gameItem?.pet_skin_unlock !== undefined
            ? 'friend_shaped'
            : null,
      })
    }
    return out.sort((a, b) => a.item_id.localeCompare(b.item_id))
  }

  const built = extract.monsters.map((monster): Monster => {
    const id = toSnakeId(monster.name)
    const gaps: string[] = []
    const facts = ctx.game?.monsterFactsById.get(id) ?? null

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

    // Drops: the game's list where one is stated (exact ids, exact chances),
    // the wiki's otherwise. The Mimic states none — its loot depends on the
    // biome it spawned in — so it keeps the wiki's partial list and its gap.
    let drops: Monster['drops']
    let superDrops: Monster['drops'] = []
    let dropsFromGame = false
    if (facts !== null && facts.drops.length > 0) {
      dropsFromGame = true
      drops = readGameDrops(id, facts.drops, gaps)
      superDrops = readGameDrops(id, facts.super_drops, gaps)
    } else {
      drops = []
      let perkGated = false
      for (const drop of extract.dropsByKey[monster.dropsKey] ?? []) {
        if (drop.requiresPerk !== null) {
          perkGated = true
          continue
        }
        if (!ctx.itemByName.has(drop.item)) {
          ctx.resolver.recordUnresolved(drop.item, 'monster_drop', `monster:${id}`)
          gaps.push(drop.kind === 'accessory' ? 'cosmetic_drops' : 'drops')
          continue
        }
        drops.push({
          item_id: ctx.idFor(drop.item),
          chance: drop.chance,
          quantity: null,
          requires_perk: null,
        })
      }
      drops.sort((a, b) => a.item_id.localeCompare(b.item_id))
      if (perkGated) gaps.push('perk_gated_drops')
    }
    if (incomplete.has(monster.dropsKey)) gaps.push('drops')

    if (facts === null) {
      // Neither wiki page states any of the numbers.
      gaps.push('hp', 'damage', 'essence')
    }
    if (predates1_0(extract.lastEdited)) gaps.push('predates_1_0')

    const prov: Monster['prov'] = { '*': 'wiki_page' }
    if (facts !== null) {
      prov.hp = 'game_files'
      prov.damage = 'game_files'
      prov.essence = 'game_files'
      prov.coins = 'game_files'
      if (dropsFromGame) prov.drops = 'game_files'
    }

    return {
      id,
      name: monster.name,
      numeric_id: null,
      numeric_id_game_version: null,
      id_status: 'provisional',
      former_ids: [],
      also_known_as: [],
      game_version: facts === null ? null : (ctx.game?.version ?? null),
      version_added: null,
      confidence: facts === null ? 'wiki' : 'verified',
      prov,
      data_gaps: [...new Set(gaps)].sort(),
      icon_key: `monster/${id}`,
      wiki_page: monster.family.replace(/ /g, '_'),
      blurb: null,

      biome_ids: biomeIds,
      hp: facts?.hp ?? null,
      damage: facts?.damage ?? null,
      essence: facts?.essence ?? null,
      coins:
        facts?.coin_count == null ? null : { min: facts.coin_count[0], max: facts.coin_count[1] },
      drops,
      super_drops: superDrops,
    }
  })

  if (gameJoined) {
    const statted = built.filter((m) => m.hp !== null).length
    consola.info(`monsters: ${statted}/${built.length} joined to game variant tables`)
    const unmapped = ctx.game?.unmappedMonsterVariants ?? []
    // sapling_orange_mini is the known, deliberate residue — see the alias file.
    if (unmapped.length > 0) {
      consola.info(`monsters: ${unmapped.length} game variant(s) unmapped — ${unmapped.join(', ')}`)
    }
  }
  if (unresolvedGameDrops > 0) {
    consola.warn(`monsters: ${unresolvedGameDrops} game drop id(s) ship no record`)
  }

  return built
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
