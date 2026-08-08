/**
 * Extract the enumeration of Mistria's water bodies from the Fishing page.
 *
 * This closes the single largest hole in the dataset. `Items.location` says
 * "Pond" for thirty-five fish, and until now that produced a window with a
 * habitat, no locations, and a `locations` data gap — 113 fishing and diving
 * windows that could not put a pin on a map.
 *
 * The gap was ours, not the wiki's. The Fishing page has a "Fishing Locations"
 * section that lists every pond, river and ocean-reachable region, wrapped in
 * `<div id="Pond">` / `<div id="River">` / `<div id="Ocean">` anchors so other
 * pages can deep-link to them. That is a machine-readable enumeration, and it
 * turns "which pond?" from unanswerable into a three-item list.
 *
 * What is still an inference is whether a *given* fish lives in all three. The
 * build marks the expanded window `confidence: "inferred"` and the app draws
 * those pins hollow. See `curated/vocab/waters.json`.
 *
 * Only the link targets and the divable flag are kept. The positional prose on
 * the Mistria pond entry is the wiki's writing; it is read here to place a pin
 * when the map is drawn, and never stored.
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
  sections,
  versionStamp,
} from '../lib/wiki.js'
import { writeJson } from '../lib/write-json.js'

interface WatersVocab {
  page: string
  section: string
  habitatByDivId: Record<string, string>
}

/** One region in which a given kind of water can be reached. */
export interface ExtractedWater {
  /** The habitat the page's anchor names: pond, river, ocean. */
  habitat: string
  /** The wiki page the entry links to, and the words it was written as. */
  location: { target: string; display: string }
  /**
   * False only where the page says "(not divable)".
   *
   * The list marks its exceptions, so silence is an answer rather than a
   * missing one — but it is the page's convention, not a stated fact, which is
   * why the expanded diving window is `confidence: "inferred"` like every
   * other habitat expansion.
   */
  divable: boolean
}

/** Which floors of a mine biome actually hold water. */
export interface ExtractedMineFishing {
  /** `{{BiomesQuick|3}}` — the biome's order, 1 (Upper Mines) to 5. */
  biomeOrder: number
  /**
   * Fishable floor ranges. Empty means the page named no range, so the biome's
   * own floors stand. More than one is normal: the Ancient Ruins are fishable
   * on 81-89 and 91-99, and floor 90 is neither a seal nor fishable.
   */
  floors: { min: number; max: number }[]
}

export interface WatersExtract {
  wikiVersionStamp: string | null
  lastEdited: string | null
  waters: ExtractedWater[]
  mineFishing: ExtractedMineFishing[]
}

/** `[[Target]]` or `[[Target|Display]]`. */
const LINK = /\[\[([^\]|]+?)(?:\|([^\]]*))?\]\]/
/** The page spells it "divable"; the dictionary prefers "diveable". Accept both. */
const NOT_DIVABLE = /not\s+dive?able/i
/** `{{BiomesQuick|3|no link}}` — the first argument is the biome's order. */
const BIOME_ORDER = /\{\{BiomesQuick\|(\d+)/i
/** `(floors 2 - 19)`, `(floors 81-89, 91-99)`. */
const FLOORS = /\(floors?\s+([\d\s,–-]+)\)/i

const divBody = (wikitext: string, id: string): string | null =>
  new RegExp(`<div\\s+id="${id}"\\s*>([\\s\\S]*?)</div>`, 'i').exec(wikitext)?.[1] ?? null

/**
 * The regions listed under one water-type anchor.
 *
 * Only the **first** link on a line is the region. The Mistria pond entry reads
 * `[[Mistria]] (West of [[Manor House|The Manor]]…)`, and taking every link
 * would file the Manor House as a pond.
 */
export function parseWaterBlock(body: string, habitat: string): ExtractedWater[] {
  const waters: ExtractedWater[] = []

  for (const line of body.split('\n')) {
    // The first <li> of the block is the "Ponds can be found in:" header and
    // carries no link, so it drops out here rather than needing a rule.
    if (!line.includes('<li>')) continue
    const link = LINK.exec(line)
    if (link === null) continue

    const target = (link[1] ?? '').split('#')[0]?.replace(/_/g, ' ').trim() ?? ''
    if (target === '') continue

    waters.push({
      habitat,
      location: { target, display: (link[2] ?? '').trim() },
      divable: !NOT_DIVABLE.test(line),
    })
  }

  return waters
}

/** Read `(floors 81-89, 91-99)` into ranges. */
export function parseFloorRanges(text: string): { min: number; max: number }[] {
  const inner = FLOORS.exec(text)?.[1]
  if (inner === undefined) return []

  const ranges: { min: number; max: number }[] = []
  for (const part of inner.split(',')) {
    const numbers = part.match(/\d+/g)?.map(Number) ?? []
    if (numbers.length === 0) continue
    // A lone number is a single fishable floor, not half a range.
    ranges.push({ min: Math.min(...numbers), max: Math.max(...numbers) })
  }
  return ranges
}

/** The mine biomes listed as fishable, with any floor range the page narrows them to. */
export function parseMineFishing(body: string): ExtractedMineFishing[] {
  const found: ExtractedMineFishing[] = []

  for (const line of body.split('\n')) {
    if (!line.includes('<li>')) continue
    const order = BIOME_ORDER.exec(line)?.[1]
    if (order === undefined) continue
    // `{{BiomesQuick|0}}` is the mines as a whole, not a biome.
    const biomeOrder = Number(order)
    if (biomeOrder < 1) continue
    found.push({ biomeOrder, floors: parseFloorRanges(line) })
  }

  return found
}

export async function enrichWaters(options: { useCache?: boolean } = {}): Promise<WatersExtract> {
  const wiki = await readJsonFile<{ endpoint: string; throttleMs: number }>(
    join(CURATED_DIR, 'vocab', 'wiki.json'),
  )
  const vocab = await readJsonFile<WatersVocab>(join(CURATED_DIR, 'vocab', 'waters.json'))
  const fetchOptions: PageFetchOptions = { ...wiki, useCache: options.useCache }

  const wikitext = await fetchPage(vocab.page, fetchOptions)
  const section = sections(wikitext, 2).find((s) => s.heading === vocab.section)
  if (section === undefined) {
    throw new Error(
      `${vocab.page} has no "== ${vocab.section} ==" section. The page was restructured.`,
    )
  }

  const waters: ExtractedWater[] = []
  for (const [divId, habitat] of Object.entries(vocab.habitatByDivId)) {
    const body = divBody(section.body, divId)
    if (body === null) {
      throw new Error(
        `${vocab.page}#${vocab.section}: no <div id="${divId}">. The anchors other ` +
          'pages link to have been removed or renamed; check habitatByDivId in ' +
          'curated/vocab/waters.json.',
      )
    }
    const block = parseWaterBlock(body, habitat)
    if (block.length === 0) {
      throw new Error(`${vocab.page}: the "${divId}" block listed no regions. Refusing to write.`)
    }
    waters.push(...block)
  }

  // The mine list sits outside the three anchored divs, in the same section.
  const mineFishing = parseMineFishing(section.body)

  const extract: WatersExtract = {
    wikiVersionStamp: versionStamp(wikitext),
    lastEdited: await lastEditedAt(vocab.page, fetchOptions),
    waters,
    mineFishing,
  }

  await writeJson(join(SOURCES_DIR, 'wiki', 'pages', 'waters.json'), extract)
  return extract
}

async function main(): Promise<void> {
  const extract = await enrichWaters({ useCache: !argv.includes('--no-cache') })
  for (const water of extract.waters) {
    consola.log(
      `${water.habitat.padEnd(6)} ${water.location.target.padEnd(22)}` +
        `${water.divable ? '' : 'not divable'}`,
    )
  }
  for (const mine of extract.mineFishing) {
    const floors = mine.floors.map((f) => `${f.min}-${f.max}`).join(', ')
    consola.log(`biome ${mine.biomeOrder}  ${floors === '' ? '(whole biome)' : floors}`)
  }
  consola.info(
    `${extract.waters.length} water bodies, ${extract.mineFishing.length} fishable biomes ` +
      `[edited ${extract.lastEdited?.slice(0, 10) ?? '?'}]`,
  )
}

const entry = argv[1]
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  main().catch((err: unknown) => {
    consola.error(err instanceof Error ? err.message : err)
    process.exitCode = 1
  })
}
