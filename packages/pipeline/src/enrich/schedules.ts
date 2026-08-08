/**
 * Read NPC schedules from the `<Name>/Schedule` subpages.
 *
 * **The wiki has schedules for two of the thirty-four villagers.** Every other
 * subpage exists and is empty — a stub with a tab header and nothing under it.
 * That is worth stating plainly, because the plan assumed twelve romanceables
 * were transcribable and they are not. The parser is built for the whole cast
 * regardless: when someone fills a page in, `pnpm enrich:pages` picks it up with
 * no code change, and the coverage report is what says how many are still empty.
 *
 * A page is season sections, each holding a section per day, each holding a
 * table of "at this time, in this place". A day may split further on a story
 * quest ("Before / After Repair the Bridge is complete"), which the schedule's
 * priority-ordered overrides express exactly.
 *
 * Two kinds of variant are extracted but deliberately not turned into schedule
 * entries downstream — rainy days and Friday Night at the Inn both select
 * between several tables using a hidden counter the player cannot see. They are
 * kept here so the fact is not lost, and the build records a gap rather than
 * picking one and calling it the answer. See build/builders/schedules.ts.
 */
import { join } from 'node:path'
import { argv } from 'node:process'
import { pathToFileURL } from 'node:url'
import { consola } from 'consola'
import { CURATED_DIR, SOURCES_DIR } from '../lib/paths.js'
import { readJsonFile } from '../lib/read-json.js'
import {
  fetchPage,
  lastEditedAt,
  type PageFetchOptions,
  rowCells,
  sections,
  tableRows,
} from '../lib/wiki.js'
import { writeJson } from '../lib/write-json.js'

interface ScheduleVocab {
  /** `{page}` is replaced with the character's page name. */
  pagePattern: string
  /** Section headings that are a season, keyed by the season name. */
  seasonHeadings: Record<string, string>
  dayHeadings: string[]
}

/** One "at this time, be here" row. */
export interface ExtractedStop {
  /** `6:00 AM`, `06:00`, `12:10 AM (next day)`, `1 Day Post` — raw, parsed by the build. */
  time: string
  /** `Manor: Adeline's Bedroom`, `Inn (South Table Bottom 1)`, `Town`. */
  place: string
}

export interface ExtractedTable {
  /** The `== … ==` heading, reduced to a season name or a variant label. */
  section: string
  /** The `=== … ===` heading: a day name, or the name of a variant. */
  group: string
  /** The `==== … ====` heading, when a day splits on a condition. */
  variant: string | null
  stops: ExtractedStop[]
}

export interface ExtractedSchedule {
  character: string
  page: string
  lastEdited: string | null
  tables: ExtractedTable[]
}

export interface ScheduleExtract {
  lastEdited: string | null
  /**
   * Every character whose subpage was read, whether or not it held anything.
   * The difference between "nobody has written this down" and "we never looked"
   * is the whole point of recording it.
   */
  checked: string[]
  schedules: ExtractedSchedule[]
}

/** Any `{{Template|args}}` call, capturing the arguments. */
const TEMPLATE = /\{\{([^{}]+)\}\}/g

/**
 * The word a template call contributes to a heading.
 *
 * The **last** positional argument, not the first. `{{Season|Spring}}` has one
 * either way, but `{{SourceIcon|Story quest short|Repair the Bridge}}` names an
 * icon first and the quest second — reading the first argument gated a whole
 * Saturday schedule on a quest called "Story quest short".
 *
 * Named arguments (`width=18px`) are skipped: they style the call rather than
 * saying what it is about.
 */
function templateWord(args: string): string {
  const positional = args
    .split('|')
    .slice(1)
    .map((a) => a.trim())
    .filter((a) => a !== '' && !/^[\w -]+=/.test(a))
  return positional.at(-1) ?? ''
}

/**
 * Reduce a heading to the words a rule can match on.
 *
 * Headings carry file links, templates and icons: `== {{Season|Spring}}
 * Schedules ==` and `== [[File:… .png|…]] Friday Night at the Inn ==`. Both
 * have to come out as something a curated table can name.
 */
export function headingWords(heading: string): string {
  return heading
    .replace(/\[\[File:[^\]]*\]\]/gi, '')
    .replace(TEMPLATE, (_whole, args: string) => templateWord(args))
    .replace(/\[\[[^\]|]*\|([^\]]*)\]\]/g, '$1')
    .replace(/\[\[|\]\]/g, '')
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*Schedules?\s*$/i, '')
    .trim()
}

/**
 * Read a schedule table into stops.
 *
 * Both cell styles appear, sometimes on the same page: `|6:00 AM` then
 * `|Manor: Foyer` on two lines, and `|06:00||Manor: Foyeur` on one. `rowCells`
 * handles both, so a row is simply its first two cells.
 */
export function parseStops(table: string): ExtractedStop[] {
  const stops: ExtractedStop[] = []

  for (const row of tableRows(table)) {
    const cells = rowCells(row)
    const time = plain(cells[0]?.text ?? '')
    const place = plain(cells[1]?.text ?? '')
    // A header row has no time cell; the `{{#var:header1}}` line is not a cell
    // at all. Requiring both fields drops them without a rule for each.
    if (time === '' || place === '') continue
    stops.push({ time, place })
  }

  return stops
}

/** Strip the bold, links and stray colons the schedule tables are written with. */
const plain = (text: string): string =>
  text
    .replace(/'''/g, '')
    .replace(/\[\[[^\]|]*\|([^\]]*)\]\]/g, '$1')
    .replace(/\[\[|\]\]/g, '')
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .replace(/:\s*$/, '')
    .trim()

/** Pull every table out of one character's page, tagged with where it sat. */
export function parseSchedulePage(wikitext: string): ExtractedTable[] {
  const tables: ExtractedTable[] = []

  for (const top of sections(wikitext, 2)) {
    const section = headingWords(top.heading)

    for (const middle of sections(top.body, 3)) {
      const group = headingWords(middle.heading)
      const deeper = sections(middle.body, 4)

      if (deeper.length === 0) {
        const stops = parseStops(middle.body)
        if (stops.length > 0) tables.push({ section, group, variant: null, stops })
        continue
      }

      for (const leaf of deeper) {
        const stops = parseStops(leaf.body)
        if (stops.length > 0) {
          tables.push({ section, group, variant: headingWords(leaf.heading), stops })
        }
      }
    }
  }

  return tables
}

export async function enrichSchedules(
  options: { useCache?: boolean } = {},
): Promise<ScheduleExtract> {
  const wiki = await readJsonFile<{ endpoint: string; throttleMs: number }>(
    join(CURATED_DIR, 'vocab', 'wiki.json'),
  )
  const vocab = await readJsonFile<ScheduleVocab>(join(CURATED_DIR, 'vocab', 'schedules.json'))
  const { roster } = await readJsonFile<{ roster: string[] }>(
    join(CURATED_DIR, 'vocab', 'characters.json'),
  )
  const fetchOptions: PageFetchOptions = { ...wiki, useCache: options.useCache }

  const schedules: ExtractedSchedule[] = []
  for (const character of roster) {
    const page = vocab.pagePattern.replace('{page}', character)
    let wikitext: string
    try {
      wikitext = await fetchPage(page, fetchOptions)
    } catch (err) {
      // A missing subpage is the normal case for most of the cast, and is not
      // an error — it is the absence this extract exists to record.
      consola.debug(`${page}: ${err instanceof Error ? err.message : String(err)}`)
      continue
    }

    const tables = parseSchedulePage(wikitext)
    if (tables.length === 0) continue

    schedules.push({
      character,
      page,
      lastEdited: await lastEditedAt(page, fetchOptions),
      tables,
    })
  }

  const extract: ScheduleExtract = {
    lastEdited:
      schedules
        .map((s) => s.lastEdited)
        .sort()
        .at(-1) ?? null,
    checked: roster,
    schedules,
  }

  await writeJson(join(SOURCES_DIR, 'wiki', 'pages', 'schedules.json'), extract)
  return extract
}

async function main(): Promise<void> {
  const extract = await enrichSchedules({ useCache: !argv.includes('--no-cache') })
  for (const schedule of extract.schedules) {
    const stops = schedule.tables.reduce((n, t) => n + t.stops.length, 0)
    consola.log(`${schedule.character.padEnd(12)} ${schedule.tables.length} tables, ${stops} stops`)
  }
  consola.info(
    `${extract.schedules.length} of ${extract.checked.length} villagers have a schedule on the wiki`,
  )
}

const entry = argv[1]
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  main().catch((err: unknown) => {
    consola.error(err instanceof Error ? err.message : err)
    process.exitCode = 1
  })
}
