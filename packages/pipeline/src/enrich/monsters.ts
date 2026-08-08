/**
 * Read the mines' monsters and what they drop.
 *
 * Two pages, and they carry different halves of the answer. The Monsters page
 * is a table per family — which variants exist and which biome each lives in.
 * `Template:MonsterDrops` is the drop table itself: one big `#switch` on the
 * monster's name, with **drop rates**, which is exactly the kind of factual
 * number this project exists to hold.
 *
 * Two things the page does not make easy:
 *
 * **The Name column is a variant label, not a name.** Under "Rock Clods" it
 * reads `Rock`, `Blue`, `Green`. The family lives in the section heading, so a
 * name is built from both — and the drops are keyed by the `{{MonsterDrops|…}}`
 * argument instead, because that is the one value on the row that is complete
 * and unique on its own.
 *
 * **Perk-gated drops are excluded.** Every family drops a pet skin at 5%, but
 * only once the Friend-Shaped perk is unlocked. Listing that as an unconditional
 * 5% is a wrong number, and the drop shape has nowhere to put the condition, so
 * those become a `perk_gated_drops` gap rather than a claim.
 */
import { join } from 'node:path'
import { argv } from 'node:process'
import { pathToFileURL } from 'node:url'
import { consola } from 'consola'
import { fileRef } from '../assets/names.js'
import { CURATED_DIR, SOURCES_DIR } from '../lib/paths.js'
import { readJsonFile } from '../lib/read-json.js'
import {
  expandSwitch,
  fetchPage,
  lastEditedAt,
  type PageFetchOptions,
  rowCells,
  sections,
  tableRows,
  versionStamp,
} from '../lib/wiki.js'
import { writeJson } from '../lib/write-json.js'

interface MonsterVocab {
  page: string
  dropsTemplate: string
  section: string
  /** The perk that gates cosmetic drops, so they can be told apart from real ones. */
  cosmeticPerk: string
  /** Marks a drop table that points elsewhere instead of listing anything. */
  incompletePattern: string
}

export interface ExtractedMonster {
  /** The page the section heading links to — `Clod`, `Sapling`. */
  family: string
  /** The Name cell, which is often only the variant: `Blue`. */
  variant: string
  /** Family and variant put back together. */
  name: string
  /** The `{{MonsterDrops|…}}` argument, which is what the drop table is keyed by. */
  dropsKey: string
  /** `{{BiomesQuick|3 Monster}}` — biome orders. Empty means every biome. */
  biomeOrders: number[]
  /**
   * The sprite file named in the row's first cell.
   *
   * A filename, not an image and not prose — the art itself lives in
   * `assets/game/` under attribution, and this is the only thing that says which
   * file belongs to which monster. Null when the row has no icon.
   */
  icon: string | null
}

export interface ExtractedDrop {
  item: string
  /** `(70%)` as 0.7. Null when the wiki states a drop without a rate. */
  chance: number | null
  /** Set when the drop only happens once a perk is unlocked. */
  requiresPerk: string | null
  /**
   * `accessory` when the template links the drop into the Accessories page
   * rather than naming an Items row. Hats and sunglasses are real drops but
   * live in a category this project has not ingested, and calling that a
   * missing drop table would misread a known absence as a broken parse.
   */
  kind: 'item' | 'accessory'
}

export interface MonstersExtract {
  wikiVersionStamp: string | null
  lastEdited: string | null
  monsters: ExtractedMonster[]
  /** Drops keyed by the `{{MonsterDrops|…}}` argument. */
  dropsByKey: Record<string, ExtractedDrop[]>
  /**
   * Keys whose drop table says "see the page for loot tables" instead of
   * listing anything. The Mimic is one: its loot depends on which biome it was
   * fed in, and lives on its own page. A short list is not the same as a
   * complete one, and this is what tells them apart.
   */
  incompleteKeys: string[]
}

/** `=== [[Clod|Rock Clods]] ===` — the target names the family. */
const SECTION_LINK = /^\[\[([^\]|]+)/
/** `{{BiomesQuick|3 Monster|<br>}}`, `{{BiomesQuick|All Monster}}`. */
const BIOME = /\{\{BiomesQuick\|\s*(\d+|All)\s+Monster/gi
/** `{{MonsterDrops|Blue Clod}}`. */
const DROPS_KEY = /\{\{MonsterDrops\|([^|}]+)/i
/** `{{ItemIconAuto|Sap}}` — the item is the first argument. */
const ITEM_AUTO = /\{\{ItemIconAuto\|([^|}]+)/i
/** `{{ItemIcon|Accessories#Hats|Sapling Hat|file.png}}` — the item is the second. */
const ITEM_LINKED = /\{\{ItemIcon\|[^|}]*\|([^|}]+)/i
/** `(70%)`, `(5%)`. */
const CHANCE = /\((\d+(?:\.\d+)?)%\)/

/** A family's singular name, with any disambiguator dropped. */
export const familySingular = (target: string): string =>
  target.replace(/\s*\([^)]*\)\s*$/, '').trim()

/**
 * Put a family and a variant back into a name.
 *
 * `Blue` under Rock Clods is a Blue Clod; `Cool Sapling` under Saplings is
 * already a name and is left alone. Both spellings occur on the same page.
 */
export function monsterName(variant: string, family: string): string {
  const singular = familySingular(family)
  if (singular === '') return variant
  return variant.toLowerCase().endsWith(singular.toLowerCase()) ? variant : `${variant} ${singular}`
}

/** The monsters listed in one family's table. */
export function parseFamilyTable(table: string, family: string): ExtractedMonster[] {
  const monsters: ExtractedMonster[] = []

  for (const row of tableRows(table)) {
    const dropsKey = DROPS_KEY.exec(row)?.[1]?.trim()
    if (dropsKey === undefined || dropsKey === '') continue

    const cells = rowCells(row)
    // The first cell is the sprite. Only its *filename* is read; the image is
    // fetched separately into assets/game/. See docs/DATA-POLICY.md.
    const icon = fileRef(cells[0]?.text ?? '')
    const variant = (cells[1]?.text ?? '').replace(/'''/g, '').trim()
    if (variant === '') continue

    const orders: number[] = []
    for (const match of row.matchAll(BIOME)) {
      const value = match[1] ?? ''
      // "All" means every biome, which is expressed as no constraint at all
      // rather than as a list that would go stale when a biome is added.
      if (/^\d+$/.test(value)) orders.push(Number(value))
    }

    monsters.push({
      family,
      variant,
      name: monsterName(variant, family),
      dropsKey,
      biomeOrders: [...new Set(orders)].sort((a, b) => a - b),
      icon,
    })
  }

  return monsters
}

/** Read one resolved drop list out of the template's HTML. */
export function parseDrops(html: string, cosmeticPerk: string): ExtractedDrop[] {
  const drops: ExtractedDrop[] = []
  const seen = new Set<string>()

  for (const entry of html.split('<li>').slice(1)) {
    const line = entry.split('</li>')[0] ?? entry
    const auto = ITEM_AUTO.exec(line)?.[1]
    const item = (auto ?? ITEM_LINKED.exec(line)?.[1] ?? '').trim()
    if (item === '' || seen.has(item)) continue
    seen.add(item)

    const percent = CHANCE.exec(line)?.[1]
    drops.push({
      item,
      chance: percent === undefined ? null : Number(percent) / 100,
      requiresPerk: line.includes(cosmeticPerk) ? cosmeticPerk : null,
      kind: auto === undefined ? 'accessory' : 'item',
    })
  }

  return drops
}

export async function enrichMonsters(
  options: { useCache?: boolean } = {},
): Promise<MonstersExtract> {
  const wiki = await readJsonFile<{ endpoint: string; throttleMs: number }>(
    join(CURATED_DIR, 'vocab', 'wiki.json'),
  )
  const vocab = await readJsonFile<MonsterVocab>(join(CURATED_DIR, 'vocab', 'monsters.json'))
  const fetchOptions: PageFetchOptions = { ...wiki, useCache: options.useCache }

  const wikitext = await fetchPage(vocab.page, fetchOptions)
  const dropsTemplate = await fetchPage(vocab.dropsTemplate, fetchOptions)

  const listing = sections(wikitext, 2).find((s) => s.heading === vocab.section)
  if (listing === undefined) {
    throw new Error(`${vocab.page} has no "== ${vocab.section} ==" section.`)
  }

  const monsters: ExtractedMonster[] = []
  for (const family of sections(listing.body, 3)) {
    const target = SECTION_LINK.exec(family.heading.trim())?.[1]?.trim() ?? family.heading.trim()
    monsters.push(...parseFamilyTable(family.body, target))
  }

  if (monsters.length === 0) {
    throw new Error(`${vocab.page}: parsed zero monsters. Refusing to write an empty dataset.`)
  }

  const dropsByKey: Record<string, ExtractedDrop[]> = {}
  const incompleteKeys: string[] = []
  for (const monster of monsters) {
    const resolved = expandSwitch(dropsTemplate, monster.dropsKey)
    dropsByKey[monster.dropsKey] = parseDrops(resolved, vocab.cosmeticPerk)
    if (new RegExp(vocab.incompletePattern, 'i').test(resolved)) {
      incompleteKeys.push(monster.dropsKey)
    }
  }

  const extract: MonstersExtract = {
    wikiVersionStamp: versionStamp(wikitext),
    lastEdited: await lastEditedAt(vocab.page, fetchOptions),
    monsters,
    dropsByKey,
    incompleteKeys,
  }

  await writeJson(join(SOURCES_DIR, 'wiki', 'pages', 'monsters.json'), extract)
  return extract
}

async function main(): Promise<void> {
  const extract = await enrichMonsters({ useCache: !argv.includes('--no-cache') })
  for (const monster of extract.monsters) {
    const drops = extract.dropsByKey[monster.dropsKey] ?? []
    consola.log(
      `${monster.name.padEnd(26)} biome ${(monster.biomeOrders.join(',') || 'all').padEnd(5)} ` +
        drops
          .filter((d) => d.requiresPerk === null)
          .map((d) => `${d.item}${d.chance === null ? '' : ` ${Math.round(d.chance * 100)}%`}`)
          .join(', '),
    )
  }
  const rated = Object.values(extract.dropsByKey)
    .flat()
    .filter((d) => d.chance !== null).length
  consola.info(`${extract.monsters.length} monsters, ${rated} drops with a stated rate`)
}

const entry = argv[1]
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  main().catch((err: unknown) => {
    consola.error(err instanceof Error ? err.message : err)
    process.exitCode = 1
  })
}
