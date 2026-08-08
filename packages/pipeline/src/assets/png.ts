/**
 * Just enough PNG to know what we downloaded.
 *
 * The fetcher records each sprite's dimensions so the packer can lay out sheets
 * without decoding 1,133 images twice, and so a validate run can spot a file
 * that is not the image it claims to be. Reading the IHDR header is fifteen
 * lines; pulling in an image library for it would mean `assets:fetch` — the one
 * command that talks to the wiki — could fail on a native binary.
 */

/** The eight bytes every PNG starts with. */
const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

export interface PngSize {
  width: number
  height: number
}

/**
 * Width and height from a PNG's IHDR chunk, or null if this is not a PNG.
 *
 * Returning null rather than throwing is deliberate: the caller knows what it
 * asked for and can say "the wiki served HTML for X", which is a far more useful
 * error than "invalid signature at byte 0".
 */
export function pngSize(buffer: Buffer): PngSize | null {
  // 8 signature + 4 length + 4 "IHDR" + 8 dimensions
  if (buffer.length < 24) return null
  if (!buffer.subarray(0, 8).equals(SIGNATURE)) return null
  if (buffer.subarray(12, 16).toString('ascii') !== 'IHDR') return null

  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
}
