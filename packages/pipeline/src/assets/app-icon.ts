/**
 * The installable app's face: the official logo art, set on our own card.
 *
 * The composition is deliberate. NPC Studio's logo as-is would make an
 * installed icon indistinguishable from an official app, and this project's
 * policy is to never imply affiliation — so the logo sits framed on the app's
 * paper ground with the four-tessera mark in the corner, which is this app's
 * own signature. Recognisably the game; visibly a companion.
 *
 * Generated at ship time into the gitignored assets output, exactly like the
 * atlases: `git rm -r assets/game && pnpm build:ship` removes the logo and the
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

const ICON_SIZES = [192, 512] as const

/**
 * Box-sample a source image into a destination rectangle.
 *
 * Averaging every covered source pixel, not nearest-neighbour: the logo is
 * painted art coming *down* from 1920 wide, and nearest would alias its
 * lettering into speckle. Alpha-weighted so transparent edges stay clean.
 */
function drawScaled(src: PNG, dst: PNG, dx: number, dy: number, dw: number, dh: number): void {
  for (let y = 0; y < dh; y++) {
    const sy0 = (y / dh) * src.height
    const sy1 = ((y + 1) / dh) * src.height
    for (let x = 0; x < dw; x++) {
      const sx0 = (x / dw) * src.width
      const sx1 = ((x + 1) / dw) * src.width

      let r = 0
      let g = 0
      let b = 0
      let a = 0
      let n = 0
      for (let sy = Math.floor(sy0); sy < Math.ceil(sy1); sy++) {
        for (let sx = Math.floor(sx0); sx < Math.ceil(sx1); sx++) {
          const i = (sy * src.width + sx) * 4
          const alpha = src.data[i + 3] ?? 0
          r += (src.data[i] ?? 0) * alpha
          g += (src.data[i + 1] ?? 0) * alpha
          b += (src.data[i + 2] ?? 0) * alpha
          a += alpha
          n += 1
        }
      }
      if (n === 0) continue

      const outA = a / n
      const j = ((dy + y) * dst.width + (dx + x)) * 4
      if (outA === 0) continue
      // Composite over whatever is already on the canvas.
      const baseA = dst.data[j + 3] ?? 255
      const srcR = r / a
      const srcG = g / a
      const srcB = b / a
      const t = outA / 255
      dst.data[j] = Math.round(srcR * t + (dst.data[j] ?? 0) * (1 - t))
      dst.data[j + 1] = Math.round(srcG * t + (dst.data[j + 1] ?? 0) * (1 - t))
      dst.data[j + 2] = Math.round(srcB * t + (dst.data[j + 2] ?? 0) * (1 - t))
      dst.data[j + 3] = Math.max(baseA, Math.round(outA))
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
 * Write the PWA icons, or quietly do nothing when the logo was never fetched.
 *
 * Quiet is correct: a clone without `assets/game/` builds a fully working app
 * whose manifest icons 404 and whose favicon falls back to the committed SVG.
 * Installability degrades; rendering never does.
 */
export async function writeAppIcons(): Promise<number> {
  const manifest = await readManifestOrEmpty()
  const logoEntry = manifest.assets.find((a) => a.family === 'brand')
  if (logoEntry === undefined) return 0

  const logo = PNG.sync.read(await readFile(join(ASSETS_DIR, logoEntry.file)))

  const { mkdir } = await import('node:fs/promises')
  await mkdir(join(ASSETS_SHIP_DIR, 'brand'), { recursive: true })

  for (const size of ICON_SIZES) {
    const canvas = new PNG({ width: size, height: size })

    // Paper card with a rule-coloured border — the app's own ground.
    fillRect(canvas, 0, 0, size, size, RULE)
    const border = Math.max(2, Math.round(size * 0.02))
    fillRect(canvas, border, border, size - border * 2, size - border * 2, PAPER)

    // The logo, centred, on 76% of the width — inside the ~80% safe zone a
    // maskable launcher may crop to a circle, with margin for the wide banner.
    const artWidth = Math.round(size * 0.76)
    const artHeight = Math.round((artWidth / logo.width) * logo.height)
    drawScaled(
      logo,
      canvas,
      Math.round((size - artWidth) / 2),
      Math.round((size - artHeight) / 2),
      artWidth,
      artHeight,
    )

    // The four-tessera mark, bottom corner — the same 2x2 the wordmark wears.
    const tile = Math.max(4, Math.round(size * 0.045))
    const gap = Math.max(1, Math.round(tile * 0.2))
    const baseX = size - border * 2 - tile * 2 - gap * 2
    const baseY = size - border * 2 - tile * 2 - gap * 2
    SEASONS.forEach((season, i) => {
      const col = i % 2
      const row = Math.floor(i / 2)
      fillRect(canvas, baseX + col * (tile + gap), baseY + row * (tile + gap), tile, tile, season)
    })

    await writeFile(
      join(ASSETS_SHIP_DIR, 'brand', `app-icon-${size}.png`),
      PNG.sync.write(canvas, { deflateLevel: 9, colorType: 6 }),
    )
  }

  return ICON_SIZES.length
}
