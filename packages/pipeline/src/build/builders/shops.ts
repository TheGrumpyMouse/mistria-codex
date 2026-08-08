import type { Currency, Requirement, Season, Shop } from '@mistria/schema'
import { toSnakeId } from '@mistria/schema'
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
 */
export function soldByIndex(shops: Shop[]): Map<string, string[]> {
  const index = new Map<string, string[]>()
  for (const shop of shops) {
    for (const line of shop.stock) {
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

export function buildShops(ctx: BuildContext): Shop[] {
  const { shops } = ctx
  const characterIds = new Set(ctx.characterRules.roster.map((n) => toSnakeId(n)))

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
    return null
  }

  return shops.shops.map((shop) => {
    const gaps: string[] = []
    const unknownTokens = new Set<string>()
    let unresolvedItems = 0
    let unparsedRequires = 0

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

      const requires: Requirement[] = []
      for (const token of row.requires) {
        const parsed = parseRequirement(token)
        if (parsed === undefined) unparsedRequires += 1
        else if (parsed !== null) requires.push(parsed)
      }

      // The same item can be listed twice — once as a dish and once as its
      // recipe scroll, at different prices. Keyed by item and price so both
      // survive, while a genuine duplicate row does not.
      const key = `${itemId}|${price ?? ''}|${currency}`
      if (seen.has(key)) continue
      seen.add(key)

      stock.push({
        item_id: itemId,
        price,
        currency,
        requires,
        seasons: (row.seasons as Season[] | null) ?? null,
        rotation: shop.rotates,
      })
    }

    if (unresolvedItems > 0) gaps.push('stock_items')
    if (unparsedRequires > 0) gaps.push('stock_requires')
    if (stock.some((line) => line.price === null)) gaps.push('stock_price')
    if (predates1_0(shop.lastEdited)) gaps.push('predates_1_0')
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
      stock,
    }
  })
}
