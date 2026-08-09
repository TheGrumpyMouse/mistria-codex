import { PNG } from 'pngjs'

/**
 * Cut a rectangle out of a PNG.
 *
 * The game ships animations as horizontal strips — `spr_fish_silhouette_giant_0_swim.png`
 * is 388×97, which its `.meta.toml` declares as `frame_size = [97, 97]`,
 * `frame_len = 4`. Copied whole and handed to a 36-pixel icon box, that renders
 * as four fish smeared across 35 pixels, which is not obviously wrong until you
 * know the file is a strip. Taking the frame here rather than windowing it in
 * CSS keeps the atlas honest: a sprite in the manifest is a picture, not a reel,
 * and nothing downstream needs to know the difference.
 *
 * Cropping to a **fixed** rectangle across a set of sprites also preserves what
 * makes them comparable. The four fish silhouettes are drawn at their true
 * relative sizes inside one shared canvas — 12×5 pixels up to 31×16 — so the
 * same window over each is a size chart. Trimming each to its own content
 * instead would scale them all to the same box and destroy the only fact the
 * picture carries.
 *
 * Throws rather than clamping: a rectangle reaching outside the source means
 * the sprite is not the shape the caller believes it is, and silently returning
 * a smaller image would ship that misunderstanding as art.
 */
export interface CropRect {
  x: number
  y: number
  width: number
  height: number
}

export function cropPng(source: Buffer, rect: CropRect): Buffer {
  const png = PNG.sync.read(source)

  if (
    rect.x < 0 ||
    rect.y < 0 ||
    rect.width <= 0 ||
    rect.height <= 0 ||
    rect.x + rect.width > png.width ||
    rect.y + rect.height > png.height
  ) {
    throw new Error(
      `crop ${rect.width}×${rect.height} at ${rect.x},${rect.y} does not fit a ` +
        `${png.width}×${png.height} image`,
    )
  }

  const out = new PNG({ width: rect.width, height: rect.height })
  PNG.bitblt(png, out, rect.x, rect.y, rect.width, rect.height, 0, 0)
  return PNG.sync.write(out)
}
