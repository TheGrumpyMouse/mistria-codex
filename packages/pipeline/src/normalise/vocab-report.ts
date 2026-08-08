/**
 * Report the distinct values a source actually contains, per field.
 *
 * You cannot write an alias table by guessing what the wiki says. This prints
 * the real vocabulary with counts, so `curated/aliases/*` can be written against
 * the corpus rather than against an assumption.
 *
 * It also stays useful after ingestion: run it after the weekly wiki refresh and
 * anything new shows up as a token with a small count.
 *
 * Run with `pnpm --filter @mistria/pipeline run vocab:report`.
 */
import { join } from 'node:path'
import { argv } from 'node:process'
import { pathToFileURL } from 'node:url'
import { consola } from 'consola'
import { SOURCES_DIR } from '../lib/paths.js'
import { readJsonFile } from '../lib/read-json.js'
import { stripWikitext, toTokens } from './wikitext.js'

type Row = Record<string, unknown>

const cargo = (table: string): Promise<Row[]> =>
  readJsonFile<Row[]>(join(SOURCES_DIR, 'wiki', 'cargo', `${table}.json`))

function tally(values: string[]): [string, number][] {
  const counts = new Map<string, number>()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
}

function report(title: string, values: string[], limit = 60): void {
  const rows = tally(values)
  consola.log(`\n=== ${title} — ${rows.length} distinct ===`)
  for (const [value, count] of rows.slice(0, limit)) {
    consola.log(`${String(count).padStart(5)}  ${JSON.stringify(value)}`)
  }
  if (rows.length > limit) consola.log(`      ... ${rows.length - limit} more`)
}

async function main(): Promise<void> {
  const items = await cargo('Items')
  const fish = await cargo('Fish')
  const crops = await cargo('Crops')

  // The assertion the whole dataset rests on. `Fish` carries no season,
  // location or time, so those come from `Items` joined on **display name**.
  // A duplicate name makes that join silently wrong for both rows.
  const names = items.map((i) => String(i.itemName))
  const seen = new Set<string>()
  const duplicates: string[] = []
  for (const name of names) {
    if (seen.has(name)) duplicates.push(name)
    else seen.add(name)
  }

  consola.log(`Items: ${items.length} rows, ${seen.size} unique itemName`)
  if (duplicates.length > 0) {
    consola.error(`DUPLICATE itemName x${duplicates.length}: ${duplicates.join(', ')}`)
  } else {
    consola.success('itemName is unique — the Items<->Fish join is safe')
  }

  const nameSet = new Set(names)
  const fishMissing = fish.map((f) => String(f.fishName)).filter((n) => !nameSet.has(n))
  const cropMissing = crops.map((c) => String(c.name)).filter((n) => !nameSet.has(n))
  consola.log(`Fish rows with no Items match: ${fishMissing.length} ${JSON.stringify(fishMissing)}`)
  consola.log(`Crop rows with no Items match: ${cropMissing.length} ${JSON.stringify(cropMissing)}`)

  report(
    'Items.location',
    items.flatMap((i) => toTokens(i.location)),
  )
  report(
    'Items.season',
    items.map((i) => stripWikitext(String(i.season ?? ''))),
  )
  report(
    'Items.tags',
    items.flatMap((i) => toTokens(i.tags)),
  )
  report(
    'Fish.weather',
    fish.flatMap((f) => toTokens(f.weather)),
  )
  report(
    'Fish.rarity',
    fish.map((f) => stripWikitext(String(f.rarity ?? ''))),
  )
  report(
    'Fish.size',
    fish.map((f) => stripWikitext(String(f.size ?? ''))),
  )
}

const entry = argv[1]
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  main().catch((err: unknown) => {
    consola.error(err instanceof Error ? err.message : err)
    process.exitCode = 1
  })
}
