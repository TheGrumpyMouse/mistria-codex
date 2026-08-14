import type { Currency, DayOfWeek, Requirement, Season, Shop } from '@mistria/schema'
import { SEASONS, toSnakeId } from '@mistria/schema'
import { consola } from 'consola'
import type { BuildContext, ShopStockRow } from '../context.js'
import { predates1_0 } from '../freshness.js'

/**
 * Build the eight shops and their stock.
 *
 * This is the record that answers "where do I buy this, and what does it cost",
 * which the Items table cannot: it carries an `isBuyable` flag and nothing else.
 *
 * `hours` is empty on every shop and that is a **fact, not a gap**. Fields of
 * Mistria's shops never close — you can buy until 2am, which is when the day
 * ends — so there is no restriction to record. None of the shops carries an
 * `hours` data gap, because an un-clearable warning on every shop would be worse
 * than useless.
 */

/**
 * Which shops sell each item, for stamping onto `Item.sold_by`.
 *
 * Derived here rather than authored on the item, so the two can't disagree: the
 * shop's stock list is the one place a price and a seller are recorded.
 *
 * **A recipe line is not a seller of the thing.** It is addressed by the item
 * the recipe makes, so counting it here would put the Inn in the Lemon Pie's
 * `sold_by` on the strength of selling the *scroll* — and give the item a
 * "buy it here" window at a shop that stocks no pies.
 */
export function soldByIndex(shops: Shop[]): Map<string, string[]> {
  const index = new Map<string, string[]>()
  for (const shop of shops) {
    for (const line of shop.stock) {
      if (line.teaches_recipe_id !== null) continue
      const sellers = index.get(line.item_id) ?? []
      if (!sellers.includes(shop.id)) sellers.push(shop.id)
      index.set(line.item_id, sellers)
    }
  }
  return index
}

/** `{{Skill|Fishing}} Level 8` — the level is sometimes lower-cased. */
const SKILL_LEVEL = /\{\{Skill\|([^}|]+)\}\}\s*Level\s*(\d+)/i
/** `{{SkillPerk|Steady Supplies}}` or `{{SkillPerk|Mining|Treasure Hunter}}`. */
const SKILL_PERK = /\{\{SkillPerk\|([^}]+)\}\}/i
/** `{{SourceIcon|Story Quest Short|Upgrade The Inn}}` — the kind, then the name. */
const SOURCE_ICON = /\{\{SourceIcon\|([^}|]+)(?:\|([^}|]+))?/i

/**
 * Turn one wiki requirement cell into a structured Requirement.
 *
 * Returns `null` for `{{SourceIcon|Start}}`, which means "available from the
 * start" — an absence of requirement rather than an unparsed one. Returns
 * `undefined` when the token means something we can't express, so the caller can
 * count it rather than drop it silently.
 */
export function parseRequirement(token: string): Requirement | null | undefined {
  const skill = SKILL_LEVEL.exec(token)
  if (skill !== null) {
    return {
      type: 'skill',
      key: toSnakeId(skill[1] ?? ''),
      op: '>=',
      value: Number(skill[2]),
    }
  }

  const perk = SKILL_PERK.exec(token)
  if (perk !== null) {
    // Either `Perk` or `Skill|Perk`; the perk is always the last parameter.
    const parts = (perk[1] ?? '').split('|').map((p) => p.trim())
    const name = parts.at(-1) ?? ''
    if (name !== '') return { type: 'perk', key: toSnakeId(name), op: 'has', value: null }
  }

  const source = SOURCE_ICON.exec(token)
  if (source !== null) {
    const kind = (source[1] ?? '').trim()
    if (/^start$/i.test(kind)) return null
    const questName = (source[2] ?? '').trim()
    if (/quest/i.test(kind) && questName !== '') {
      return { type: 'quest', key: toSnakeId(questName), op: 'done', value: null }
    }
  }

  return undefined
}

export function buildShops(ctx: BuildContext, furnitureShipped?: Map<string, string>): Shop[] {
  const { shops } = ctx
  const characterIds = new Set(ctx.characterRules.roster.map((n) => toSnakeId(n)))

  // Furniture display names -> the collapsed record that carries them, for
  // the wiki store pages that stock a bookshelf. Only unambiguous names —
  // a name two products share identifies neither.
  const furnitureByName = new Map<string, string | null>()
  if (ctx.game !== null && furnitureShipped !== undefined) {
    for (const [gameId, shippedId] of furnitureShipped) {
      const name = ctx.game.itemById.get(gameId)?.name
      if (name == null) continue
      const known = furnitureByName.get(name)
      if (known === undefined) furnitureByName.set(name, shippedId)
      else if (known !== shippedId) furnitureByName.set(name, null)
    }
  }

  /**
   * Which of a link's two halves names the item.
   *
   * `[[Cosmetics_(Clothes)#Skirts|Maid Skirt]]` hides it in the display text;
   * `[[Copper Axe|Axe]]` hides it in the target. Trying the item list is the
   * only thing that gets both right, and a link matching neither is a real
   * unresolved reference rather than something to pick a half of and hope.
   */
  const resolveItem = (row: ShopStockRow): string | null => {
    for (const candidate of [row.item.display, row.item.target]) {
      if (candidate !== '' && ctx.itemByName.has(candidate)) return ctx.idFor(candidate)
    }
    // The wiki's furniture stock predates the ingestion; the names join here.
    for (const candidate of [row.item.display, row.item.target]) {
      const shippedId = furnitureByName.get(candidate)
      if (typeof shippedId === 'string') return shippedId
    }
    return null
  }

  const wikiShops = shops.shops.map((shop): Shop => {
    const gaps: string[] = []
    const unknownTokens = new Set<string>()
    let unresolvedItems = 0
    let unparsedRequires = 0
    let filledPrices = 0
    const priceDrift: string[] = []

    const stock: Shop['stock'] = []
    const seen = new Set<string>()

    for (const row of shops.stock.filter((r) => r.shopId === shop.id)) {
      const itemId = resolveItem(row)
      if (itemId === null) {
        // Almost all of these are furniture, decor and pet items, which live in
        // the FurnitureTEMP Cargo table and are not ingested yet. They go in the
        // unresolved queue rather than being counted and forgotten — a shop
        // quietly missing three quarters of its stock is exactly the kind of
        // hole that only shows up when a player looks for something.
        unresolvedItems += 1
        ctx.resolver.recordUnresolved(
          row.item.display !== '' ? row.item.display : row.item.target,
          'shop_stock_item',
          `shop:${shop.id}`,
        )
        continue
      }

      // The heading is the only thing that says this row is the recipe rather
      // than the thing it makes: both link to the same article, and the wiki
      // files them under `… > Recipes`.
      const teachesRecipeId = /(^|>\s*)recipes\s*$/i.test(row.section) ? itemId : null

      // A price token that is neither a currency nor a known stat is not
      // defaulted to tesserae — that would invent a price out of a stat.
      let price: number | null = null
      let currency: Currency = 'tesserae'
      for (const candidate of row.prices) {
        const mapped = shops.priceTokens[candidate.token]
        if (mapped !== undefined) {
          price = candidate.amount
          currency = mapped
          break
        }
        if (!shops.nonPriceTokens.has(candidate.token)) unknownTokens.add(candidate.token)
      }

      // Where the page prints no price, the item's own `value.store` fills it.
      // **Only where the page prints none, and never on a recipe line.** A
      // stated wiki price is per-shop and knows the difference between the
      // Lemon Pie and its recipe scroll, which the item's single global value
      // cannot: the Inn sells the pie at 650 and the scroll at 400, and the
      // global number is the pie's. Filling a scroll line from it would price
      // the scroll at the dish's price and look entirely plausible.
      // Where the two disagree on a line the wiki *did* price, the wiki wins
      // and the disagreement is counted below rather than resolved silently.
      const gamePrice =
        teachesRecipeId === null ? (ctx.game?.itemById.get(itemId)?.buy_value ?? null) : null
      if (price === null && currency === 'tesserae' && gamePrice !== null) {
        price = gamePrice
        filledPrices += 1
      } else if (price !== null && gamePrice !== null && price !== gamePrice) {
        priceDrift.push(`${itemId} (page ${price}, files ${gamePrice})`)
      }

      const requires: Requirement[] = []
      for (const token of row.requires) {
        const parsed = parseRequirement(token)
        if (parsed === undefined) unparsedRequires += 1
        else if (parsed !== null) requires.push(parsed)
      }

      // The same item is listed twice — once as the dish and once as its
      // recipe scroll — and the *only* thing distinguishing them is the heading
      // the row sits under. Keying the dedupe by price instead let both through
      // as two identical-looking dish lines at two prices: 23 of them at the
      // Inn, with nothing saying which was the recipe.
      const key = `${itemId}|${teachesRecipeId === null ? 'item' : 'recipe'}|${currency}`
      if (seen.has(key)) continue
      seen.add(key)

      stock.push({
        item_id: itemId,
        price,
        currency,
        requires,
        seasons: (row.seasons as Season[] | null) ?? null,
        rotation: shop.rotates,
        teaches_recipe_id: teachesRecipeId,
      })
    }

    if (unresolvedItems > 0) gaps.push('stock_items')
    if (unparsedRequires > 0) gaps.push('stock_requires')
    if (stock.some((line) => line.price === null)) gaps.push('stock_price')
    if (predates1_0(shop.lastEdited)) gaps.push('predates_1_0')
    if (filledPrices > 0) {
      consola.info(`${shop.name}: ${filledPrices} price(s) filled from the game files`)
    }
    if (priceDrift.length > 0) {
      // Kept, not resolved. The page states a per-shop price and the files a
      // global one; where they differ one of them is describing something
      // else, and that is a question for a person.
      consola.info(
        `${shop.name}: ${priceDrift.length} price(s) differ from the files — ` +
          `page wins: ${priceDrift.slice(0, 3).join(', ')}`,
      )
    }
    if (unknownTokens.size > 0) {
      consola.warn(
        `${shop.name}: unrecognised price tokens ${[...unknownTokens].join(', ')} — ` +
          'add them to priceTokens or nonPriceTokens in curated/vocab/shops.json',
      )
    }

    const resolved =
      shop.location === null
        ? null
        : ctx.resolver.resolveLocations([shop.location], `shop:${shop.id}`)
    const locationId = resolved?.locations[0] ?? null
    if (locationId === null) gaps.push('location_id')

    const staff = shop.staff.map((n) => toSnakeId(n)).filter((id) => characterIds.has(id))
    const owner = shop.owner === null ? null : toSnakeId(shop.owner)

    return {
      id: shop.id,
      name: shop.name,
      numeric_id: null,
      numeric_id_game_version: null,
      id_status: 'provisional' as const,
      former_ids: [],
      also_known_as: [],
      game_version: shop.wikiVersionStamp,
      version_added: null,
      confidence: 'wiki' as const,
      prov: { '*': 'wiki_page' as const },
      data_gaps: gaps,
      icon_key: `shop/${shop.id}`,
      wiki_page: shop.page,
      blurb: null,

      location_id: locationId,
      owner_character_id: owner !== null && characterIds.has(owner) ? owner : null,
      staff_character_ids: staff,
      // Empty means no restriction. Shops in this game do not close.
      hours: [],
      seasonal_closures: [],
      unlock_requires: [],
      stock,
    }
  })

  return [
    ...withGameStoreStock(ctx, wikiShops, furnitureShipped),
    ...buildMarketStalls(ctx, characterIds, furnitureShipped),
  ]
}

/**
 * Stock lines the game states and the wiki page never listed, appended to the
 * wiki shop.
 *
 * The wiki's store pages are tables someone typed, and whole shelves are
 * missing from them — Hayden's pet beds and toys, the animal accessories, the
 * Carpenter's bonsai. `stores.toml` states every line, so anything that
 * resolves to a record the page did not already stock is appended, deduped by
 * the resolved id (never by name — the two sources word names differently).
 *
 * Gates come through where they are expressible: a season, a perk, a
 * per-species `unlocked_animal`, a completed quest. A line whose gate cannot
 * be stated is held back and counted — shipping it ungated would claim
 * "always stocked", the wrong direction to be wrong in. Prices fill from the
 * item's global `value.store` exactly like the page path, and only ever a
 * null.
 */
function withGameStoreStock(
  ctx: BuildContext,
  wikiShops: Shop[],
  furnitureShipped?: Map<string, string>,
): Shop[] {
  const game = ctx.game
  if (game === null) return wikiShops

  const resolveItemId = (entry: {
    item: string | null
    cosmetic: string | null
    animal: string | null
    animal_cosmetic: string | null
  }): { id: string | null; label: string } => {
    if (entry.cosmetic !== null) {
      return {
        id: game.cosmeticById.has(entry.cosmetic) ? entry.cosmetic : null,
        label: entry.cosmetic,
      }
    }
    if (entry.animal !== null && entry.animal_cosmetic !== null) {
      const name =
        game.animalCosmeticNameByPair.get(`${entry.animal}|${entry.animal_cosmetic}`) ?? null
      if (name === null) return { id: null, label: `${entry.animal}:${entry.animal_cosmetic}` }
      return { id: ctx.itemByName.has(name) ? ctx.idFor(name) : null, label: name }
    }
    if (entry.item !== null) {
      const fromFurniture = furnitureShipped?.get(entry.item)
      if (fromFurniture !== undefined) return { id: fromFurniture, label: entry.item }
      if (ctx.gameOnlyItems.includes(entry.item)) return { id: entry.item, label: entry.item }
      const name = game.itemById.get(entry.item)?.name ?? null
      if (name !== null && ctx.itemByName.has(name)) return { id: ctx.idFor(name), label: name }
      return { id: null, label: name ?? entry.item }
    }
    return { id: null, label: '' }
  }

  let appended = 0
  let unresolved = 0
  let heldBack = 0
  const result = wikiShops.map((record) => {
    const source = ctx.shops.shops.find((s) => s.id === record.id)
    const store = source?.gameStoreId == null ? undefined : game.storeById.get(source.gameStoreId)
    if (store === undefined) return record

    const stocked = new Set(record.stock.map((line) => line.item_id))
    const lines: Shop['stock'] = []
    for (const category of store.categories) {
      const rotation = category.target_selections !== null
      for (const entry of category.entries) {
        // Scroll-only lines belong to the recipe's own sources, not here.
        if (entry.item === null && entry.cosmetic === null && entry.animal_cosmetic === null) {
          continue
        }
        const { id: itemId, label } = resolveItemId(entry)
        if (itemId === null) {
          unresolved += 1
          ctx.resolver.recordUnresolved(label, 'shop_stock_item', `shop:${record.id}`)
          continue
        }
        if (stocked.has(itemId)) continue

        let season: Season | null = null
        const requires: Requirement[] = []
        let expressible = true
        for (const requirement of [
          ...entry.requirements,
          ...entry.unread_requirement_keys.map((key) => ({ key, value: undefined })),
        ]) {
          if (requirement.key === 'is_season' && typeof requirement.value === 'string') {
            season = SEASONS.find((s) => s === requirement.value) ?? null
            continue
          }
          if (requirement.key === 'has_perk' && typeof requirement.value === 'string') {
            requires.push({ type: 'perk', key: requirement.value, op: 'has', value: null })
            continue
          }
          if (requirement.key === 'unlocked_animal' && typeof requirement.value === 'string') {
            requires.push({ type: 'animal', key: requirement.value, op: 'has', value: null })
            continue
          }
          // A `repaired_*`-style flag is a quest, through the chain
          // requirements.toml states and curated/aliases/game_flags.json
          // resolves — the Seed Maker's general-store line is gated exactly
          // this way. A flag with no entry falls through to held-back, never
          // to a guess; a wrong mapping fails refint on the quest id.
          if (requirement.value === true) {
            const flagQuest = game.questByFlag.get(requirement.key)
            if (flagQuest !== undefined) {
              requires.push({ type: 'quest', key: flagQuest, op: 'done', value: null })
              continue
            }
          }
          // `reached_skill_level = { ranching = 45 }` arrives from the extract
          // expanded to one `skill_level:<skill>` entry per skill.
          if (requirement.key.startsWith('skill_level:') && typeof requirement.value === 'number') {
            requires.push({
              type: 'skill',
              key: requirement.key.slice('skill_level:'.length),
              op: '>=',
              value: requirement.value,
            })
            continue
          }
          // `completed_quest` values are the game's own quest keys, which do
          // not all match our records (`repair_haydens_barn` vs
          // `upgrade_haydens_barn`) — and a gate naming a quest we cannot link
          // is worse than holding the line back until the join exists.
          expressible = false
        }
        if (!expressible) {
          heldBack += 1
          continue
        }

        const poolSeason = SEASONS.find((s) => s === entry.pool) ?? null
        stocked.add(itemId)
        lines.push({
          item_id: itemId,
          price:
            entry.cosmetic !== null
              ? (game.cosmeticById.get(entry.cosmetic)?.price_override ?? null)
              : (game.itemById.get(entry.item ?? '')?.buy_value ?? null),
          currency: 'tesserae' as const,
          requires,
          seasons: season !== null ? [season] : poolSeason !== null ? [poolSeason] : null,
          rotation: rotation || entry.pool === 'random',
          teaches_recipe_id: null,
        })
      }
    }
    if (lines.length === 0) return record
    appended += lines.length
    return { ...record, stock: [...record.stock, ...lines] }
  })

  if (appended > 0) {
    consola.info(`shops: ${appended} stock line(s) joined from the game's store file`)
  }
  if (heldBack > 0) {
    consola.info(`shops: ${heldBack} game stock line(s) held back — gates not expressible yet`)
  }
  if (unresolved > 0) {
    consola.warn(`shops: ${unresolved} game stock line(s) name no record — queued.`)
  }
  return result
}

/**
 * The Saturday Market stalls, from the game's own store file.
 *
 * The wiki keeps these six vendors on one event page the store parser cannot
 * read; `stores.toml` states each stall's stock as data, per category, with
 * the rotation size (`target_selections`) and per-line gates. What the game
 * does NOT state is prices — items carry a store value, stock lines do not —
 * so every line ships `price: null` and the stall carries a `stock_price`
 * gap until someone parses the wiki's market page.
 *
 * Lines are gated on the item actually shipping this build, the same rule as
 * recipes: cosmetics are deferred wholesale, furniture arrives with its own
 * ingestion (`furnitureShipped` maps a game id to the collapsed record that
 * carries it), and anything else unresolved goes in the queue rather than
 * being counted and forgotten.
 */
function buildMarketStalls(
  ctx: BuildContext,
  characterIds: Set<string>,
  furnitureShipped?: Map<string, string>,
): Shop[] {
  const market = ctx.shops.market
  const game = ctx.game
  if (market === null || game === null || game.storeById.size === 0) return []

  // Where the record for a game item id will live this build, or null.
  const shipsAs = (gameId: string): string | null => {
    if (ctx.gameOnlyItems.includes(gameId)) return gameId
    const fromFurniture = furnitureShipped?.get(gameId)
    if (fromFurniture !== undefined) return fromFurniture
    const name = game.itemById.get(gameId)?.name ?? null
    if (name !== null && ctx.itemByName.has(name)) return ctx.idFor(name)
    return null
  }

  // What a cosmetic costs: the files' own override where they state one, the
  // wiki's price otherwise. The same two sources the cosmetics builder joins,
  // read here so the shop record prices its own shelf rather than making the
  // reader open the item to find out.
  const wikiPrice = new Map(
    (ctx.cosmetics?.cosmetics ?? []).map((row) => [row.name, row.price] as const),
  )
  const cosmeticPrice = (id: string): number | null => {
    const cosmetic = game.cosmeticById.get(id)
    if (cosmetic === undefined) return null
    return cosmetic.price_override ?? wikiPrice.get(cosmetic.name) ?? null
  }

  const unlock: Requirement[] = [
    { type: 'quest', key: market.unlockQuest, op: 'done', value: null },
  ]
  const days = market.days as DayOfWeek[]

  const stalls: Shop[] = []
  for (const vendor of market.vendors) {
    const store = game.storeById.get(vendor.storeId)
    if (store === undefined) {
      throw new Error(
        `curated/vocab/shops.json names market vendor "${vendor.storeId}", which is not a ` +
          'store section in sources/game/stores.json. Fix the id or re-run pnpm extract.',
      )
    }

    const gaps: string[] = []
    let cosmetics = 0
    let unresolvedItems = 0
    let ungated = 0
    const stock: Shop['stock'] = []
    const seen = new Set<string>()

    for (const category of store.categories) {
      const rotation = category.target_selections !== null
      for (const entry of category.entries) {
        // A cosmetic is a wardrobe id, not an item id, and it ships as its own
        // record — so the stock line resolves straight to it.
        const cosmeticId =
          entry.cosmetic !== null && game.cosmeticById.has(entry.cosmetic) ? entry.cosmetic : null

        // A scroll line sells the recipe for a thing, not the thing. It is
        // addressed by the item the recipe makes — which is also the recipe's
        // id — so the line still links somewhere useful, and `teaches_recipe_id`
        // is what stops it rendering as a second copy of the product. These
        // used to be dropped outright as "a later pass", which is why the Inn
        // and the Tackle Shop shipped their Recipes shelves empty.
        //
        // **`include_recipe` is a different line and must not come through
        // here.** `{ item = "haunted_attic_bed", include_recipe = true }` sells
        // the bed *and* teaches its recipe: it is a real product line with a
        // real price and a real seller. Treating it as a scroll nulls the price
        // and drops the stall out of the item's `sold_by`, which is exactly
        // what it did. The recipe half is already recorded — `buildGrantIndex`
        // reads the same flag and writes "Sold at Merri's Stall" onto the
        // recipe's own sources.
        const scrollFor = entry.recipe_scroll

        if (entry.item === null && cosmeticId === null && entry.recipe_scroll === null) {
          cosmetics += 1
          continue
        }

        const gameItemId = entry.item ?? entry.recipe_scroll ?? ''
        const itemId = cosmeticId ?? shipsAs(gameItemId)
        if (itemId === null) {
          unresolvedItems += 1
          ctx.resolver.recordUnresolved(
            game.itemById.get(gameItemId)?.name ?? gameItemId,
            'shop_stock_item',
            `shop:${vendor.shopId}`,
          )
          continue
        }

        // The only gates these six stalls state: is_season (a seasons entry,
        // not a requirement), has_perk, and three one-off flags the model
        // cannot express (an upstairs, a partner, a cutscene). A line whose
        // gate cannot be stated is held back — shipping it ungated would
        // claim "always stocked", which is the wrong direction to be wrong in.
        let season: Season | null = null
        let perk: string | null = null
        let expressible = true
        for (const requirement of [
          ...entry.requirements,
          ...entry.unread_requirement_keys.map((key) => ({ key, value: undefined })),
        ]) {
          if (requirement.key === 'is_season' && typeof requirement.value === 'string') {
            season = SEASONS.find((s) => s === requirement.value) ?? null
            continue
          }
          if (requirement.key === 'has_perk' && typeof requirement.value === 'string') {
            perk = requirement.value
            continue
          }
          expressible = false
        }
        if (!expressible) {
          ungated += 1
          continue
        }

        const poolSeason = SEASONS.find((s) => s === entry.pool) ?? null
        const seasons = season ?? poolSeason

        // A scroll only becomes a `teaches_recipe_id` if the recipe it names
        // resolves to a shipped record; `buildData` nulls anything that did not.
        const teachesRecipeId = scrollFor === null ? null : shipsAs(scrollFor)

        // The scroll and the product are two lines, not one, so the dedupe key
        // has to know which it is looking at.
        const key = `${itemId}|${teachesRecipeId === null ? 'item' : 'recipe'}|${seasons ?? ''}`
        if (seen.has(key)) continue
        seen.add(key)

        stock.push({
          item_id: itemId,
          // No wiki page prices these stalls, so the files are the only
          // source: a cosmetic's own price, or the item's `value.store`.
          //
          // A scroll line gets **no** price from that field. `value.store` is
          // what the product costs, and a scroll priced at its product's price
          // is a wrong number that looks entirely reasonable.
          price:
            teachesRecipeId !== null
              ? null
              : cosmeticId === null
                ? (game.itemById.get(gameItemId)?.buy_value ?? null)
                : cosmeticPrice(cosmeticId),
          currency: 'tesserae',
          requires: perk === null ? [] : [{ type: 'perk', key: perk, op: 'has', value: null }],
          seasons: seasons === null ? null : [seasons],
          rotation,
          teaches_recipe_id: teachesRecipeId,
        })
      }
    }

    if (stock.length === 0) {
      // A stall whose every line is deferred (Louis and Vera sell only
      // cosmetics today) still exists — the player can walk up to it — so the
      // record ships with its gaps saying why it looks empty.
      gaps.push('stock')
    }
    if (cosmetics > 0 || unresolvedItems > 0) gaps.push('stock_items')
    if (ungated > 0) {
      gaps.push('stock_requires')
      consola.info(
        `${store.name ?? vendor.shopId}: ${ungated} stock line(s) held back — ` +
          'their gates are not expressible yet',
      )
    }
    if (stock.some((line) => line.price === null)) gaps.push('stock_price')

    const resolved = ctx.resolver.resolveLocations([market.location], `shop:${vendor.shopId}`)

    stalls.push({
      id: vendor.shopId,
      name: store.name ?? vendor.shopId,
      numeric_id: null,
      numeric_id_game_version: null,
      id_status: 'provisional',
      former_ids: [],
      also_known_as: [],
      game_version: game.version,
      version_added: null,
      confidence: 'verified',
      prov: { '*': 'game_files' },
      data_gaps: gaps,
      icon_key: `shop/${vendor.shopId}`,
      wiki_page: market.wikiPage,
      blurb: null,

      location_id: resolved.locations[0] ?? null,
      owner_character_id: characterIds.has(vendor.storeId) ? vendor.storeId : null,
      staff_character_ids: characterIds.has(vendor.storeId) ? [vendor.storeId] : [],
      // A full-Saturday window: the market is weekly, and shops in this game
      // have no within-day closing time (`to: "00:00"` is end of day).
      hours: [{ days, from: '00:00', to: '00:00' }],
      seasonal_closures: [],
      unlock_requires: unlock,
      stock,
    })
  }

  return stalls
}
