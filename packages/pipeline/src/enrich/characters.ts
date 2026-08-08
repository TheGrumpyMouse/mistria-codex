/**
 * Which image file belongs to which villager.
 *
 * The Characters Cargo table has no image column, so the filenames live only in
 * each villager's `{{Character}}` infobox — and they are written as template
 * calls rather than literals:
 *
 * ```
 * |title=[[File:{{ROOTPAGENAME}} icon.png|30px]] {{ROOTPAGENAME}}
 * |image=[[File:Adeline Portrait.png|thumb]]
 * ```
 *
 * **The pattern is not the source.** `{{ROOTPAGENAME}} icon.png` looks like a
 * rule you could apply to all 34 names without reading a single page, and doing
 * that would be inventing data: any villager whose file is named differently
 * would get a filename that has never existed, and the fetcher would fail on it
 * with no idea which of the two was wrong. So every page is read, the token is
 * expanded against *that page's* title, and a villager whose infobox names no
 * file is reported as a gap rather than guessed at.
 *
 * A filename is an identifier, not prose. Capturing one is consistent with never
 * committing page wikitext — see docs/DATA-POLICY.md.
 */
import { join } from 'node:path'
import { argv } from 'node:process'
import { pathToFileURL } from 'node:url'
import { consola } from 'consola'
import { CURATED_DIR, SOURCES_DIR } from '../lib/paths.js'
import { readJsonFile } from '../lib/read-json.js'
import { fetchPage, infoboxFields, type PageFetchOptions } from '../lib/wiki.js'
import { writeJson } from '../lib/write-json.js'

export interface CharacterArt {
  character: string
  /** The small menu/chat icon, used in lists and gift tables. */
  icon: string | null
  /** The full portrait, shown on the villager's own page. */
  portrait: string | null
}

export interface CharactersExtract {
  characters: CharacterArt[]
  /** Villagers whose infobox named no file. Reported, never filled in. */
  missing: string[]
}

/** `[[File:Adeline Portrait.png|thumb]]` — the name, before any `|` options. */
const FILE_IN_FIELD = /\[\[\s*File:([^\]|]+)/i

/**
 * Resolve the magic words a `{{Character}}` infobox is written with.
 *
 * `{{ROOTPAGENAME}}` is the page title with any subpage suffix dropped, and
 * `{{PAGENAME}}` is the title itself. Both appear; on a villager page they are
 * the same string. Expanding them locally rather than asking the API to render
 * the page keeps this to one fetch per villager instead of two.
 */
export function expandPageName(field: string, page: string): string {
  return field.replace(/\{\{\s*(?:ROOTPAGENAME|PAGENAME|BASEPAGENAME)\s*\}\}/gi, page)
}

/** The file a single infobox field names, with page tokens resolved. */
export function fileInField(field: string | undefined, page: string): string | null {
  if (field === undefined) return null
  const name = FILE_IN_FIELD.exec(expandPageName(field, page))?.[1]?.trim()
  return name === undefined || name === '' ? null : name
}

/**
 * The two files a villager's infobox names.
 *
 * `images=` also lists the seasonal outfits — spring, summer, fall, winter,
 * beach, bathhouse. Those are six more large images per villager for a wardrobe
 * feature this app does not have, so they are deliberately not taken. Fetching
 * art we have nowhere to show is bandwidth taken from a volunteer wiki for
 * nothing.
 */
export function parseCharacterArt(wikitext: string, page: string): CharacterArt {
  const fields = infoboxFields(wikitext, 'Character')
  return {
    character: page,
    icon: fileInField(fields.get('title'), page),
    portrait: fileInField(fields.get('image'), page),
  }
}

export async function enrichCharacters(
  options: { useCache?: boolean } = {},
): Promise<CharactersExtract> {
  const wiki = await readJsonFile<{ endpoint: string; throttleMs: number }>(
    join(CURATED_DIR, 'vocab', 'wiki.json'),
  )
  const vocab = await readJsonFile<{ roster: string[] }>(
    join(CURATED_DIR, 'vocab', 'characters.json'),
  )
  const fetchOptions: PageFetchOptions = { ...wiki, useCache: options.useCache }

  const characters: CharacterArt[] = []
  const missing: string[] = []

  for (const page of vocab.roster) {
    const art = parseCharacterArt(await fetchPage(page, fetchOptions), page)
    characters.push(art)
    if (art.icon === null && art.portrait === null) missing.push(page)
  }

  const extract: CharactersExtract = { characters, missing }
  await writeJson(join(SOURCES_DIR, 'wiki', 'pages', 'characters.json'), extract)

  if (missing.length > 0) {
    consola.warn(`characters: no image field for ${missing.join(', ')}`)
  }
  return extract
}

async function main(): Promise<void> {
  const extract = await enrichCharacters({ useCache: !argv.includes('--no-cache') })
  const icons = extract.characters.filter((c) => c.icon !== null).length
  const portraits = extract.characters.filter((c) => c.portrait !== null).length
  consola.success(
    `characters: ${icons} icons, ${portraits} portraits across ${extract.characters.length} villagers`,
  )
}

const entry = argv[1]
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  main().catch((err: unknown) => {
    consola.error(err instanceof Error ? err.message : err)
    process.exitCode = 1
  })
}
