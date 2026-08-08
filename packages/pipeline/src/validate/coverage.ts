import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DATASETS, type DatasetName } from '@mistria/schema'
import { REPORTS_DIR } from '../lib/paths.js'
import type { Loaded } from './load.js'
import { type Finding, warn } from './report.js'

/**
 * Expected record counts, from docs/research/01-game-data.md and confirmed
 * against the wiki's live Cargo row counts where a table exists.
 *
 * `null` means we don't have a number to hold ourselves to yet — which is
 * itself worth seeing in the report.
 */
export const EXPECTED_COUNTS: Readonly<Record<DatasetName, number | null>> = {
  items: 1154, // Cargo: Items
  fish: 143, // Cargo: Fish
  bugs: 103, // Cargo: Bugs
  // 61, not 58. Cargo's Crops table has 58 rows and omits three of the seven
  // plantable fruit trees — the wiki files Apple and Cherry under Crops and
  // Lemon, Peach and Pear only under their own pages. The three come from
  // `tree.toml`; see `fruitTreeCrops` in build/builders/fish-crops.ts.
  crops: 61,
  // NOT 56. The Characters Cargo table has 56 rows, but 22 are wiki editors'
  // user pages using the same infobox template. 34 is the real villager roster:
  // 12 romanceable + 14 townfolk + 8 vendors, per docs/research/01-game-data.md.
  characters: 34,
  recipes: 282, // Cargo: Recipes
  artifacts: 110, // Cargo: Artifacts
  forageables: 86, // research doc, EA-era count — verify against 1.0
  museum_sets: 82, // counted from the four wing pages; the research doc said ~80
  gift_prefs: 34, // one record per villager
  schedules: 34,
  // Ten, not four. The wiki lists ten festivals and marks six unimplemented;
  // all ten are kept and flagged, because "the files have a Halloween Festival,
  // the game does not run it" is a fact worth carrying.
  festivals: 10,
  skills: 9,
  mines: 5,
  // Eight stores in Category:Store. The Saturday Market's eight vendors are a
  // separate, differently-structured page and are not counted here yet.
  shops: 8,
  animals: 8, // four coop, four barn
  // seals.toml declares exactly seven: water, earth, fire, ruins, void,
  // priestess and final. A patch adding an eighth shows up here.
  seals: 7,
  locations: null,
  maps: null,
  spots: null,
  // No source states a total, and the page's sections keep growing.
  quests: null,
  // Coops, barns, greenhouses, the farmhouse and four whose cost tables are
  // still unread. Not a fixed number until those land.
  buildings: null,
  monsters: null,
}

export interface CoverageRow {
  name: DatasetName
  expected: number | null
  have: number
  /** Fill rate for fields that the flagship query depends on. */
  fields: Record<string, number>
}

/** Fields whose absence degrades the "what can I find right now" screen. */
const TRACKED_FIELDS: Partial<Record<DatasetName, string[]>> = {
  items: ['availability', 'sell_value', 'museum'],
  characters: ['birthday'],
  gift_prefs: ['prefs'],
  schedules: ['entries'],
  locations: ['anchor'],
}

/**
 * Tracked fields that every record of that dataset ought to have.
 *
 * Without this, a dataset can reach its record count and report 100% while
 * being almost entirely empty — which is exactly what schedules did the moment
 * they were built: thirty-four records, three of them with anything in them,
 * and a clean validate. A count of records is not a count of answers.
 *
 * Tracked-but-not-listed is a real distinction: most items correctly have no
 * `museum` value, so its fill rate is information rather than a shortfall.
 */
const REQUIRED_FIELDS: Partial<Record<DatasetName, string[]>> = {
  characters: ['birthday'],
  gift_prefs: ['prefs'],
  schedules: ['entries'],
  locations: ['anchor'],
}

/**
 * How many records answer for a field — counting *not applicable* as answered.
 *
 * A record states its own unknowns in `data_gaps`. A mine biome has no anchor
 * and never will, because a range of floors has no position on an overworld
 * map, so it does not list one — and counting it as a shortfall would leave a
 * warning that can never be cleared. A permanent warning is worse than none: it
 * teaches everyone to skim past the ones that matter.
 *
 * So the rule is: filled, **or** not claiming the gap. Only a record that says
 * "I should have this and don't" counts against the total.
 */
/**
 * The `data_gaps` entry that stands for a field, where the two are not spelled
 * the same.
 *
 * Listed explicitly rather than matched loosely. A schedule with nothing in it
 * records the gap as `schedule`, not `entries`, and treating a near-miss as a
 * match would have silently cleared the warning that says three villagers of
 * thirty-four have a schedule — which is the single largest hole in this
 * dataset and the last thing that should quietly stop being reported.
 */
const GAP_NAMES: Record<string, string> = { entries: 'schedule' }

/**
 * How many records answer for a field — counting *not applicable* as answered.
 *
 * A record states its own unknowns in `data_gaps`. A mine biome has no anchor
 * and never will, because a range of floors has no position on an overworld
 * map, so it does not claim one — and counting it as a shortfall would leave a
 * warning nobody can ever clear. A permanent warning is worse than none: it
 * teaches everyone to skim past the ones that matter.
 *
 * So: filled, **or** silent about the gap. Only a record that says "I should
 * have this and don't" counts against the total.
 */
function fillRate(records: unknown[], field: string): number {
  const gapName = GAP_NAMES[field] ?? field
  let filled = 0

  for (const record of records) {
    const row = record as Record<string, unknown>
    const value = row[field]

    const empty =
      value === null ||
      value === undefined ||
      (Array.isArray(value) && value.length === 0) ||
      (typeof value === 'object' && Object.keys(value as object).length === 0)

    if (!empty) {
      filled += 1
      continue
    }

    const gaps = row.data_gaps
    if (Array.isArray(gaps) && !gaps.includes(field) && !gaps.includes(gapName)) filled += 1
  }
  return filled
}

export function computeCoverage(loaded: Loaded): CoverageRow[] {
  return (Object.keys(DATASETS) as DatasetName[]).map((name) => {
    const records = loaded[name].records
    const fields: Record<string, number> = {}
    for (const field of TRACKED_FIELDS[name] ?? []) fields[field] = fillRate(records, field)
    return { name, expected: EXPECTED_COUNTS[name], have: records.length, fields }
  })
}

/**
 * Coverage gaps are warnings, never errors — a category that hasn't been
 * ingested yet is the normal state for most of this project's life, and failing
 * the build on it would just train everyone to ignore the build.
 *
 * The report is written to `build/reports/coverage.md` and printed into the CI
 * job summary, so a regression is visible on the pull request that caused it.
 * It is not diffed against a committed copy: `docs/` stopped being committed,
 * and a checked-in coverage table would need regenerating on every data change
 * for no gain over reading it in the summary.
 */
export function coverageFindings(rows: CoverageRow[]): Finding[] {
  const findings: Finding[] = []
  for (const row of rows) {
    for (const field of REQUIRED_FIELDS[row.name] ?? []) {
      const filled = row.fields[field] ?? 0
      if (filled >= row.have) continue
      findings.push(warn('coverage', `${row.name}.${field}: ${filled}/${row.have} records`))
    }

    if (row.expected === null) continue
    if (row.have >= row.expected) continue
    findings.push(warn('coverage', `${row.name}: ${row.have}/${row.expected} records`))
  }
  return findings
}

/**
 * What the availability windows actually answer, and who told us.
 *
 * The per-dataset table above counts records; this counts *answers*. It is the
 * number the game-file milestone is measured by — before G1 the wiki left 116
 * of 487 windows with no time at all and 117 with nowhere to put a pin, and
 * neither shortfall was visible in a row that said `items 1154/1154`.
 */
export interface AvailabilityCoverage {
  windows: number
  timeKnown: number
  timeNotApplicable: number
  timeUnknown: number
  located: number
  fromGame: number
  idStatus: Record<string, number>
}

interface WindowRecord {
  time_precision: string
  locations: string[]
  prov: string
}

export function availabilityCoverage(loaded: Loaded): AvailabilityCoverage {
  const items = loaded.items.records as unknown as {
    id_status: string
    availability: WindowRecord[]
  }[]
  const windows = items.flatMap((i) => i.availability ?? [])

  const idStatus: Record<string, number> = {}
  for (const item of items) idStatus[item.id_status] = (idStatus[item.id_status] ?? 0) + 1

  return {
    windows: windows.length,
    timeKnown: windows.filter((w) => w.time_precision === 'exact' || w.time_precision === 'block')
      .length,
    timeNotApplicable: windows.filter((w) => w.time_precision === 'not_applicable').length,
    timeUnknown: windows.filter((w) => w.time_precision === 'unknown').length,
    located: windows.filter((w) => w.locations.length > 0).length,
    fromGame: windows.filter((w) => w.prov === 'game_files').length,
    idStatus,
  }
}

export async function writeCoverageReport(
  rows: CoverageRow[],
  availability?: AvailabilityCoverage,
): Promise<void> {
  const lines: string[] = [
    '# Coverage',
    '',
    'Generated by `pnpm validate` — do not edit.',
    '',
    'Expected counts come from `docs/research/01-game-data.md` and the wiki’s live Cargo row',
    'counts. A gap here is a curation to-do, not a failure.',
    '',
    '| Dataset | Have | Expected | % | Field fill |',
    '| --- | ---: | ---: | ---: | --- |',
  ]

  for (const row of rows) {
    const pct =
      row.expected === null || row.expected === 0
        ? '—'
        : `${Math.round((row.have / row.expected) * 100)}%`
    const fields =
      Object.keys(row.fields).length === 0
        ? '—'
        : Object.entries(row.fields)
            .map(([f, n]) => `${f} ${n}/${row.have}`)
            .join(', ')
    lines.push(`| ${row.name} | ${row.have} | ${row.expected ?? '—'} | ${pct} | ${fields} |`)
  }

  if (availability !== undefined) {
    const { windows, idStatus } = availability
    const pct = (n: number): string => (windows === 0 ? '—' : `${Math.round((n / windows) * 100)}%`)

    lines.push(
      '',
      '## Availability windows',
      '',
      'What the flagship query can actually answer. `not applicable` is an answer — time',
      'of day does not affect fishing — and only `unknown` is a hole.',
      '',
      '| | count | % |',
      '| --- | ---: | ---: |',
      `| windows | ${windows} | |`,
      `| time stated | ${availability.timeKnown} | ${pct(availability.timeKnown)} |`,
      `| time not applicable | ${availability.timeNotApplicable} | ${pct(availability.timeNotApplicable)} |`,
      `| **time unknown** | **${availability.timeUnknown}** | ${pct(availability.timeUnknown)} |`,
      `| has at least one location | ${availability.located} | ${pct(availability.located)} |`,
      `| sourced from the game files | ${availability.fromGame} | ${pct(availability.fromGame)} |`,
      '',
      '## Item id confidence',
      '',
      'See `build/reports/id-divergence.md` for which ids and why.',
      '',
      '| status | items |',
      '| --- | ---: |',
      ...Object.entries(idStatus)
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([status, n]) => `| \`${status}\` | ${n} |`),
    )
  }

  lines.push('')
  await mkdir(REPORTS_DIR, { recursive: true })
  await writeFile(join(REPORTS_DIR, 'coverage.md'), `${lines.join('\n')}\n`, 'utf8')
}
