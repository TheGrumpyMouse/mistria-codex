/**
 * Where a sprite lives in an atlas.
 *
 * The app asks for an `icon_key` — `item/ore_copper`, `villager/adeline` — and
 * gets back a sheet and a rectangle, or nothing. **Nothing is a normal answer.**
 * Roughly thirty records have no sprite on the wiki, and every record added
 * before its art exists will have none either, so the caller falls back to the
 * drawn glyph rather than treating it as an error.
 *
 * The art itself is NPC Studio's, served from our own origin under attribution.
 * See docs/DATA-POLICY.md.
 */

/** `[x, y, width, height]` in the sheet, in real pixels. */
export type Placement = [number, number, number, number]

export interface Sheet {
  file: string
  width: number
  height: number
  frames: Record<string, Placement>
}

export interface AtlasIndex {
  sheets: Sheet[]
  /** `icon_key` -> a whole file, for portraits. */
  portraits: Record<string, string>
  /**
   * `icon_key` -> a whole file, for map and brand art. Optional because a
   * bundle packed before these families existed simply has none — and none is
   * a normal answer, exactly like a missing sprite.
   */
  maps?: Record<string, string>
}

export interface Sprite {
  /** Absolute URL of the sheet, already base-path-corrected. */
  url: string
  x: number
  y: number
  width: number
  height: number
  sheetWidth: number
  sheetHeight: number
}

/**
 * Resolution is a plain lookup table built once.
 *
 * Searching every sheet's frames on each render would be a map lookup per sheet
 * per icon, and a virtualised list paints hundreds of icons a frame. Flattening
 * at load makes it one.
 */
export class Atlas {
  private readonly frames = new Map<string, Sprite>()
  private readonly portraits = new Map<string, string>()
  private readonly maps = new Map<string, string>()

  constructor(index: AtlasIndex, baseUrl: string) {
    for (const sheet of index.sheets) {
      const url = `${baseUrl}assets/game/${sheet.file}`
      for (const [key, [x, y, width, height]] of Object.entries(sheet.frames)) {
        this.frames.set(key, {
          url,
          x,
          y,
          width,
          height,
          sheetWidth: sheet.width,
          sheetHeight: sheet.height,
        })
      }
    }
    for (const [key, file] of Object.entries(index.portraits)) {
      this.portraits.set(key, `${baseUrl}assets/game/${file}`)
    }
    for (const [key, file] of Object.entries(index.maps ?? {})) {
      this.maps.set(key, `${baseUrl}assets/game/${file}`)
    }
  }

  get(iconKey: string | null | undefined): Sprite | null {
    return iconKey == null ? null : (this.frames.get(iconKey) ?? null)
  }

  /** `character/adeline` -> the portrait URL, if that villager has one. */
  portrait(iconKey: string | null | undefined): string | null {
    if (iconKey == null) return null
    return this.portraits.get(iconKey.replace(/^character\//, 'portrait/')) ?? null
  }

  /**
   * `map/valley` or `brand/logo` -> a whole-file URL, or null.
   *
   * Null is the permanent no-art answer — a clone that never ran
   * `pnpm assets:fetch` draws the tessera mosaic instead, and must keep doing
   * so forever. Never branch on "atlas not loaded"; ask, and handle null.
   */
  mapUrl(key: string | null | undefined): string | null {
    return key == null ? null : (this.maps.get(key) ?? null)
  }

  get size(): number {
    return this.frames.size
  }
}

/** An atlas with nothing in it — the state before the index loads, and after it fails. */
export const EMPTY_ATLAS = new Atlas({ sheets: [], portraits: {} }, '')

/**
 * Scale a sprite to a box without ever landing between pixels.
 *
 * Pixel art at 1.5x is mush: some source pixels become two screen pixels and
 * their neighbours one, so the sprite renders visibly lopsided. The factor is
 * therefore always a whole number or the reciprocal of one — 2x, 1x, 1/2, 1/3.
 *
 * **Both directions matter here.** The wiki's item sprites are 72x72, which is
 * three times the 24-pixel box a list row gives them, so downscaling is the
 * common case and not the exception. An earlier version clamped at 1 and a
 * 72-pixel sprite blew out of a 24-pixel row.
 */
export function integerScale(spriteSize: number, boxSize: number): number {
  if (boxSize >= spriteSize) return Math.floor(boxSize / spriteSize)
  return 1 / Math.ceil(spriteSize / boxSize)
}

/**
 * Nearest-neighbour going up, smooth coming down.
 *
 * `pixelated` is what keeps an enlarged sprite crisp instead of blurry, and it
 * is the whole reason pixel art needs special handling at all. Coming *down* it
 * is the wrong tool: nearest-neighbour throws away eight of every nine pixels
 * and the survivors alias into speckle. Measured across the real files, about
 * half are 4x upscales of an 18-pixel original and half are native 72x72
 * artwork, so no single downscale factor is lossless for all of them — which
 * makes a smooth reduction the honest choice rather than a lazy one.
 */
export function renderingFor(scale: number): 'pixelated' | 'auto' {
  return scale >= 1 ? 'pixelated' : 'auto'
}

/**
 * The CSS that paints one frame of a sheet.
 *
 * `background-position` is negative because it moves the sheet under the window,
 * not the window over the sheet — and every value is multiplied by the scale,
 * because the browser scales the whole background image, not just the frame.
 */
export function spriteStyle(sprite: Sprite, scale: number): React.CSSProperties {
  return {
    width: sprite.width * scale,
    height: sprite.height * scale,
    backgroundImage: `url(${sprite.url})`,
    backgroundPosition: `${-sprite.x * scale}px ${-sprite.y * scale}px`,
    backgroundSize: `${sprite.sheetWidth * scale}px ${sprite.sheetHeight * scale}px`,
    backgroundRepeat: 'no-repeat',
    imageRendering: renderingFor(scale),
  }
}
