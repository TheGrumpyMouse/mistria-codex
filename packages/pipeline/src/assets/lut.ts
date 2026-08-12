/**
 * Palette-swap recolouring, the way the game itself does it.
 *
 * A variant animal or pet is not a second sprite — it is the base sprite drawn
 * through a palette strip: the variant's TOML states `lut` (a sprite like
 * `spr_animal_cow_lut`) and `lut_index`, and the strip is 256 rows tall with
 * **one column per palette**. Column 0 is the key: the exact colours the base
 * art was drawn in. To recolour, each opaque pixel's colour is found in column
 * 0 and replaced with the colour at the same row in column `lut_index`.
 *
 * That layout is *proven*, not assumed, three ways:
 *
 *  - **Coverage.** Every opaque colour of every base icon we recolour must
 *    exist in column 0, or this module throws. The transposed reading (rows as
 *    palettes) fails this instantly — 104 of the cow icon's 147 pixels went
 *    unmapped when it was tried — so a format change cannot slip through as
 *    garbage art.
 *  - **Identity.** The chicken's `white` variant states `lut_index = 1`, and
 *    the drawn base icon *is* the white chicken: mapping column 0 → column 1
 *    changes 2 of its 133 opaque pixels (anti-aliasing rows). `verifyLut`
 *    encodes that as a hard assertion, which pins the column indexing — an
 *    off-by-one would swap in the brown hen and fail loudly.
 *  - **Bounds.** The duck states indexes up to 24 and its strip is 26 columns
 *    wide; an index outside the strip throws rather than reading whatever
 *    bytes sit past the edge.
 *
 * Some drawn palettes match no variant at all — the cat icon is a neutral
 * template and even the Tabby (`lut_index = 1`) repaints 57% of it — which is
 * exactly why the identity assertion lives on the chicken, where the files
 * state it, and not on a per-family heuristic.
 */
import { PNG } from 'pngjs'

interface Decoded {
  width: number
  height: number
  data: Buffer
}

const decode = (buffer: Buffer): Decoded => PNG.sync.read(buffer)

const colorKey = (data: Buffer, i: number): string => `${data[i]},${data[i + 1]},${data[i + 2]}`

/** Column 0 of the strip: colour -> row. First occurrence wins, like the game. */
function keyColumn(lut: Decoded): Map<string, number> {
  const key = new Map<string, number>()
  for (let row = 0; row < lut.height; row += 1) {
    const i = row * lut.width * 4
    if (lut.data[i + 3] === 0) continue
    const color = colorKey(lut.data, i)
    if (!key.has(color)) key.set(color, row)
  }
  return key
}

export interface RecolorResult {
  png: Buffer
  /** Opaque pixels whose colour the palette actually changed. */
  changed: number
  /** Opaque pixels in the base. */
  opaque: number
}

/**
 * The base sprite through palette `index` of the strip. Throws when the strip
 * cannot honestly produce it — an out-of-range index, or a base colour the key
 * column does not hold.
 */
export function recolorPng(
  base: Buffer,
  lutBuffer: Buffer,
  index: number,
  label: string,
): RecolorResult {
  const image = decode(base)
  const lut = decode(lutBuffer)

  if (!Number.isInteger(index) || index < 1 || index >= lut.width) {
    throw new Error(
      `lut: ${label} wants palette ${index} of a ${lut.width}-column strip — ` +
        'the index is outside the file, so the format has changed or the read is wrong.',
    )
  }

  const key = keyColumn(lut)
  const out = Buffer.from(image.data)
  let changed = 0
  let opaque = 0

  for (let i = 0; i < out.length; i += 4) {
    if (out[i + 3] === 0) continue
    opaque += 1
    const row = key.get(colorKey(out, i))
    if (row === undefined) {
      // A colour the key column does not hold means this sprite was not drawn
      // in this palette — recolouring it would produce a half-repainted mess
      // that looks like art. Refuse instead.
      throw new Error(
        `lut: ${label} has colour rgb(${colorKey(out, i)}) that the key column does not hold. ` +
          'The base sprite and the palette strip do not belong together.',
      )
    }
    const j = (row * lut.width + index) * 4
    const [r, g, b] = [lut.data[j] ?? 0, lut.data[j + 1] ?? 0, lut.data[j + 2] ?? 0]
    if (out[i] !== r || out[i + 1] !== g || out[i + 2] !== b) {
      out[i] = r
      out[i + 1] = g
      out[i + 2] = b
      changed += 1
    }
  }

  const png = new PNG({ width: image.width, height: image.height })
  out.copy(png.data)
  return { png: PNG.sync.write(png), changed, opaque }
}

/**
 * The identity assertion: recolouring `base` with `index` must leave it
 * (nearly) unchanged. Run once per invocation on the pair the game itself
 * states is an identity — the white chicken — before any recolour is trusted.
 */
export function verifyLutIdentity(
  base: Buffer,
  lutBuffer: Buffer,
  index: number,
  label: string,
): void {
  const { changed, opaque } = recolorPng(base, lutBuffer, index, label)
  if (opaque === 0 || changed / opaque > 0.05) {
    throw new Error(
      `lut: the identity check failed — recolouring ${label} with its own stated palette ` +
        `changed ${changed} of ${opaque} pixels. The strip layout has been misread; ` +
        'no recoloured variant art can be trusted, so none was written.',
    )
  }
}
