/**
 * Pack the sprites into atlases.
 *
 * 1,100 individual `<img>` requests is not a delivery strategy — it is 1,100
 * precache entries the service worker has to hold, and Workbox's
 * `precacheAndRoute` fails the *entire* install if one of them 404s. Packed into
 * a handful of sheets it becomes a handful of entries, and the offline promise
 * stops depending on a thousand things going right.
 *
 * `pngjs` rather than an image library with native bindings, for two reasons.
 * The pack is a **pixel copy, not a resize** — pixel art must never be resampled
 * — so there is no image processing to do beyond moving bytes into a bigger
 * buffer, and pure JS is fast enough at that scale. And output stays identical
 * across machines, where a native encoder's bytes depend on which version of
 * libvips the platform shipped.
 *
 * Output goes to `apps/web/public/assets/game/`, which is **gitignored build
 * output** — the same tier as the shipped data bundle. The committed copy under
 * `assets/game/` remains the only source of truth, so a takedown is still one
 * deletion.
 */
import { createHash } from 'node:crypto'
import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { argv } from 'node:process'
import { pathToFileURL } from 'node:url'
import { consola } from 'consola'
import { PNG } from 'pngjs'
import { ASSETS_DIR, ASSETS_SHIP_DIR } from '../lib/paths.js'
import { writeJson } from '../lib/write-json.js'
import { type AssetEntry, type AssetFamily, ATLAS_FAMILIES, readManifest } from './manifest.js'

/**
 * A sheet never exceeds this on either axis.
 *
 * 2048 is the smallest maximum texture size still found on low-end mobile GPUs.
 * A single sheet wider than that is not a slow image, it is a blank one.
 *
 * 2040 rather than 2048 because dimensions are rounded up to a multiple of
 * twelve — see `pad` — and rounding 2048 up would put the sheet back over the
 * limit the number exists to respect.
 */
const MAX_SHEET = 2040

/**
 * One transparent pixel between neighbours.
 *
 * At a fractional zoom or on a fractional device-pixel-ratio, the sampler reads
 * just past a sprite's edge. Without a gutter that is the neighbouring sprite,
 * and every icon in the app grows a one-pixel fringe of an unrelated one.
 */
const GUTTER = 1

/**
 * Sheet dimensions are rounded up to a multiple of twelve.
 *
 * The browser scales the whole sheet, not the one frame it is showing, so a
 * sprite drawn at a third of its size sets `background-size` to a third of the
 * sheet. If that lands on a fraction of a pixel the sampler drifts and the
 * frame shows a sliver of its neighbour. Twelve is divisible by every reduction
 * the app uses — a half, a third, a quarter — so it never can.
 */
const pad = (value: number): number => Math.ceil(value / 12) * 12

/** Where one sprite sits in its sheet. */
export type Placement = [x: number, y: number, width: number, height: number]

export interface Sheet {
  file: string
  width: number
  height: number
  /** `icon_key` -> placement. The app never sees an asset key or a filename. */
  frames: Record<string, Placement>
}

interface Placed {
  entry: AssetEntry
  x: number
  y: number
}

/**
 * Shelf packing, by descending height.
 *
 * Not the tightest algorithm available, and deliberately so: sprites here are
 * near-uniform 16 to 48 pixels, where shelves waste almost nothing, and the
 * result is trivially deterministic. A better packer would buy a few kilobytes
 * of transparent space and cost a class of bug that only shows up as a sprite
 * rendering half of its neighbour.
 */
export function packShelves(
  entries: AssetEntry[],
  max = MAX_SHEET,
): { placed: Placed[]; width: number; height: number }[] {
  const ordered = [...entries].sort(
    (a, b) => b.height - a.height || a.key.localeCompare(b.key), // height, then stable
  )

  const sheets: { placed: Placed[]; width: number; height: number }[] = []
  let placed: Placed[] = []
  let shelfY = 0
  let shelfHeight = 0
  let x = 0
  let widest = 0

  const closeSheet = (): void => {
    if (placed.length === 0) return
    sheets.push({ placed, width: pad(widest), height: pad(shelfY + shelfHeight) })
    placed = []
    shelfY = 0
    shelfHeight = 0
    x = 0
    widest = 0
  }

  for (const entry of ordered) {
    const width = entry.width + GUTTER
    const height = entry.height + GUTTER

    if (x + width > max) {
      // Next shelf.
      shelfY += shelfHeight
      shelfHeight = 0
      x = 0
    }
    if (shelfY + height > max) {
      closeSheet()
    }

    placed.push({ entry, x, y: shelfY })
    x += width
    widest = Math.max(widest, x)
    shelfHeight = Math.max(shelfHeight, height)
  }

  closeSheet()
  return sheets
}

/**
 * Copy one decoded sprite into the sheet, pixel for pixel.
 *
 * `PNG.bitblt` would do this, but it throws on a source whose bit depth or
 * colour type differs from the destination's, and the wiki's files are a mix of
 * palette, greyscale and truecolour. Decoding to RGBA first and copying rows by
 * hand is both shorter and immune to that.
 */
function blit(source: PNG, target: PNG, atX: number, atY: number): void {
  for (let row = 0; row < source.height; row += 1) {
    const from = row * source.width * 4
    const to = ((atY + row) * target.width + atX) * 4
    source.data.copy(target.data, to, from, from + source.width * 4)
  }
}

async function packFamily(family: AssetFamily, entries: AssetEntry[]): Promise<Sheet[]> {
  const sheets: Sheet[] = []

  for (const [index, layout] of packShelves(entries).entries()) {
    const canvas = new PNG({ width: layout.width, height: layout.height, colorType: 6 })
    // A fresh PNG buffer is not guaranteed zeroed, and stale bytes read as
    // opaque noise in the gutters rather than as transparency.
    canvas.data.fill(0)

    const frames: Record<string, Placement> = {}
    for (const { entry, x, y } of layout.placed) {
      const sprite = PNG.sync.read(await readFile(join(ASSETS_DIR, entry.file)))
      blit(sprite, canvas, x, y)
      // Every record that wants this sprite points at the same rectangle. Two
      // items sharing an icon share one copy in the sheet, not two.
      for (const iconKey of entry.icon_keys) {
        frames[iconKey] = [x, y, entry.width, entry.height]
      }
    }

    // The content hash goes in the filename, which is the only cache control
    // GitHub Pages leaves us: Pages sends fixed headers, so a sheet that could
    // change at a stable URL would be served from a stale browser cache forever.
    // A changed sheet is a new name; only `atlas.json` ever needs revalidating.
    const png = PNG.sync.write(canvas, { deflateLevel: 9, colorType: 6 })
    const digest = createHash('sha256').update(png).digest('hex').slice(0, 10)
    const suffix = index === 0 ? '' : `-${index + 1}`
    const file = `atlas-${family}${suffix}.${digest}.png`

    const { writeFile, mkdir } = await import('node:fs/promises')
    await mkdir(ASSETS_SHIP_DIR, { recursive: true })
    await writeFile(join(ASSETS_SHIP_DIR, file), png)

    sheets.push({ file, width: layout.width, height: layout.height, frames })
  }

  return sheets
}

export interface PackResult {
  /** The atlas index the app loads: one entry per sheet. */
  sheets: Sheet[]
  /** Portraits, shipped whole. `icon_key` -> filename. */
  portraits: Record<string, string>
  /** Maps and brand art, shipped whole and content-addressed. `icon_key` -> path. */
  maps: Record<string, string>
  bytes: number
}

export async function packAssets(): Promise<PackResult> {
  const manifest = await readManifest()
  await rm(ASSETS_SHIP_DIR, { recursive: true, force: true })

  const sheets: Sheet[] = []
  for (const family of ATLAS_FAMILIES) {
    const entries = manifest.assets.filter((a) => a.family === family)
    if (entries.length === 0) continue
    sheets.push(...(await packFamily(family, entries)))
  }

  // Portraits are shipped as they are. They are large, looked at one at a time,
  // and packing them would mean downloading thirty faces to show one.
  const { copyFile, mkdir, readFile: read } = await import('node:fs/promises')
  const portraits: Record<string, string> = {}
  for (const entry of manifest.assets.filter((a) => a.family === 'portrait')) {
    const file = entry.file.replace(/^portrait\//, '')
    await mkdir(join(ASSETS_SHIP_DIR, 'portrait'), { recursive: true })
    await copyFile(join(ASSETS_DIR, entry.file), join(ASSETS_SHIP_DIR, 'portrait', file))
    for (const iconKey of entry.icon_keys) portraits[iconKey] = `portrait/${file}`
  }

  // Maps and brand art ship whole too, but **content-addressed**: Pages sends
  // fixed cache headers, so the filename carrying the hash is what lets the
  // service worker cache a 200KB map forever without ever serving a stale one.
  const maps: Record<string, string> = {}
  for (const entry of manifest.assets.filter((a) => a.family === 'map' || a.family === 'brand')) {
    const bytes = await read(join(ASSETS_DIR, entry.file))
    const digest = createHash('sha256').update(bytes).digest('hex').slice(0, 10)
    const stem =
      entry.file
        .split('/')
        .pop()
        ?.replace(/\.png$/, '') ?? entry.key
    const file = `${entry.family}/${stem}.${digest}.png`
    await mkdir(join(ASSETS_SHIP_DIR, entry.family), { recursive: true })
    await copyFile(join(ASSETS_DIR, entry.file), join(ASSETS_SHIP_DIR, file))
    for (const iconKey of entry.icon_keys) maps[iconKey] = file
  }

  await writeJson(
    join(ASSETS_SHIP_DIR, 'atlas.json'),
    { sheets, portraits, maps },
    { pretty: false },
  )

  const { stat } = await import('node:fs/promises')
  let bytes = 0
  for (const sheet of sheets) bytes += (await stat(join(ASSETS_SHIP_DIR, sheet.file))).size

  return { sheets, portraits, maps, bytes }
}

/**
 * One version covering the whole packed set.
 *
 * The sheets are already content-addressed by filename; this exists so the
 * service worker at A3 has a single value to compare, the same way `dataVersion`
 * works for the data bundle.
 */
export function atlasVersion(result: PackResult): string {
  const hash = createHash('sha256')
  for (const sheet of [...result.sheets].sort((a, b) => a.file.localeCompare(b.file))) {
    hash.update(sheet.file)
  }
  for (const key of Object.keys(result.portraits).sort()) {
    hash.update(`${key}:${result.portraits[key]}`)
  }
  // Without this, swapping the map art would not bump the asset version and
  // the service worker would happily keep the old picture forever.
  for (const key of Object.keys(result.maps).sort()) {
    hash.update(`${key}:${result.maps[key]}`)
  }
  return hash.digest('hex').slice(0, 10)
}

async function main(): Promise<void> {
  const result = await packAssets()
  const frames = result.sheets.reduce((n, s) => n + Object.keys(s.frames).length, 0)

  for (const sheet of result.sheets) {
    consola.info(
      `${sheet.file}: ${sheet.width}x${sheet.height}, ${Object.keys(sheet.frames).length} frames`,
    )
  }
  consola.success(
    `packed ${frames} frames into ${result.sheets.length} sheets ` +
      `(${(result.bytes / 1024).toFixed(0)} KB) + ${Object.keys(result.portraits).length} portraits`,
  )
}

const entry = argv[1]
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  main().catch((err: unknown) => {
    consola.error(err instanceof Error ? err.message : err)
    process.exitCode = 1
  })
}
