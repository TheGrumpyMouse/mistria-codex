/**
 * Cosmetic prices, colour counts and sprites, from the three cosmetics pages.
 *
 * The game files name all 384 cosmetics and price almost none of them — 26
 * carry a `price_override` and the rest are priced by compiled code. The wiki
 * priced them by hand, one table per wardrobe category, and also records two
 * things the files do not surface: how many colour variants a garment has, and
 * a `File:` sprite for each. So the join is: game states what exists and where
 * it is sold, wiki states what it costs and what it looks like.
 *
 * **Only structured cells are read.** The name from the Item Name column, the
 * price from `{{Price|N}}`, the variant count from its own numeric column, the
 * sprite from the `[[File:…]]` in the image cell, and the vendor from
 * `{{SourceIcon|saturday market short|Vera}}`. No prose cell is touched — the
 * pages carry no description column today, and reading cells wholesale is how
 * that would stop being true without anyone noticing.
 *
 * **Cells are identified by what they contain, not by where they sit.** The
 * three pages do not agree on a column count — Clothes and Body are uniform at
 * six and four, but Accessories mixes both and drops the Set column on some
 * rows — so counting columns mis-read a price as a colour count and threw
 * away seventeen rows that were perfectly readable. A price is whatever holds
 * `{{Price|}}`, a colour count is whatever is a bare number, a vendor is
 * whatever holds a source icon. That survives a column being added, removed
 * or reordered, which on a hand-edited wiki table is a matter of time.
 */
import { join } from 'node:path'
import { argv } from 'node:process'
import { pathToFileURL } from 'node:url'
import { consola } from 'consola'
import { CURATED_DIR, SOURCES_DIR } from '../lib/paths.js'
import { readJsonFile } from '../lib/read-json.js'
import {
  expandVariables,
  fetchPage,
  lastEditedAt,
  type PageFetchOptions,
  rowCells,
  tablesByHeading,
  versionStamp,
} from '../lib/wiki.js'
import { writeJson } from '../lib/write-json.js'

interface CosmeticsVocab {
  pages: { page: string }[]
}

export interface ExtractedCosmetic {
  /** The display name, which is the join key back to the game's own name. */
  name: string
  /** Tesserae. Null where the table shows no price — character-creation items. */
  price: number | null
  /** How many colours it comes in. Null on the narrow pages, which omit it. */
  variants: number | null
  /** Who sells it, as the source icon names them: `Louis`, `Vera`, `Wheedle`. */
  source: string | null
  /** The wiki's sprite filename, for the asset fetch. */
  icon: string | null
  /** The wiki page it came from, so a reader can check. */
  page: string
}

export interface CosmeticsExtract {
  wikiVersionStamp: Record<string, string | null>
  lastEdited: Record<string, string | null>
  cosmetics: ExtractedCosmetic[]
}

/** `{{Price|500}}` — cosmetics are always tesserae, so the token is not read. */
const PRICE = /\{\{Price\|\s*(\d+)/i
/** `{{SourceIcon|saturday market short|Vera}}` — the last parameter names them. */
const SOURCE_ICON = /\{\{\s*sourceicon\s*\|([^}]*)\}\}/i
/** The image cell's file, without the `|80px` sizing. */
const FILE_REF = /\[\[File:\s*([^\]|]+)/i

/** A row's cells, or null when it is a header or a spacer rather than an entry. */
function entryCells(row: string): string[] | null {
  const cells = rowCells(row).map((c) => c.text)
  // Every entry row opens with the image; a row without one is a section
  // banner (`!colspan="6"| Sleeveless Tops`) or the header vardefine.
  if (cells.length < 3 || !FILE_REF.test(cells[0] ?? '')) return null
  return cells
}

export function parseCosmeticsPage(
  wikitext: string,
  page: string,
): { rows: ExtractedCosmetic[]; unnamed: number } {
  const expanded = expandVariables(wikitext)
  const rows: ExtractedCosmetic[] = []
  let unnamed = 0

  for (const { table } of tablesByHeading(expanded)) {
    for (const row of table.split(/^[ \t]*\|-.*$/m)) {
      const cells = entryCells(row)
      if (cells === null) continue

      // The name is the first cell that is plain words — after the image, and
      // before anything holding a template. On every one of these tables that
      // is the Item Name column, whatever position it happens to occupy.
      const rest = cells.slice(1)
      const nameCell = rest.find((c) => c !== '' && !c.includes('{{') && !c.includes('[[File:'))
      const name = (nameCell ?? '').replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, '$2').trim()
      if (name === '' || /^(yes|no)\b/i.test(name)) {
        unnamed += 1
        continue
      }

      const priceCell = rest.find((c) => PRICE.test(c))
      const sourceCell = rest.find((c) => SOURCE_ICON.test(c))
      // A bare number is the colour count; nothing else on these tables is one.
      const variantCell = rest.find((c) => /^\d+$/.test(c))
      const sourceParams = SOURCE_ICON.exec(sourceCell ?? '')?.[1]?.split('|') ?? []

      rows.push({
        name,
        price: Number(PRICE.exec(priceCell ?? '')?.[1] ?? Number.NaN) || null,
        variants: variantCell === undefined ? null : Number(variantCell),
        // The last parameter is the vendor on a two-parameter icon
        // (`saturday market short|Vera`) and the source itself on a one-
        // parameter one (`Character Creation`).
        source: sourceParams.at(-1)?.trim() ?? null,
        icon: FILE_REF.exec(cells[0] ?? '')?.[1]?.trim() ?? null,
        page,
      })
    }
  }

  return { rows, unnamed }
}

export async function enrichCosmetics(
  options: { useCache?: boolean } = {},
): Promise<CosmeticsExtract> {
  const wiki = await readJsonFile<{ endpoint: string; throttleMs: number }>(
    join(CURATED_DIR, 'vocab', 'wiki.json'),
  )
  const vocab = await readJsonFile<CosmeticsVocab>(join(CURATED_DIR, 'vocab', 'cosmetics.json'))
  const fetchOptions: PageFetchOptions = { ...wiki, ...options }

  const cosmetics: ExtractedCosmetic[] = []
  const wikiVersionStamp: Record<string, string | null> = {}
  const lastEdited: Record<string, string | null> = {}
  const seen = new Set<string>()

  for (const { page } of vocab.pages) {
    const wikitext = await fetchPage(page, fetchOptions)
    const { rows, unnamed } = parseCosmeticsPage(wikitext, page)

    // A page that suddenly parses to nothing has been restructured, and
    // writing the empty result would silently unprice every stall.
    if (rows.length === 0) {
      throw new Error(
        `"${page}" parsed to zero cosmetics. The table shape changed — fix the ` +
          'parser rather than shipping a page that prices nothing.',
      )
    }
    if (unnamed > 0) {
      consola.warn(`cosmetics: ${page} has ${unnamed} row(s) with no readable name`)
    }

    wikiVersionStamp[page] = versionStamp(wikitext)
    lastEdited[page] = await lastEditedAt(page, fetchOptions)

    // The same garment can be listed on two pages (a set piece under both its
    // slot and its set). First listing wins; the duplicate is not a conflict
    // worth resolving, since the price is the same fact either way.
    for (const row of rows) {
      if (seen.has(row.name)) continue
      seen.add(row.name)
      cosmetics.push(row)
    }
  }

  const extract: CosmeticsExtract = {
    wikiVersionStamp,
    lastEdited,
    cosmetics: cosmetics.sort((a, b) => a.name.localeCompare(b.name)),
  }
  await writeJson(join(SOURCES_DIR, 'wiki', 'pages', 'cosmetics.json'), extract)
  return extract
}

async function main(): Promise<void> {
  const extract = await enrichCosmetics({ useCache: !argv.includes('--no-cache') })
  const priced = extract.cosmetics.filter((c) => c.price !== null).length
  const sprites = extract.cosmetics.filter((c) => c.icon !== null).length
  consola.success(
    `cosmetics: ${extract.cosmetics.length} rows · ${priced} priced · ${sprites} with a sprite`,
  )
}

const entry = argv[1]
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  main().catch((err: unknown) => {
    consola.error(err instanceof Error ? err.message : err)
    process.exitCode = 1
  })
}
