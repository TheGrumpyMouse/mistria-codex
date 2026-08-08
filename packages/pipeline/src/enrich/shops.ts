/**
 * Extract shop stock from the eight store pages.
 *
 * This is what makes "where do I buy this, and for how much" answerable. The
 * Items table has an `isBuyable` flag and nothing else — not the shop, not the
 * price, not the gate — so every one of those facts is on a store page.
 *
 * **No cell text is ever read.** Item names come from the row's links, prices
 * from `{{Price|N}}`, and requirements from `{{Skill|X}} Level N` and
 * `{{SourceIcon|Story Quest…|Name}}`. That is not just tidiness: most of these
 * tables have a Description column filled by `{{Description|item}}`, which
 * renders the item's in-game description. Reading cells wholesale would pull
 * verbatim game text into `sources/`.
 *
 * Two structural details the wiki forces on us:
 *
 * - **Stock sections are declared, not guessed.** Every page arranges its
 *   headings differently ("Stock", "Year-Round Stock", "Farm Supplies"), and
 *   Hayden's page has tables for selling animals and adopting them that are not
 *   stock at all. `curated/vocab/shops.json` says which sections are stock and
 *   which are deliberately ignored; anything else warns rather than vanishing.
 * - **`rowspan` is real and load-bearing.** Thirteen Inn recipes share one
 *   "Upgrade The Inn" requirement cell. Dropping that would tell a player they
 *   can buy things they cannot.
 */
import { join } from 'node:path'
import { argv } from 'node:process'
import { pathToFileURL } from 'node:url'
import { consola } from 'consola'
import { CURATED_DIR, SOURCES_DIR } from '../lib/paths.js'
import { readJsonFile } from '../lib/read-json.js'
import {
  type Cell,
  expandVariables,
  fetchPage,
  lastEditedAt,
  type PageFetchOptions,
  rowCells,
  tablesByHeading,
  versionStamp,
} from '../lib/wiki.js'
import { writeJson } from '../lib/write-json.js'

interface SectionRule {
  /** Case-insensitive substring of the heading path. */
  match: string
  /** Seasons this section's stock is restricted to, or null for year-round. */
  seasons: string[] | null
}

interface ShopConfig {
  id: string
  name: string
  page: string
  /** Curated: the infobox lists everyone who lives there, not who serves you. */
  owner: string | null
  /** Stock rotates rather than being permanently available (Balor's Wagon). */
  rotates: boolean
  stockSections: SectionRule[]
  ignoreSections: { match: string; reason: string }[]
}

/**
 * A wiki link, kept whole.
 *
 * Which half names the item depends on the row: `[[Cosmetics_(Clothes)#Skirts|
 * Maid Skirt]]` hides the item in the display text, while `[[Copper Axe|Axe]]`
 * hides it in the target. There is no rule that gets both right without knowing
 * the item list, so the source keeps both and the build — which has the item
 * list — decides.
 */
export interface LinkedName {
  target: string
  display: string
}

export interface ExtractedStock {
  section: string
  item: LinkedName
  /**
   * Every `{{Price|…}}` in the row, in order, with its raw token.
   *
   * More than one is normal: an armour row prices its defence stat with the
   * same template as its cost. Picking "the first one" put `{{Price|2|defense}}`
   * in the price column of five armour sets. The build knows which tokens are
   * currencies and chooses; anything unrecognised is reported, not defaulted.
   */
  prices: { amount: number | null; token: string }[]
  /** Unparsed requirement text, resolved into Requirements by the build. */
  requires: string[]
  seasons: string[] | null
}

export interface ExtractedShop {
  id: string
  name: string
  page: string
  owner: string | null
  rotates: boolean
  /** From the page's infobox. */
  location: string | null
  wikiVersionStamp: string | null
  lastEdited: string | null
  stock: ExtractedStock[]
  /** Sections holding tables that no rule classified. A curation to-do. */
  unclassifiedSections: string[]
}

const INFOBOX_LOCATION = /^\|\s*location\s*=\s*(.+)$/m
/** `{{Price|500}}`, `{{Price|10|ess}}`, `{{Price|}}` when the wiki doesn't know. */
const PRICE = /\{\{Price\|\s*(\d*)\s*(?:\|\s*([^}|]*))?\}\}/gi
/** A wiki link: `[[Target]]` or `[[Target|Display]]`. */
const LINK = /\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g
/** `{{ItemIcon|Coffee}}`, `{{ItemIconAuto|…}}`, `{{FurnitureIcon|…}}`. */
const ICON_TEMPLATE = /\{\{(?:Item|Furniture|Cosmetic)Icon(?:Auto)?\|([^}|]+)/i
/** Requirement cells: a skill level, a perk, or a story quest. */
const REQUIREMENT = /\{\{(?:Skill|SkillPerk|SourceIcon)\|[^}]*\}\}(?:\s*Level\s*\d+)?/gi

/**
 * The items a row is about: every non-image link in its first linking cell.
 *
 * Usually one, but the Blacksmith sells a whole tier at once —
 * `[[Copper Pickaxe]] / [[Copper Axe|Axe]] / [[Copper Hoe|Hoe]] / …` is six
 * items on one line at one price. Taking only the first would quietly drop
 * thirty tools from the shop.
 */
function itemsFromCells(cells: Cell[]): LinkedName[] {
  for (const cell of cells) {
    const found: LinkedName[] = []
    for (const match of cell.text.matchAll(LINK)) {
      const target = (match[1] ?? '').trim()
      if (target === '' || /^(File|Image|Category):/i.test(target)) continue
      found.push({
        target: target.split('#')[0]?.replace(/_/g, ' ').trim() ?? target,
        display: (match[2] ?? '').trim(),
      })
    }
    if (found.length > 0) return found

    const icon = ICON_TEMPLATE.exec(cell.text)?.[1]?.trim()
    if (icon !== undefined && icon !== '') return [{ target: icon, display: '' }]
  }
  return []
}

/**
 * A value inherited from an earlier row's `rowspan`ed cell.
 *
 * Kept per table: thirteen Inn recipe rows share one requirement cell, and the
 * twelve that follow it have no cell of their own to read.
 */
interface Carried<T> {
  value: T
  remaining: number
}

type Price = { amount: number | null; token: string }
/** What `take` returns: this row's value, and whatever a `rowspan` still holds. */
interface Taken<T> {
  value: T
  carried: Carried<T> | null
}

/** Parse one stock table into rows, honouring `rowspan` on price and requirements. */
export function parseStockTable(
  table: string,
  section: string,
  seasons: string[] | null,
): ExtractedStock[] {
  const stock: ExtractedStock[] = []
  let carriedPrices: Carried<Price[]> | null = null
  let carriedRequires: Carried<string[]> | null = null

  /** Take this row's own value, or inherit the one a `rowspan` is holding open. */
  const take = <T>(
    own: { value: T; rowspan: number } | null,
    carried: Carried<T> | null,
    fallback: T,
  ): Taken<T> => {
    if (own !== null) {
      return {
        value: own.value,
        carried: own.rowspan > 1 ? { value: own.value, remaining: own.rowspan - 1 } : carried,
      }
    }
    if (carried === null) return { value: fallback, carried: null }
    return {
      value: carried.value,
      carried: carried.remaining > 1 ? { ...carried, remaining: carried.remaining - 1 } : null,
    }
  }

  for (const chunk of table.split(/^\|-.*$/m)) {
    const cells = rowCells(chunk)
    if (cells.length === 0) continue

    const items = itemsFromCells(cells)
    if (items.length === 0) continue

    // Every cell, not the first one that matches: an armour row prices its
    // defence stat and its cost with the same template, and the stat comes
    // first. Reading only the first cell put "2 defense" in the price column.
    const priceCells = cells.filter((c) => new RegExp(PRICE.source, 'i').test(c.text))
    const requireCell = cells.find((c) => new RegExp(REQUIREMENT.source, 'i').test(c.text))

    const prices: Taken<Price[]> = take(
      priceCells.length === 0
        ? null
        : {
            value: priceCells.flatMap((cell) =>
              [...cell.text.matchAll(PRICE)].map((m) => ({
                amount: m[1] === undefined || m[1] === '' ? null : Number(m[1]),
                token: (m[2] ?? '').trim(),
              })),
            ),
            rowspan: Math.max(...priceCells.map((c) => c.rowspan)),
          },
      carriedPrices,
      [],
    )
    carriedPrices = prices.carried

    const requires: Taken<string[]> = take(
      requireCell === undefined
        ? null
        : {
            value: [...requireCell.text.matchAll(new RegExp(REQUIREMENT.source, 'gi'))].map((m) =>
              m[0].trim(),
            ),
            rowspan: requireCell.rowspan,
          },
      carriedRequires,
      [],
    )
    carriedRequires = requires.carried

    for (const item of items) {
      stock.push({
        section,
        item,
        prices: prices.value,
        requires: requires.value,
        seasons,
      })
    }
  }

  return stock
}

export async function enrichShops(options: { useCache?: boolean } = {}): Promise<ExtractedShop[]> {
  const wiki = await readJsonFile<{ endpoint: string; throttleMs: number }>(
    join(CURATED_DIR, 'vocab', 'wiki.json'),
  )
  const { shops: configs } = await readJsonFile<{ shops: ShopConfig[] }>(
    join(CURATED_DIR, 'vocab', 'shops.json'),
  )
  const fetchOptions: PageFetchOptions = { ...wiki, useCache: options.useCache }

  const shops: ExtractedShop[] = []

  for (const config of configs) {
    const raw = await fetchPage(config.page, fetchOptions)
    // The Blacksmith keeps every tool price in a page variable and refers to it
    // from each row. Without this, forty-four items come out unpriced.
    const wikitext = expandVariables(raw)
    const tables = tablesByHeading(wikitext)

    const stock: ExtractedStock[] = []
    const unclassified = new Set<string>()

    for (const { heading, table } of tables) {
      const folded = heading.toLowerCase()
      const rule = config.stockSections.find((s) => folded.includes(s.match.toLowerCase()))
      if (rule === undefined) {
        const ignored = config.ignoreSections.some((s) => folded.includes(s.match.toLowerCase()))
        if (!ignored && heading !== '') unclassified.add(heading)
        continue
      }
      stock.push(...parseStockTable(table, heading, rule.seasons))
    }

    if (stock.length === 0) {
      throw new Error(
        `${config.page}: parsed zero stock rows. Refusing to write an empty shop — ` +
          'the page layout has changed, or a stock section was renamed.',
      )
    }
    for (const heading of unclassified) {
      consola.warn(`${config.page}: table under "${heading}" is neither stock nor ignored`)
    }

    shops.push({
      id: config.id,
      name: config.name,
      page: config.page,
      owner: config.owner,
      rotates: config.rotates,
      location: INFOBOX_LOCATION.exec(wikitext)?.[1]?.trim() ?? null,
      wikiVersionStamp: versionStamp(wikitext),
      lastEdited: await lastEditedAt(config.page, fetchOptions),
      stock,
      unclassifiedSections: [...unclassified].sort(),
    })

    consola.success(
      `${config.name}: ${stock.length} stock rows` +
        (unclassified.size > 0 ? ` (${unclassified.size} unclassified sections)` : ''),
    )
  }

  await writeJson(join(SOURCES_DIR, 'wiki', 'pages', 'shops.json'), shops)
  return shops
}

async function main(): Promise<void> {
  const shops = await enrichShops({ useCache: !argv.includes('--no-cache') })
  const rows = shops.reduce((n, s) => n + s.stock.length, 0)
  const priced = shops.reduce((n, s) => n + s.stock.filter((i) => i.prices.length > 0).length, 0)
  consola.info(`${shops.length} shops, ${rows} stock rows, ${priced} with a price`)
}

const entry = argv[1]
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  main().catch((err: unknown) => {
    consola.error(err instanceof Error ? err.message : err)
    process.exitCode = 1
  })
}
