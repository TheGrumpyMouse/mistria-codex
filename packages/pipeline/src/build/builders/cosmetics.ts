import type { AvailabilityWindow, Item, Season, Shop } from '@mistria/schema'
import { SEASONS } from '@mistria/schema'
import { consola } from 'consola'
import type { BuildContext } from '../context.js'

/**
 * The player's wardrobe, as item records.
 *
 * Two sources, each answering what the other cannot. The game files name all
 * 360 cosmetics, give each a body slot and a wardrobe category, and say which
 * stall stocks it — but price only 26. The wiki's three cosmetics pages price
 * 128 of them and add a colour count and a sprite. Joined on display name,
 * which is the same seam every other wiki join in this project runs on.
 *
 * They ship as items in the `cosmetic` category rather than as their own
 * dataset: a player looking for the Maid Dress searches the same box they use
 * for a Maid Skirt, and the shop, search, browse and icon machinery all key on
 * items. The game's own model disagrees — a cosmetic is a wardrobe entry, not
 * an `ItemId` — so nothing here may claim `id_status: 'confirmed'`, and the
 * ids are asserted not to collide with real items before anything ships.
 *
 * **Colour variants are not separate records.** `dress_maid` is one wardrobe
 * entry the game recolours with a palette; the wiki's "6 colour variants" is a
 * count, carried as `variant_count`. That is the opposite of furniture, where
 * each colourway is its own item and had to be collapsed.
 *
 * Anything the wardrobe gives you at character creation carries no price and
 * no seller — `default_unlocked` — and says so rather than looking unpriced.
 */
export function buildCosmetics(ctx: BuildContext, shops: Shop[], takenIds: Set<string>): Item[] {
  const game = ctx.game
  if (game === null || game.cosmetics.length === 0) return []

  const wikiByName = new Map(ctx.cosmetics?.cosmetics.map((row) => [row.name, row]) ?? [])

  // Which stalls sell each cosmetic, from the stock already built.
  const sellersById = new Map<string, Shop[]>()
  for (const shop of shops) {
    for (const line of shop.stock) {
      sellersById.set(line.item_id, [...(sellersById.get(line.item_id) ?? []), shop])
    }
  }

  const records: Item[] = []
  let matched = 0
  let priced = 0

  for (const cosmetic of game.cosmetics) {
    if (takenIds.has(cosmetic.id)) {
      throw new Error(
        `cosmetic "${cosmetic.id}" collides with an item of the same id. The two id spaces ` +
          'have never overlapped before — resolve it by hand rather than letting one win.',
      )
    }

    const wiki = wikiByName.get(cosmetic.name)
    if (wiki !== undefined) matched += 1

    // The files' own price wins where they state one; the wiki fills the rest.
    const price = cosmetic.price_override ?? wiki?.price ?? null
    if (price !== null) priced += 1

    const sellers = sellersById.get(cosmetic.id) ?? []
    const gaps: string[] = []
    if (price === null && !cosmetic.default_unlocked) gaps.push('buy_value')
    if (sellers.length === 0 && !cosmetic.default_unlocked) gaps.push('obtain_method')

    records.push({
      id: cosmetic.id,
      name: cosmetic.name,
      category: 'cosmetic',
      numeric_id: null,
      numeric_id_game_version: null,
      // A wardrobe entry is not an ItemId, so "confirmed" — which means "this
      // id is in the game's item enum" — would be a false claim about it.
      id_status: 'provisional',
      former_ids: [],
      also_known_as: [],
      game_version: game.version,
      version_added: null,
      confidence: 'verified',
      prov: price === null ? { '*': 'game_files' } : { '*': 'game_files', buy_value: 'wiki_page' },
      data_gaps: gaps,
      icon_key: `cosmetic/${cosmetic.id}`,
      wiki_page: wiki?.page.replace(/ /g, '_') ?? null,
      blurb: null,

      // The wardrobe's own grouping — `dress`, `backpacks`, `hair_long` — is
      // what Browse sub-groups by, exactly as furniture uses its set.
      subcategory: cosmetic.sub_category ?? cosmetic.slot,
      base_item_id: null,
      quality: null,

      // Cosmetics cannot be sold back; that is not a missing number.
      sell_value: null,
      buy_value: price,
      stamina: null,
      health: null,
      mana: null,

      is_consumable: false,
      is_craftable: null,
      is_buyable: sellers.length > 0 ? true : null,
      is_giftable: false,

      tags: [],
      museum: null,

      availability: sellers.length === 0 ? [] : [shopWindow(sellers)],
      used_in_recipe_ids: [],
      sold_by: sellers.map((shop) => shop.id).sort(),

      ...(cosmetic.default_unlocked ? { default_unlocked: true as const } : {}),
      ...(wiki?.variants != null && wiki.variants > 1 ? { variant_count: wiki.variants } : {}),
      ...(cosmetic.slot === null ? {} : { worn_on: cosmetic.slot }),
    })
  }

  consola.info(
    `cosmetics: ${records.length} records · ${matched} matched on the wiki · ${priced} priced`,
  )
  return records
}

/**
 * One "buy it" window covering every stall that stocks it.
 *
 * `days` is the union of the sellers' opening days — the market stalls are
 * Saturdays only, and a window without that would put a hat in Tuesday's
 * findable list. A seller with no stated days means no restriction, which
 * collapses the whole union to null rather than to that shop's empty list.
 * Locations are left for the shop post-pass in `build/data.ts`, which already
 * resolves a `shop` window's place from its sellers.
 */
function shopWindow(sellers: Shop[]): AvailabilityWindow {
  const unrestricted = sellers.some((shop) => shop.hours.length === 0)
  const days = unrestricted
    ? null
    : [...new Set(sellers.flatMap((shop) => shop.hours.flatMap((h) => h.days)))].sort()

  return {
    method: 'shop',
    habitats: [],
    locations: [],
    spot_ids: [],
    seasons: [...SEASONS] as Season[],
    weather: null,
    weather_precision: 'unknown',
    time: null,
    // Shops do not close within a day — the same sourced fact that puts
    // `shop` on the not-applicable list in curated/vocab/method_rules.json.
    time_precision: 'not_applicable',
    time_blocks: null,
    days: days !== null && days.length > 0 ? (days as AvailabilityWindow['days']) : null,
    dates: [],
    depth: null,
    biome_id: null,
    min_year: null,
    rarity: null,
    chance: null,
    quantity: null,
    requires: [],
    confidence: 'verified',
    prov: 'game_files',
  }
}
