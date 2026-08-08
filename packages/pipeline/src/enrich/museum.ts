/**
 * Extract museum set rosters from the four wing pages.
 *
 * The Cargo tables carry a `museumSet` *name* on bugs, crops and artifacts, but
 * never the roster — and `Fish` has no museumSet column at all, despite the fish
 * infoboxes showing one. The wing pages are the only place the complete
 * set-to-item mapping exists.
 *
 * **Only facts leave this module.** The raw page wikitext is never written to
 * `sources/`: it is CC BY-SA community text, and committing it would drag that
 * licence over part of this repo (see docs/DATA-POLICY.md). What gets written is
 * the wing, the set name, and the item names — none of which is prose.
 *
 * We get lucky on that front: the pages reference comments as
 * `{{MuseumComment|Koi}}` template calls rather than inline text, so the
 * wikitext contains no editor prose to begin with.
 */
import { join } from 'node:path'
import { argv } from 'node:process'
import { pathToFileURL } from 'node:url'
import { consola } from 'consola'
import { CURATED_DIR, SOURCES_DIR } from '../lib/paths.js'
import { readJsonFile } from '../lib/read-json.js'
import { fetchPage, lastEditedAt, type PageFetchOptions, versionStamp } from '../lib/wiki.js'
import { writeJson } from '../lib/write-json.js'

interface WingConfig {
  id: string
  page: string
  /** Cargo table whose `museumSet` column cross-checks this wing, if any. */
  crossCheck: string | null
}

export interface ExtractedSet {
  wing: string
  set: string
  items: string[]
  /**
   * `page` — the roster was listed in the wikitext.
   * `cargo` — the page generates it from a Cargo table's museumSet column, so
   * the roster is filled in at build time from that table instead.
   */
  rosterSource: 'page' | 'cargo'
}

export interface MuseumExtract {
  /** The wiki's own version stamp, so a pre-1.0 snapshot is visible downstream. */
  wikiVersionStamp: Record<string, string | null>
  /**
   * When each wing page was last edited.
   *
   * Fields of Mistria hit 1.0 on 2026-08-05 and the wiki is still catching up:
   * Insects was updated 2026-08-06, but Archaeology has not been touched since
   * February. Recording this makes "how stale is the museum" a number the app
   * and the coverage report can show, rather than something you'd have to know
   * to go and check.
   */
  lastEdited: Record<string, string | null>
  /** Carried through so the build knows which Cargo table backs each wing. */
  wings: { id: string; crossCheck: string | null }[]
  sets: ExtractedSet[]
}

const SET_HEADING = /^===\s*(.+?)\s*===$/gm
/** Any wiki link, capturing the target before an optional pipe. */
const WIKI_LINK = /\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g
/** Archaeology generates its rosters with {{ArtifactRows|museumSet=Alda}}. */
const CARGO_ROSTER = /museumSet\s*=\s*([^}|\n]+)/i

/**
 * The item name in a table row is the first link that isn't an image.
 *
 * The three wing pages disagree on how they write the icon — Fish uses
 * `[[File:koi.png|link=Koi]]`, Flora and Insects use a bare `[[File:cabbage.png]]`
 * — so keying on the icon at all is fragile. The name link is the one thing all
 * three have in common.
 *
 * Templates (`{{:Cabbage|Sources}}`, `{{MuseumComment|Ant}}`) use braces, not
 * brackets, so they never match.
 */
function itemFromRow(row: string): string | null {
  for (const match of row.matchAll(WIKI_LINK)) {
    const target = (match[1] ?? '').trim()
    if (target === '' || /^(File|Image|Category):/i.test(target)) continue
    return target.split('#')[0]?.replace(/_/g, ' ').trim() ?? null
  }
  return null
}

/**
 * Split a wing page into its sets.
 *
 * Sections after the last set (a `==History==` heading, for instance) are cut
 * by the level-2 boundary, so trailing links can't be mistaken for members.
 */
export function parseWingPage(wing: string, wikitext: string): ExtractedSet[] {
  // Everything from "==Sets==" to the next level-2 heading.
  const setsStart = wikitext.search(/^==\s*Sets\s*==$/m)
  const body = setsStart === -1 ? wikitext : wikitext.slice(setsStart + 1)
  const end = body.search(/^==[^=].*==$/m)
  const scope = end === -1 ? body : body.slice(0, end)

  const headings = [...scope.matchAll(SET_HEADING)]
  const sets: ExtractedSet[] = []

  for (const [index, heading] of headings.entries()) {
    const from = (heading.index ?? 0) + heading[0].length
    const to = headings[index + 1]?.index ?? scope.length
    const section = scope.slice(from, to)

    const setName = (heading[1] ?? '').trim()
    const items: string[] = []

    // Table rows only: skip `|-` separators, `|}` terminators and `{|` openers,
    // so the header template and surrounding prose can't contribute names.
    for (const line of section.split('\n')) {
      const row = line.trim()
      if (!row.startsWith('|') || row.startsWith('|-') || row.startsWith('|}')) continue
      const item = itemFromRow(row)
      if (item !== null && !items.includes(item)) items.push(item)
    }

    if (items.length > 0) {
      sets.push({ wing, set: setName, items, rosterSource: 'page' })
      continue
    }

    // Archaeology lists no rows — it asks Cargo for them. Record the set with an
    // empty roster and let the build fill it from the museumSet column.
    const cargoRoster = CARGO_ROSTER.exec(section)
    if (cargoRoster) {
      sets.push({
        wing,
        set: (cargoRoster[1] ?? setName).trim(),
        items: [],
        rosterSource: 'cargo',
      })
    }
  }

  return sets
}

export async function enrichMuseum(options: { useCache?: boolean } = {}): Promise<MuseumExtract> {
  const wiki = await readJsonFile<{ endpoint: string; throttleMs: number }>(
    join(CURATED_DIR, 'vocab', 'wiki.json'),
  )
  const config = await readJsonFile<{ wings: WingConfig[] }>(
    join(CURATED_DIR, 'vocab', 'museum_wings.json'),
  )
  const fetchOptions: PageFetchOptions = { ...wiki, useCache: options.useCache }

  const sets: ExtractedSet[] = []
  const wikiVersionStamp: Record<string, string | null> = {}
  const lastEdited: Record<string, string | null> = {}

  for (const wing of config.wings) {
    const wikitext = await fetchPage(wing.page, fetchOptions)

    wikiVersionStamp[wing.id] = versionStamp(wikitext)
    lastEdited[wing.id] = await lastEditedAt(wing.page, fetchOptions)

    const wingSets = parseWingPage(wing.id, wikitext)
    if (wingSets.length === 0) {
      throw new Error(
        `${wing.page}: parsed zero sets. Refusing to continue — the page layout has ` +
          'changed and writing an empty result would silently empty the museum.',
      )
    }

    sets.push(...wingSets)
    const itemCount = wingSets.reduce((n, s) => n + s.items.length, 0)
    const fromCargo = wingSets.filter((s) => s.rosterSource === 'cargo').length
    consola.success(
      `${wing.id}: ${wingSets.length} sets, ${itemCount} items` +
        (fromCargo > 0 ? ` (${fromCargo} rosters come from ${wing.crossCheck ?? 'Cargo'})` : '') +
        (wikiVersionStamp[wing.id] ? ` [stamp ${wikiVersionStamp[wing.id]}` : '') +
        (lastEdited[wing.id] ? `, edited ${lastEdited[wing.id]?.slice(0, 10)}]` : ']'),
    )
  }

  const extract: MuseumExtract = {
    wikiVersionStamp,
    lastEdited,
    wings: config.wings.map((w) => ({ id: w.id, crossCheck: w.crossCheck })),
    sets,
  }
  await writeJson(join(SOURCES_DIR, 'wiki', 'pages', 'museum_sets.json'), extract)
  return extract
}

async function main(): Promise<void> {
  const extract = await enrichMuseum({ useCache: !argv.includes('--no-cache') })
  const total = extract.sets.reduce((n, s) => n + s.items.length, 0)
  consola.info(`${extract.sets.length} sets, ${total} donatable items across four wings`)
}

const entry = argv[1]
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  main().catch((err: unknown) => {
    consola.error(err instanceof Error ? err.message : err)
    process.exitCode = 1
  })
}
