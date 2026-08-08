/**
 * Where everything actually is.
 *
 * The wiki runs the DataMaps extension, which means its maps are not pictures —
 * they are **JSON pages in the `Map:` namespace**, each with a declared
 * coordinate space and a list of markers carrying a name, a position and the
 * article the marker points at. That last field is the join: it is the same
 * page-name key every other enricher in this pipeline already uses.
 *
 * This is the source that was missing. Before it, placing thirteen buildings in
 * Mistria meant inventing spatial data, which this project refuses to do — so
 * all 29 locations carried an `anchor` gap and nothing could be pinned.
 *
 * **Only the world map is usable, and that is a finding, not an oversight.**
 * `Map:Town`, `Map:Beach (Demo)` and the other per-region pages exist but hold
 * zero markers, and their declared coordinate space does not match their own
 * background image — `Map:Town` claims 1074x2034 for a 1356x716 picture. They
 * are unfinished stubs. Reading them would produce confident nonsense.
 *
 * The world map is the opposite: its space is 3599x5442 and its background is
 * 5442x3599, which is the same numbers in the extension's `[lat, lon]` order,
 * and all 46 markers fall inside it. That agreement is checked here rather than
 * assumed, because a coordinate space that does not match its own art is
 * exactly how every pin ends up quietly in the wrong place.
 */
import { join } from 'node:path'
import { argv } from 'node:process'
import { pathToFileURL } from 'node:url'
import { consola } from 'consola'
import { CURATED_DIR, SOURCES_DIR } from '../lib/paths.js'
import { readJsonFile } from '../lib/read-json.js'
import { fetchPage, type PageFetchOptions } from '../lib/wiki.js'
import { writeJson } from '../lib/write-json.js'

interface MapsVocab {
  /** The one `Map:` page worth reading, and why. */
  page: string
  /** The background file, so its dimensions can be checked against the space. */
  background: string
  /** The game version the wiki drew this map for. */
  gameVersion: string
}

export interface ExtractedMarker {
  /** The marker group: `Regions`, `Buildings`, `Statues`, `Fountains`, `Quest`. */
  group: string
  name: string
  /**
   * The wiki page this marker links to, minus any `#section`, which is how a
   * marker is matched to one of our records. Null when the marker links nowhere
   * — the quest gates do not.
   */
  article: string | null
  /** The `#section`, when the marker points inside a page rather than at it. */
  section: string | null
  /** SVG user units, x rightwards. */
  x: number
  y: number
}

export interface MapsExtract {
  page: string
  gameVersion: string
  /** `[width, height]` in the same units as every marker. */
  size: [number, number]
  markers: ExtractedMarker[]
}

/**
 * DataMaps writes `lat`/`lon`, which are not latitude and longitude.
 *
 * `crs.topLeft` is `[0, 0]` and `crs.bottomRight` is `[height, width]`, so
 * **`lat` counts downwards from the top and `lon` counts rightwards from the
 * left** — y and x, in that order, with the axis names borrowed from a mapping
 * library rather than meant literally.
 *
 * Verified against the art rather than reasoned about: the Town marker at
 * `lon 3429, lat 1851` lands on the village, and the Beach, Summit and Deep
 * Woods markers each land on their own region. Reading the pair the other way
 * round puts every one of them in a different place, and nothing in the JSON
 * would have said so.
 */
export function markerPoint(marker: { lat: number; lon: number }): { x: number; y: number } {
  return { x: marker.lon, y: marker.lat }
}

/** `The_Narrows#Errol's_Cabin` -> page and section, underscores undone. */
export function splitArticle(article: string | undefined): {
  article: string | null
  section: string | null
} {
  if (article === undefined || article.trim() === '') return { article: null, section: null }
  const [page, ...rest] = article.split('#')
  const clean = (value: string | undefined): string | null => {
    const text = (value ?? '').replace(/_/g, ' ').trim()
    return text === '' ? null : text
  }
  return { article: clean(page), section: clean(rest.join('#')) }
}

interface DataMap {
  crs?: { topLeft: [number, number]; bottomRight: [number, number] }
  background?: string
  markers?: Record<string, { lat: number; lon: number; name?: string; article?: string }[]>
}

export function parseDataMap(json: DataMap): {
  size: [number, number]
  markers: ExtractedMarker[]
} {
  const bottomRight = json.crs?.bottomRight
  if (bottomRight === undefined) {
    throw new Error('the map declares no coordinate space; every pin would be a guess')
  }
  // bottomRight is [lat, lon] — [height, width].
  const size: [number, number] = [bottomRight[1], bottomRight[0]]

  const markers: ExtractedMarker[] = []
  for (const [group, list] of Object.entries(json.markers ?? {})) {
    for (const marker of list) {
      const point = markerPoint(marker)
      // A marker outside its own declared space means the space and the art
      // disagree, and a pin drawn from it would land off the edge.
      if (point.x < 0 || point.y < 0 || point.x > size[0] || point.y > size[1]) {
        throw new Error(
          `marker "${marker.name ?? '?'}" at ${point.x},${point.y} falls outside the ` +
            `declared ${size[0]}x${size[1]} space.`,
        )
      }
      markers.push({
        group,
        name: (marker.name ?? '').trim(),
        ...splitArticle(marker.article),
        ...point,
      })
    }
  }

  markers.sort((a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name))
  return { size, markers }
}

export async function enrichMaps(options: { useCache?: boolean } = {}): Promise<MapsExtract> {
  const wiki = await readJsonFile<{ endpoint: string; throttleMs: number }>(
    join(CURATED_DIR, 'vocab', 'wiki.json'),
  )
  const vocab = await readJsonFile<MapsVocab>(join(CURATED_DIR, 'vocab', 'maps.json'))
  const fetchOptions: PageFetchOptions = { ...wiki, useCache: options.useCache }

  const raw = await fetchPage(vocab.page, fetchOptions)
  let json: DataMap
  try {
    json = JSON.parse(raw) as DataMap
  } catch {
    throw new Error(
      `${vocab.page} is no longer JSON. The wiki has changed how it stores maps; ` +
        'do not fall back to reading the rendered page.',
    )
  }

  const { size, markers } = parseDataMap(json)
  if (markers.length === 0) {
    throw new Error(`${vocab.page} has no markers. Refusing to write an empty map.`)
  }

  // The background is what our own art has to line up with, so a change in its
  // dimensions is a change in the coordinate space, whatever the JSON says.
  const url =
    `${wiki.endpoint.replace(/\/index\.php$/, '/api.php')}?action=query&format=json` +
    `&prop=imageinfo&iiprop=size&titles=${encodeURIComponent(`File:${vocab.background}`)}`
  const { fetchJson } = await import('../lib/http.js')
  const response = await fetchJson<{
    query?: { pages?: Record<string, { imageinfo?: { width: number; height: number }[] }> }
  }>(url, { throttleMs: wiki.throttleMs, useCache: false })
  const image = Object.values(response.query?.pages ?? {})[0]?.imageinfo?.[0]

  if (image !== undefined && (image.width !== size[0] || image.height !== size[1])) {
    throw new Error(
      `${vocab.page} declares a ${size[0]}x${size[1]} space but ${vocab.background} is ` +
        `${image.width}x${image.height}. The two must agree or every pin is off by a ratio ` +
        'nobody will notice until they compare the map to the game.',
    )
  }

  const extract: MapsExtract = {
    page: vocab.page,
    gameVersion: vocab.gameVersion,
    size,
    markers,
  }
  await writeJson(join(SOURCES_DIR, 'wiki', 'pages', 'maps.json'), extract)
  return extract
}

async function main(): Promise<void> {
  const extract = await enrichMaps({ useCache: !argv.includes('--no-cache') })
  const byGroup = new Map<string, number>()
  for (const m of extract.markers) byGroup.set(m.group, (byGroup.get(m.group) ?? 0) + 1)

  for (const marker of extract.markers) {
    consola.log(
      `${marker.group.padEnd(10)} ${String(marker.x).padStart(7)},${String(marker.y).padStart(7)}  ` +
        `${marker.name.padEnd(28)} ${marker.article ?? '-'}`,
    )
  }
  consola.info(
    `${extract.markers.length} markers in a ${extract.size[0]}x${extract.size[1]} space ` +
      `[${[...byGroup].map(([g, n]) => `${g} ${n}`).join(', ')}] at game ${extract.gameVersion}`,
  )
}

const entry = argv[1]
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  main().catch((err: unknown) => {
    consola.error(err instanceof Error ? err.message : err)
    process.exitCode = 1
  })
}
