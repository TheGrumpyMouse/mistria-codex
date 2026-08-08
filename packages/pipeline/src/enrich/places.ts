/**
 * Read the buildings of Mistria from their `{{Infobox location}}`.
 *
 * The dataset had sixteen outdoor regions and no interiors, which meant there
 * was nowhere to put an NPC who is indoors — and they are indoors for most of
 * the day. It also meant "the Museum" was a museum-set index and a shop's
 * location string, but not a place.
 *
 * The list of buildings is curated (see `curated/vocab/places.json`); every
 * fact about each one is read here. That split matters twice over: the Museum
 * is in The Narrows and the Carpenter is on The Eastern Road, and both would
 * have been filed in town by anyone typing from memory.
 *
 * `unlock` becomes a real gate. Six of these thirteen are behind a story quest,
 * so an app that lists them without that is telling a new player to visit a
 * building that is still rubble.
 */
import { join } from 'node:path'
import { argv } from 'node:process'
import { pathToFileURL } from 'node:url'
import { consola } from 'consola'
import { CURATED_DIR, SOURCES_DIR } from '../lib/paths.js'
import { readJsonFile } from '../lib/read-json.js'
import { fetchPage, infoboxFields, lastEditedAt, type PageFetchOptions } from '../lib/wiki.js'
import { writeJson } from '../lib/write-json.js'

interface PlacesVocab {
  template: string
  places: { page: string; id: string; name: string; kind: string; aliases: string[] }[]
  /** Regions that already exist as locations and are read only for their gate. */
  regions: { page: string; id: string }[]
}

export interface ExtractedPlace {
  id: string
  page: string
  /** The region the infobox puts it in. Null when the page states none. */
  region: string | null
  /** The story quest that unlocks it, if it is not there from the start. */
  unlockQuest: string | null
  /** Characters the infobox lists as living there. */
  residents: string[]
  lastEdited: string | null
}

export interface PlacesExtract {
  lastEdited: string | null
  places: ExtractedPlace[]
}

/** `{{SourceIcon|Story Quest|Repair the Bell Tower}}` — the quest is the last argument. */
const SOURCE_ICON = /\{\{SourceIcon\|([^}]*)\}\}/i
/** `{{NPC|Hemlock}}`, repeated and separated by `<br>`. */
const NPC = /\{\{NPC\|([^|}]+)/g

/**
 * The quest named by an `unlock=` field, or null when there is none.
 *
 * `{{SourceIcon|Start}}` means the building is there from the first day, which
 * is an answer and not a missing value — it resolves to null with no gap.
 */
export function unlockQuestOf(field: string | undefined): string | null {
  if (field === undefined || field.trim() === '') return null

  const args = SOURCE_ICON.exec(field)?.[1]
  if (args === undefined) return null

  const parts = args.split('|').map((p) => p.trim())
  const last = parts[parts.length - 1]
  if (last === undefined || parts.length < 2) return null
  // "Story Quest", "Story Quest Nil" and "Story Quest short" are icon variants,
  // not quest names — a one-argument call names no quest at all.
  if (/^story quest/i.test(last)) return null
  // The wiki double-spaces some quest names inside the template call.
  return last.replace(/\s+/g, ' ') || null
}

export async function enrichPlaces(options: { useCache?: boolean } = {}): Promise<PlacesExtract> {
  const wiki = await readJsonFile<{ endpoint: string; throttleMs: number }>(
    join(CURATED_DIR, 'vocab', 'wiki.json'),
  )
  const vocab = await readJsonFile<PlacesVocab>(join(CURATED_DIR, 'vocab', 'places.json'))
  const fetchOptions: PageFetchOptions = { ...wiki, useCache: options.useCache }

  // Regions are read the same way and for the same fields; they differ only in
  // that a Location record for them already exists, so the build merges rather
  // than creates. Keeping one loop means a region can never quietly miss a
  // field a building gets.
  const wanted = [...vocab.places, ...vocab.regions]

  const places: ExtractedPlace[] = []
  for (const place of wanted) {
    const wikitext = await fetchPage(place.page, fetchOptions)
    const fields = infoboxFields(wikitext, vocab.template)
    if (fields.size === 0) {
      throw new Error(
        `"${place.page}" has no {{${vocab.template}}}. The page was restructured or ` +
          'renamed; check curated/vocab/places.json.',
      )
    }

    places.push({
      id: place.id,
      page: place.page,
      region: fields.get('location')?.trim() || null,
      unlockQuest: unlockQuestOf(fields.get('unlock')),
      residents: [...(fields.get('residents') ?? '').matchAll(NPC)].map((m) => (m[1] ?? '').trim()),
      lastEdited: await lastEditedAt(place.page, fetchOptions),
    })
  }

  const extract: PlacesExtract = {
    // The newest edit across the set, so the whole batch has one freshness
    // number as well as one per place.
    lastEdited:
      places
        .map((p) => p.lastEdited)
        .sort()
        .at(-1) ?? null,
    places,
  }

  await writeJson(join(SOURCES_DIR, 'wiki', 'pages', 'places.json'), extract)
  return extract
}

async function main(): Promise<void> {
  const extract = await enrichPlaces({ useCache: !argv.includes('--no-cache') })
  for (const place of extract.places) {
    consola.log(
      `${place.id.padEnd(20)} ${(place.region ?? '?').padEnd(18)}` +
        `${place.unlockQuest === null ? 'from the start' : `needs "${place.unlockQuest}"`}` +
        `${place.residents.length > 0 ? `  ·  ${place.residents.join(', ')}` : ''}`,
    )
  }
  consola.info(`${extract.places.length} places`)
}

const entry = argv[1]
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  main().catch((err: unknown) => {
    consola.error(err instanceof Error ? err.message : err)
    process.exitCode = 1
  })
}
