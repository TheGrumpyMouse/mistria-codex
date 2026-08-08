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

/**
 * The largest PNG embedded in an ICO, or null.
 *
 * The wiki's own branding (`Site-favicon.ico`) is the only non-PNG file we
 * fetch, and modern ICOs are PNG containers: a 6-byte header, one 16-byte
 * directory entry per image, then the images themselves — often literal PNG
 * streams. This slices the biggest one out untouched; no decode, no re-encode,
 * so the stored bytes are exactly what the wiki hosts. An ICO whose entries are
 * all BMP-format returns null and is treated like any other non-PNG body.
 */
export function pngFromIco(buffer: Buffer): Buffer | null {
  // 2 reserved (0) + 2 type (1 = icon) + 2 count
  if (buffer.length < 6) return null
  if (buffer.readUInt16LE(0) !== 0 || buffer.readUInt16LE(2) !== 1) return null

  const count = buffer.readUInt16LE(4)
  let best: Buffer | null = null
  let bestArea = 0

  for (let i = 0; i < count; i += 1) {
    const dir = 6 + i * 16
    if (dir + 16 > buffer.length) return null
    // A directory byte of 0 means 256 — ICO's one quirk worth knowing.
    const width = buffer[dir] === 0 ? 256 : (buffer[dir] as number)
    const height = buffer[dir + 1] === 0 ? 256 : (buffer[dir + 1] as number)
    const bytes = buffer.readUInt32LE(dir + 8)
    const offset = buffer.readUInt32LE(dir + 12)
    if (offset + bytes > buffer.length) return null

    const image = buffer.subarray(offset, offset + bytes)
    if (pngSize(image) === null) continue
    if (width * height > bestArea) {
      bestArea = width * height
      best = Buffer.from(image)
    }
  }

  return best
}
