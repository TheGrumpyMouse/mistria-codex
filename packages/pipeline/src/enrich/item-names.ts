/**
 * Read the game's real internal item names from a community datamining mod.
 *
 * This is the highest-leverage thing available before the game files. Every
 * item id in this project is currently `toSnakeId(displayName)` — a guess — and
 * hard rule 3 says the internal snake_case name is the key. Where the guess is
 * wrong, nothing detects it: the id looks fine, resolves fine, and only becomes
 * a problem when the real names arrive and every saved donation is keyed to an
 * id that no longer exists.
 *
 * AnnaNomoly's DigUpAnything mod publishes the mapping as a markdown table:
 * numeric id, internal name, displayed name, read out of the game at v0.15.0.
 * That is an identifier mapping, not prose. See `curated/vocab/item_names.json`
 * for the licensing note and why matching is on the display name.
 *
 * The numeric ids are kept in the snapshot for provenance and **nothing is
 * allowed to reference them** — that is hard rule 3's other half.
 */
import { join } from 'node:path'
import { argv } from 'node:process'
import { pathToFileURL } from 'node:url'
import { consola } from 'consola'
import { fetchWithCache } from '../lib/http.js'
import { CURATED_DIR, SOURCES_DIR } from '../lib/paths.js'
import { readJsonFile } from '../lib/read-json.js'
import { writeJson } from '../lib/write-json.js'

interface ItemNamesVocab {
  url: string
  gameVersion: string
  attribution: string
  excludeMarkers: string[]
  missingDisplayName: string
}

export interface ExtractedItemName {
  /** Provenance only. Nothing may reference this — see hard rule 3. */
  numericId: number
  internalName: string
  displayName: string | null
  /** DISABLED, GLITCHED, PLACEHOLDER — content that does not work in game. */
  markers: string[]
}

export interface ItemNamesExtract {
  gameVersion: string
  attribution: string
  url: string
  names: ExtractedItemName[]
}

/** `| 30 | animal_currency | Shiny Bead | **DISABLED** |` */
const ROW = /^\|\s*(\d+)\s*\|\s*([a-z0-9_]+)\s*\|\s*([^|]*?)\s*(?:\|\s*(.*?)\s*)?\|?\s*$/

export function parseNameTable(markdown: string, vocab: ItemNamesVocab): ExtractedItemName[] {
  const names: ExtractedItemName[] = []

  for (const line of markdown.split('\n')) {
    const row = ROW.exec(line.trim())
    if (row === null) continue

    const displayName = (row[3] ?? '').trim()
    const notes = row[4] ?? ''
    names.push({
      numericId: Number(row[1]),
      internalName: (row[2] ?? '').trim(),
      displayName:
        displayName === '' || displayName === vocab.missingDisplayName ? null : displayName,
      markers: vocab.excludeMarkers.filter((marker) => notes.toUpperCase().includes(marker)),
    })
  }

  return names
}

export async function enrichItemNames(
  options: { useCache?: boolean } = {},
): Promise<ItemNamesExtract> {
  const wiki = await readJsonFile<{ throttleMs: number }>(join(CURATED_DIR, 'vocab', 'wiki.json'))
  const vocab = await readJsonFile<ItemNamesVocab>(join(CURATED_DIR, 'vocab', 'item_names.json'))

  const markdown = await fetchWithCache(vocab.url, {
    throttleMs: wiki.throttleMs,
    ...(options.useCache === undefined ? {} : { useCache: options.useCache }),
  })

  const names = parseNameTable(markdown, vocab)
  if (names.length < 500) {
    throw new Error(
      `Parsed only ${names.length} internal names, expected ~1,900. The mod's README ` +
        'changed shape; refusing to overwrite a good snapshot with a partial one.',
    )
  }

  const extract: ItemNamesExtract = {
    gameVersion: vocab.gameVersion,
    attribution: vocab.attribution,
    url: vocab.url,
    names,
  }

  await writeJson(join(SOURCES_DIR, 'community', 'item_names.json'), extract)
  return extract
}

async function main(): Promise<void> {
  const extract = await enrichItemNames({ useCache: !argv.includes('--no-cache') })
  const usable = extract.names.filter((n) => n.displayName !== null && n.markers.length === 0)
  consola.info(
    `${extract.names.length} internal names at v${extract.gameVersion}, ` +
      `${usable.length} usable for matching`,
  )
}

const entry = argv[1]
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  main().catch((err: unknown) => {
    consola.error(err instanceof Error ? err.message : err)
    process.exitCode = 1
  })
}
