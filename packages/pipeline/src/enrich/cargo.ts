/**
 * Fetch wiki Cargo tables into `sources/wiki/cargo/`.
 *
 * Endpoint facts, confirmed live — do not re-derive:
 * - `Special:CargoExport` works. `api.php?action=cargoquery` returns MWException.
 * - Fields **must** be table-qualified (`Items.itemName`, not `itemName`), or the
 *   response is `No field named "x" found`.
 *
 * Three failure modes here corrupt data silently rather than throwing, so each
 * one is guarded explicitly:
 *
 * 1. **Truncated pagination.** The export caps rows per request. GiftPrefs alone
 *    is 5,328. Paging stops only on a short page, and the total is asserted
 *    against the expected count.
 * 2. **A zero-row response overwriting a good file.** This is the classic
 *    pipeline disaster — one bad request and the dataset is empty, with a green
 *    build. Nothing is written unless rows came back.
 * 3. **Prose.** `Items.description` is never in the requested field list.
 */
import { join } from 'node:path'
import { argv } from 'node:process'
import { pathToFileURL } from 'node:url'
import { consola } from 'consola'
import { fetchJson } from '../lib/http.js'
import { CURATED_DIR, SOURCES_DIR } from '../lib/paths.js'
import { readJsonFile } from '../lib/read-json.js'
import { writeJson } from '../lib/write-json.js'

export interface CargoTableConfig {
  name: string
  expectedRows: number
  fields: string[]
  listFields: string[]
  /**
   * Fields we deliberately do not request, and why.
   *
   * A list rather than a map keyed by field name, because a key literally called
   * `description` trips the prose denylist in `writeJson`/`validate` — correctly,
   * since that guard cannot tell a config key from a data key. Keeping the field
   * name in a value rather than a key means the guard stays strict.
   */
  excludedFields: { field: string; reason: string }[]
}

export interface CargoConfig {
  endpoint: string
  pageSize: number
  throttleMs: number
  tables: CargoTableConfig[]
}

export type CargoRow = Record<string, string | number | null>

function buildUrl(
  config: CargoConfig,
  table: CargoTableConfig,
  offset: number,
  limit: number,
): string {
  const params = new URLSearchParams({
    title: 'Special:CargoExport',
    tables: table.name,
    // Table-qualified, or the request is rejected outright.
    fields: table.fields.map((f) => `${table.name}.${f}`).join(','),
    format: 'json',
    limit: String(limit),
    offset: String(offset),
  })
  return `${config.endpoint}?${params.toString()}`
}

export async function fetchTable(
  config: CargoConfig,
  table: CargoTableConfig,
  { useCache = true }: { useCache?: boolean } = {},
): Promise<CargoRow[]> {
  const rows: CargoRow[] = []
  let offset = 0

  for (;;) {
    const url = buildUrl(config, table, offset, config.pageSize)
    const page = await fetchJson<CargoRow[]>(url, {
      throttleMs: config.throttleMs,
      useCache,
    })

    if (!Array.isArray(page)) {
      throw new Error(`${table.name}: expected an array, got ${typeof page}`)
    }

    rows.push(...page)
    consola.log(`  ${table.name}: ${rows.length} rows`)

    // A full page might be the last page, so keep going until one comes back
    // short. Stopping early here is how tables silently lose their tail.
    if (page.length < config.pageSize) break
    offset += config.pageSize

    if (offset > 50_000) throw new Error(`${table.name}: runaway pagination past ${offset}`)
  }

  if (rows.length === 0) {
    throw new Error(
      `${table.name}: zero rows returned. Refusing to write — an empty file here would ` +
        'overwrite good data and pass validation. Check the table still exists at ' +
        'Special:CargoTables (FurnitureTEMP in particular is expected to be renamed).',
    )
  }

  if (rows.length !== table.expectedRows) {
    throw new Error(
      `${table.name}: got ${rows.length} rows, expected ${table.expectedRows}. ` +
        'Either pagination truncated, or the wiki genuinely changed — verify at ' +
        'Special:CargoTables and update curated/vocab/cargo_tables.json if it is real.',
    )
  }

  return rows
}

export async function enrichCargo(options: { useCache?: boolean } = {}): Promise<void> {
  const config = await readJsonFile<CargoConfig>(join(CURATED_DIR, 'vocab', 'cargo_tables.json'))

  for (const table of config.tables) {
    if (table.excludedFields.length > 0) {
      const names = table.excludedFields.map((e) => e.field).join(', ')
      consola.info(`${table.name}: not requesting ${names} (licensing)`)
    }

    const rows = await fetchTable(config, table, options)
    await writeJson(join(SOURCES_DIR, 'wiki', 'cargo', `${table.name}.json`), rows)
    consola.success(`${table.name}: ${rows.length} rows -> sources/wiki/cargo/${table.name}.json`)
  }
}

async function main(): Promise<void> {
  const useCache = !argv.includes('--no-cache')
  if (!useCache) consola.info('Bypassing the HTTP cache')
  await enrichCargo({ useCache })
}

const entry = argv[1]
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  main().catch((err: unknown) => {
    consola.error(err instanceof Error ? err.message : err)
    process.exitCode = 1
  })
}
