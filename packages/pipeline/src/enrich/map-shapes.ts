/**
 * Measure the shape of each region, and keep only the measurements.
 *
 * The wiki's map markers say *where* a region's centre is. They say nothing
 * about how far it extends, and the app needs that to draw anything at all —
 * otherwise nine points float on an empty page.
 *
 * The footprint is read off the map image itself, which is game art. **The
 * image is fetched to the HTTP cache, measured, and never committed.** That is
 * the same arrangement as every wiki page this pipeline reads: we look at the
 * source, we keep the facts, we do not redistribute the source. Coordinates are
 * facts and are the point of this project; the picture is NPC Studio's.
 *
 * The measurement is deliberately coarse. Each region is quantised to a square
 * grid and run-length encoded, which makes the whole valley under 3KB and —
 * more importantly — makes the result *look* like what it is. A cell is visibly
 * a cell, so nobody mistakes a footprint traced off a v0.13 screenshot for a
 * surveyed border.
 */
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { argv } from 'node:process'
import { pathToFileURL } from 'node:url'
import { consola } from 'consola'
import { PNG } from 'pngjs'
import { fetchBinary, fetchJson } from '../lib/http.js'
import { CACHE_DIR, CURATED_DIR, SOURCES_DIR } from '../lib/paths.js'
import { readJsonFile } from '../lib/read-json.js'
import { writeJson } from '../lib/write-json.js'
import type { MapsExtract } from './maps.js'

/**
 * Cell edge, in map units.
 *
 * 42 puts roughly 130 cells across the valley — fine enough that the Narrows'
 * ragged edge survives, coarse enough that the grid reads as a deliberate
 * mosaic rather than a failed attempt at an outline.
 */
const CELL = 42

/** The grass field between the tiles. Opaque, and the only green on the map. */
const isField = (r: number, g: number, b: number): boolean =>
  Math.abs(r - 150) < 24 && Math.abs(g - 152) < 24 && Math.abs(b - 114) < 28

export interface RegionShape {
  /** The marker's article, which is how the builder joins it to a location. */
  article: string
  name: string
  /** `[row, firstColumn, length]`. */
  runs: [number, number, number][]
  cells: number
}

export interface MapShapesExtract {
  cell: number
  size: [number, number]
  regions: RegionShape[]
}

/**
 * Everything opaque that is not the field.
 *
 * The void between tiles is fully transparent rather than black, which is what
 * makes this a two-line test instead of a colour-distance search.
 */
export function tileMask(png: PNG): Uint8Array {
  const mask = new Uint8Array(png.width * png.height)
  for (let i = 0; i < mask.length; i += 1) {
    const o = i * 4
    const a = png.data[o + 3] ?? 0
    if (a <= 200) continue
    if (isField(png.data[o] ?? 0, png.data[o + 1] ?? 0, png.data[o + 2] ?? 0)) continue
    mask[i] = 1
  }
  return mask
}

/**
 * The connected tile a marker stands on.
 *
 * Iterative rather than recursive: a region is a third of a million pixels and
 * a recursive fill blows the stack long before it finishes.
 */
export function claimRegion(
  mask: Uint8Array,
  claimed: Int32Array,
  width: number,
  height: number,
  startX: number,
  startY: number,
  id: number,
): number {
  const start = startY * width + startX
  if (mask[start] !== 1 || claimed[start] !== 0) return 0

  const stack = [start]
  let count = 0
  while (stack.length > 0) {
    const i = stack.pop() as number
    if (mask[i] !== 1 || claimed[i] !== 0) continue
    claimed[i] = id
    count += 1

    const x = i % width
    const y = (i - x) / width
    if (x > 0) stack.push(i - 1)
    if (x < width - 1) stack.push(i + 1)
    if (y > 0) stack.push(i - width)
    if (y < height - 1) stack.push(i + width)
  }
  return count
}

/**
 * Quantise one claimed region into run-length encoded cells.
 *
 * A cell joins the region when at least half of its samples do. Half rather
 * than any: the tiles nearly touch in places, and a permissive rule grows every
 * region by a cell in each direction until neighbours overlap.
 */
export function cellRuns(
  claimed: Int32Array,
  width: number,
  height: number,
  id: number,
  cell: number,
): [number, number, number][] {
  const cols = Math.ceil(width / cell)
  const rows = Math.ceil(height / cell)
  const step = Math.max(1, Math.floor(cell / 7))
  const runs: [number, number, number][] = []

  for (let r = 0; r < rows; r += 1) {
    let runStart = -1
    for (let c = 0; c <= cols; c += 1) {
      let hits = 0
      let seen = 0
      if (c < cols) {
        for (let dy = 2; dy < cell; dy += step) {
          for (let dx = 2; dx < cell; dx += step) {
            const x = c * cell + dx
            const y = r * cell + dy
            if (x >= width || y >= height) continue
            seen += 1
            if (claimed[y * width + x] === id) hits += 1
          }
        }
      }

      const solid = seen > 0 && hits / seen >= 0.5
      if (solid && runStart === -1) runStart = c
      if (!solid && runStart !== -1) {
        runs.push([r, runStart, c - runStart])
        runStart = -1
      }
    }
  }
  return runs
}

/** The map image, from the HTTP cache or the wiki. Never written to the repo. */
async function backgroundImage(background: string, wiki: WikiConfig): Promise<Buffer> {
  const key = createHash('sha256').update(background).digest('hex').slice(0, 16)
  const path = join(CACHE_DIR, `map-${key}.png`)
  try {
    return await readFile(path)
  } catch {
    // not cached
  }

  const api = wiki.endpoint.replace(/\/index\.php$/, '/api.php')
  const response = await fetchJson<{
    query?: { pages?: Record<string, { imageinfo?: { url: string }[] }> }
  }>(
    `${api}?action=query&format=json&prop=imageinfo&iiprop=url&titles=${encodeURIComponent(
      `File:${background}`,
    )}`,
    { throttleMs: wiki.throttleMs, useCache: false },
  )

  const url = Object.values(response.query?.pages ?? {})[0]?.imageinfo?.[0]?.url
  if (url === undefined) throw new Error(`the wiki has no file named "${background}"`)

  const body = await fetchBinary(url, { throttleMs: wiki.throttleMs })
  await mkdir(CACHE_DIR, { recursive: true })
  await writeFile(path, body)
  return body
}

interface WikiConfig {
  endpoint: string
  throttleMs: number
}

export async function enrichMapShapes(): Promise<MapShapesExtract> {
  const wiki = await readJsonFile<WikiConfig>(join(CURATED_DIR, 'vocab', 'wiki.json'))
  const vocab = await readJsonFile<{ background: string }>(join(CURATED_DIR, 'vocab', 'maps.json'))
  const maps = await readJsonFile<MapsExtract>(join(SOURCES_DIR, 'wiki', 'pages', 'maps.json'))

  const png = PNG.sync.read(await backgroundImage(vocab.background, wiki))
  if (png.width !== maps.size[0] || png.height !== maps.size[1]) {
    throw new Error(
      `${vocab.background} is ${png.width}x${png.height} but the markers live in a ` +
        `${maps.size[0]}x${maps.size[1]} space. Shapes measured from it would not line up.`,
    )
  }

  const mask = tileMask(png)
  const claimed = new Int32Array(png.width * png.height)
  const regions: RegionShape[] = []

  // Only the markers that name a region. A building's marker sits *inside* a
  // region tile, so filling from it would claim the whole region under the
  // building's name and leave the region itself with nothing.
  const seeds = maps.markers.filter((m) => m.group === 'Regions' && m.article !== null)

  for (const [index, marker] of seeds.entries()) {
    const pixels = claimRegion(
      mask,
      claimed,
      png.width,
      png.height,
      Math.round(marker.x),
      Math.round(marker.y),
      index + 1,
    )
    if (pixels === 0) {
      consola.warn(`map-shapes: "${marker.name}" is not standing on a tile`)
      continue
    }
    const runs = cellRuns(claimed, png.width, png.height, index + 1, CELL)
    regions.push({
      article: marker.article as string,
      name: marker.name,
      runs,
      cells: runs.reduce((n, [, , len]) => n + len, 0),
    })
  }

  const extract: MapShapesExtract = { cell: CELL, size: maps.size, regions }
  await writeJson(join(SOURCES_DIR, 'wiki', 'pages', 'map_shapes.json'), extract)
  return extract
}

async function main(): Promise<void> {
  const extract = await enrichMapShapes()
  for (const region of extract.regions) {
    consola.log(`  ${region.name.padEnd(22)} ${String(region.cells).padStart(4)} cells`)
  }
  consola.success(
    `map shapes: ${extract.regions.length} regions, ` +
      `${extract.regions.reduce((n, r) => n + r.cells, 0)} cells at ${extract.cell}px`,
  )
}

const entry = argv[1]
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  main().catch((err: unknown) => {
    consola.error(err instanceof Error ? err.message : err)
    process.exitCode = 1
  })
}
