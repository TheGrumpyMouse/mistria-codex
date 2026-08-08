/**
 * Extract the annual festival calendar from the Calendar Events page.
 *
 * The date is the whole point — the Today view needs to know that Fall 10 is the
 * Harvest Festival before it can say anything useful about Fall 10 — and the
 * page encodes it far better than it looks. Each row carries
 * `data-sort-value="310"`, which is season 3, day 10: a machine-readable date
 * hiding inside a sorting hint.
 *
 * Ten festivals are listed and only four are implemented; the rest are marked
 * with an asterisk and a `{{Spoiler}}` wrapper. Both get extracted, because
 * "Halloween Festival exists in the files but not in the game" is a fact worth
 * keeping, and dropping the unimplemented ones would make it look like nobody
 * had checked.
 */
import { join } from 'node:path'
import { argv } from 'node:process'
import { pathToFileURL } from 'node:url'
import { consola } from 'consola'
import { canonicalWikiName } from '../assets/names.js'
import { CURATED_DIR, SOURCES_DIR } from '../lib/paths.js'
import { readJsonFile } from '../lib/read-json.js'
import {
  fetchPage,
  lastEditedAt,
  type PageFetchOptions,
  sections,
  tableRows,
  versionStamp,
} from '../lib/wiki.js'
import { writeJson } from '../lib/write-json.js'

interface CalendarVocab {
  page: string
  section: string
  seasonOrder: string[]
}

export interface ExtractedFestival {
  season: string
  day: number
  name: string
  /** The wiki page, when the festival has one. */
  page: string | null
  /**
   * The wiki marks unimplemented festivals with an asterisk and a footnote.
   * Six of the ten are files-only content that never fires in game.
   */
  implemented: boolean
  /** From the festival page's infobox. Null when there is no page yet. */
  location: string | null
  /**
   * The calendar icon's filename.
   *
   * `{{Icon|Calendar_icon_harvest_festival|…}}` names the file **without an
   * extension**, so `.png` is appended. That is the one assumption in this line,
   * and it fails loudly: the asset fetcher gets a 404 on a name that does not
   * exist rather than writing something wrong to disk.
   */
  icon: string | null
}

export interface CalendarExtract {
  wikiVersionStamp: string | null
  lastEdited: string | null
  festivals: ExtractedFestival[]
}

/** `data-sort-value="310"` — season 3, day 10. */
const SORT_DATE = /data-sort-value\s*=\s*"(\d{3})"/
/** `{{Icon|Calendar_icon_harvest_festival|Harvest Festival|size=30}}` */
const ICON_TARGET = /\{\{Icon\|[^|}]+\|([^|}]+)/
/** The same call, taking the file instead of the label. */
const ICON_FILE = /\{\{Icon\|([^|}]+)/
/** `|location=Mistria` in an event infobox. */
const INFOBOX_LOCATION = /^\|\s*location\s*=\s*(.+)$/m

/**
 * Parse the annual festival table.
 *
 * A row can hold two cells (day, name) or three, because the season cell is
 * `rowspan`ed across the festivals in that season. The three-digit sort value
 * carries the season anyway, so the season cell is never read — which also
 * means a change to the rowspan layout can't silently reassign a festival to the
 * wrong season.
 */
export function parseFestivalTable(table: string, seasonOrder: string[]): ExtractedFestival[] {
  const festivals: ExtractedFestival[] = []

  for (const row of tableRows(table)) {
    // Drop <section> markers so a trailing "*" is where it looks like it is.
    const clean = row.replace(/<section[^>]*\/?>/g, '').trim()

    // Only day cells carry a three-digit sort value; the season cell's is one
    // digit and the header's is absent.
    const sortValue = SORT_DATE.exec(clean)?.[1]
    if (sortValue === undefined) continue

    const seasonIndex = Number(sortValue.slice(0, 1)) - 1
    const day = Number(sortValue.slice(1))
    const season = seasonOrder[seasonIndex]
    if (season === undefined || !Number.isInteger(day) || day < 1) continue

    const name = ICON_TARGET.exec(clean)?.[1]?.trim()
    if (name === undefined || name === '') continue

    const iconFile = ICON_FILE.exec(clean)?.[1]?.trim()

    festivals.push({
      season,
      day,
      name,
      page: name,
      implemented: !clean.trimEnd().endsWith('*'),
      location: null,
      icon:
        iconFile === undefined || iconFile === ''
          ? null
          : canonicalWikiName(`${iconFile.replace(/\.png$/i, '')}.png`),
    })
  }

  return festivals
}

export async function enrichCalendar(
  options: { useCache?: boolean } = {},
): Promise<CalendarExtract> {
  const wiki = await readJsonFile<{ endpoint: string; throttleMs: number }>(
    join(CURATED_DIR, 'vocab', 'wiki.json'),
  )
  const vocab = await readJsonFile<CalendarVocab>(join(CURATED_DIR, 'vocab', 'calendar.json'))
  const fetchOptions: PageFetchOptions = { ...wiki, useCache: options.useCache }

  const wikitext = await fetchPage(vocab.page, fetchOptions)
  const annual = sections(wikitext, 3).find((s) => s.heading === vocab.section)
  if (annual === undefined) {
    throw new Error(
      `${vocab.page} has no "=== ${vocab.section} ===" section. The page was restructured.`,
    )
  }

  const festivals = parseFestivalTable(annual.body, vocab.seasonOrder)
  if (festivals.length === 0) {
    throw new Error(
      `${vocab.page}: parsed zero festivals. Refusing to write an empty calendar — ` +
        'the table layout has changed.',
    )
  }

  // Only implemented festivals get their page read. An unimplemented one has no
  // page (it is files-only content), and asking for it would 404 on every run.
  for (const festival of festivals) {
    if (!festival.implemented) {
      festival.page = null
      continue
    }
    try {
      const page = await fetchPage(festival.name, fetchOptions)
      festival.location = INFOBOX_LOCATION.exec(page)?.[1]?.trim() ?? null
    } catch (err) {
      consola.warn(`${festival.name}: ${err instanceof Error ? err.message : String(err)}`)
      festival.page = null
    }
  }

  const extract: CalendarExtract = {
    wikiVersionStamp: versionStamp(wikitext),
    lastEdited: await lastEditedAt(vocab.page, fetchOptions),
    festivals,
  }

  await writeJson(join(SOURCES_DIR, 'wiki', 'pages', 'festivals.json'), extract)
  return extract
}

async function main(): Promise<void> {
  const extract = await enrichCalendar({ useCache: !argv.includes('--no-cache') })
  for (const f of extract.festivals) {
    consola.log(
      `${f.season.padEnd(6)} ${String(f.day).padStart(2)}  ${f.name.padEnd(24)}` +
        `${f.implemented ? (f.location ?? '(location unknown)') : 'not implemented'}`,
    )
  }
  const live = extract.festivals.filter((f) => f.implemented).length
  consola.info(
    `${extract.festivals.length} festivals, ${live} implemented ` +
      `[stamp ${extract.wikiVersionStamp ?? '?'}, edited ${extract.lastEdited?.slice(0, 10) ?? '?'}]`,
  )
}

const entry = argv[1]
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  main().catch((err: unknown) => {
    consola.error(err instanceof Error ? err.message : err)
    process.exitCode = 1
  })
}
