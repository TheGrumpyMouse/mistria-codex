/**
 * The installable app's face: the game's little farmhouse, set on our own card.
 *
 * The composition is deliberate. The bare house mark is what Steam and the wiki
 * use, so shipping it as-is would make an installed icon indistinguishable from
 * an official app — and this project's policy is to never imply affiliation.
 * The house sits framed on the app's paper ground with the four-tessera mark in
 * the corner, which is this app's own signature. Recognisably the game; visibly
 * a companion.
 *
 * The source is 16x16 pixel art (shipped by the wiki at 256px). It is averaged
 * back down to its true grid and re-upscaled by a whole number, because pixel
 * art at a fractional scale renders visibly lopsided — the same integer-scale
 * rule the app's `.sprite` class enforces.
 *
 * Generated at ship time into the gitignored assets output, exactly like the
 * atlases: `git rm -r assets/game && pnpm build:ship` removes the house and the
 * icons with it, and the app falls back to the committed `favicon.svg` (our
 * mark, no game art). Nothing here is committed.
 *
 * Colours are the app's own tokens, copied by value — this file runs in Node,
 * not in a stylesheet, and the numbers are ours (tokens.css), not the game's.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { PNG } from 'pngjs'
import { ASSETS_DIR, ASSETS_SHIP_DIR } from '../lib/paths.js'
import { readManifestOrEmpty } from './manifest.js'

/** tokens.css, by value: paper ground, rule border, the four seasons. */
const PAPER = { r: 0xfb, g: 0xf8, b: 0xf3 }
const RULE = { r: 0xe8, g: 0xe2, b: 0xda }
const SEASONS = [
  { r: 0x7f, g: 0xbf, b: 0x8a }, // spring
  { r: 0x4f, g: 0xa8, b: 0xc9 }, // summer
  { r: 0xd4, g: 0x83, b: 0x4a }, // fall
  { r: 0x8b, g: 0x93, b: 0xc9 }, // winter
]

/** The true pixel grid of the house art. */
const GRID = 16

/**
 * 192/512 are what the PWA manifest wants; 64 is the browser-tab favicon,
 * small enough that it drops the tessera mark (unreadable at tab size) and
 * keeps only the paper frame to stay visibly ours.
 */
const ICON_SIZES = [64, 192, 512] as const

interface Cell {
  r: number
  g: number
  b: number
  a: number
}

/**
 * Average the source down to its true GRIDxGRID pixel grid.
 *
 * For the 256px wiki render this is exact — every 16x16 block is one uniform
 * art pixel — and for anything else it is an honest box filter. Alpha-weighted
 * so transparent surroundings stay transparent.
 */
function toGrid(src: PNG): Cell[] {
  const cells: Cell[] = []
  for (let gy = 0; gy < GRID; gy++) {
    for (let gx = 0; gx < GRID; gx++) {
      const x0 = Math.floor((gx / GRID) * src.width)
      const x1 = Math.max(x0 + 1, Math.floor(((gx + 1) / GRID) * src.width))
      const y0 = Math.floor((gy / GRID) * src.height)
      const y1 = Math.max(y0 + 1, Math.floor(((gy + 1) / GRID) * src.height))

      let r = 0
      let g = 0
      let b = 0
      let a = 0
      let n = 0
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * src.width + x) * 4
          const alpha = src.data[i + 3] ?? 0
          r += (src.data[i] ?? 0) * alpha
          g += (src.data[i + 1] ?? 0) * alpha
          b += (src.data[i + 2] ?? 0) * alpha
          a += alpha
          n += 1
        }
      }
      cells.push(a === 0 ? { r: 0, g: 0, b: 0, a: 0 } : { r: r / a, g: g / a, b: b / a, a: a / n })
    }
  }
  return cells
}

/** Nearest-neighbour: each art pixel becomes a k-by-k block, alpha-composited. */
function drawGrid(cells: Cell[], dst: PNG, dx: number, dy: number, k: number): void {
  for (let gy = 0; gy < GRID; gy++) {
    for (let gx = 0; gx < GRID; gx++) {
      const cell = cells[gy * GRID + gx]
      if (cell === undefined || cell.a === 0) continue
      const t = cell.a / 255
      for (let y = 0; y < k; y++) {
        for (let x = 0; x < k; x++) {
          const j = ((dy + gy * k + y) * dst.width + (dx + gx * k + x)) * 4
          dst.data[j] = Math.round(cell.r * t + (dst.data[j] ?? 0) * (1 - t))
          dst.data[j + 1] = Math.round(cell.g * t + (dst.data[j + 1] ?? 0) * (1 - t))
          dst.data[j + 2] = Math.round(cell.b * t + (dst.data[j + 2] ?? 0) * (1 - t))
          dst.data[j + 3] = Math.max(dst.data[j + 3] ?? 0, Math.round(cell.a))
        }
      }
    }
  }
}

function fillRect(
  png: PNG,
  x: number,
  y: number,
  w: number,
  h: number,
  c: { r: number; g: number; b: number },
): void {
  for (let yy = y; yy < y + h; yy++) {
    for (let xx = x; xx < x + w; xx++) {
      const i = (yy * png.width + xx) * 4
      png.data[i] = c.r
      png.data[i + 1] = c.g
      png.data[i + 2] = c.b
      png.data[i + 3] = 255
    }
  }
}

/**
 * Write the app icons, or quietly do nothing when the house was never fetched.
 *
 * Quiet is correct: a clone without `assets/game/` builds a fully working app
 * whose manifest icons 404 and whose favicon falls back to the committed SVG.
 * Installability degrades; rendering never does.
 */
export async function writeAppIcons(): Promise<number> {
  const manifest = await readManifestOrEmpty()
  const brandEntry = manifest.assets.find((a) => a.icon_keys.includes('brand/icon'))
  if (brandEntry === undefined) return 0

  const cells = toGrid(PNG.sync.read(await readFile(join(ASSETS_DIR, brandEntry.file))))

  const { mkdir } = await import('node:fs/promises')
  await mkdir(join(ASSETS_SHIP_DIR, 'brand'), { recursive: true })

  for (const size of ICON_SIZES) {
    const canvas = new PNG({ width: size, height: size })

    // Paper card with a rule-coloured border — the app's own ground.
    fillRect(canvas, 0, 0, size, size, RULE)
    const border = Math.max(2, Math.round(size * 0.02))
    fillRect(canvas, border, border, size - border * 2, size - border * 2, PAPER)

    // The house at the largest whole-number scale that stays inside ~70% of
    // the canvas: within the ~80% circle a maskable launcher may crop to, and
    // clear of the tessera mark in the corner. The favicon size has no mark to
    // dodge, so it gets the full safe zone.
    const zone = size === 64 ? 0.8 : 0.7
    const k = Math.max(1, Math.floor((size * zone) / GRID))
    const art = GRID * k
    drawGrid(cells, canvas, Math.round((size - art) / 2), Math.round((size - art) / 2), k)

    // The four-tessera mark, bottom corner — the same 2x2 the wordmark wears.
    // Not at favicon size: four 3px squares in a 16px tab render as noise.
    if (size !== 64) {
      const tile = Math.max(4, Math.round(size * 0.045))
      const gap = Math.max(1, Math.round(tile * 0.2))
      const baseX = size - border * 2 - tile * 2 - gap * 2
      const baseY = size - border * 2 - tile * 2 - gap * 2
      SEASONS.forEach((season, i) => {
        const col = i % 2
        const row = Math.floor(i / 2)
        fillRect(canvas, baseX + col * (tile + gap), baseY + row * (tile + gap), tile, tile, season)
      })
    }

    await writeFile(
      join(ASSETS_SHIP_DIR, 'brand', `app-icon-${size}.png`),
      PNG.sync.write(canvas, { deflateLevel: 9, colorType: 6 }),
    )
  }

  return ICON_SIZES.length
}
