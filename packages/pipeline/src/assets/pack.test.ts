import { describe, expect, it } from 'vitest'
import type { AssetEntry } from './manifest.js'
import { packShelves } from './pack.js'
import { pngSize } from './png.js'

const sprite = (key: string, width: number, height = width): AssetEntry => ({
  key,
  family: 'item',
  file: `item/${key}.png`,
  source_file: `${key}.png`,
  source_url: '',
  fetched_at: '2026-08-07',
  sha256: '',
  bytes: 0,
  width,
  height,
  icon_keys: [`item/${key}`],
})

describe('packShelves', () => {
  it('places every sprite exactly once', () => {
    const entries = Array.from({ length: 200 }, (_, i) => sprite(`s${i}`, 16))
    const placed = packShelves(entries).flatMap((s) => s.placed)
    expect(placed).toHaveLength(200)
    expect(new Set(placed.map((p) => p.entry.key)).size).toBe(200)
  })

  it('never lets two sprites overlap', () => {
    const entries = [sprite('a', 32), sprite('b', 16), sprite('c', 48), sprite('d', 24)]
    const [sheet] = packShelves(entries)
    const boxes = (sheet?.placed ?? []).map((p) => ({
      x: p.x,
      y: p.y,
      w: p.entry.width,
      h: p.entry.height,
    }))

    for (const [i, a] of boxes.entries()) {
      for (const b of boxes.slice(i + 1)) {
        const apart = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y
        expect(apart).toBe(true)
      }
    }
  })

  it('leaves a gutter, so no sprite touches its neighbour', () => {
    const [sheet] = packShelves([sprite('a', 16), sprite('b', 16)])
    const [first, second] = sheet?.placed ?? []
    expect(second?.x).toBeGreaterThan((first?.x ?? 0) + 16)
  })

  it('splits into more sheets rather than exceeding the size limit', () => {
    // 2048 is the smallest maximum texture size still on low-end mobile GPUs. A
    // sheet wider than that is not a slow image, it is a blank one.
    const entries = Array.from({ length: 64 }, (_, i) => sprite(`s${i}`, 64))
    const sheets = packShelves(entries, 132)
    expect(sheets.length).toBeGreaterThan(1)
    for (const sheet of sheets) {
      expect(sheet.width).toBeLessThanOrEqual(132)
      expect(sheet.height).toBeLessThanOrEqual(132)
    }
  })

  it('pads sheet dimensions to a multiple of twelve', () => {
    // The browser scales the whole sheet, so a sprite at a third of its size
    // sets background-size to a third of the sheet. A fractional result drifts
    // and shows a sliver of the neighbouring frame.
    for (const sheet of packShelves([sprite('a', 72), sprite('b', 60)])) {
      expect(sheet.width % 12).toBe(0)
      expect(sheet.height % 12).toBe(0)
    }
  })

  it('handles the real sprite size — 72 square, over a thousand of them', () => {
    const entries = Array.from({ length: 1133 }, (_, i) => sprite(`s${i}`, 72))
    const sheets = packShelves(entries)
    expect(sheets.flatMap((s) => s.placed)).toHaveLength(1133)
    for (const sheet of sheets) {
      expect(sheet.width).toBeLessThanOrEqual(2040)
      expect(sheet.height).toBeLessThanOrEqual(2040)
    }
  })

  it('is deterministic — same input, same layout', () => {
    const entries = [sprite('c', 32), sprite('a', 16), sprite('b', 32)]
    const once = JSON.stringify(packShelves(entries))
    const twice = JSON.stringify(packShelves([...entries].reverse()))
    expect(once).toBe(twice)
  })
})

describe('pngSize', () => {
  it('reads the dimensions out of the IHDR header', () => {
    const header = Buffer.alloc(24)
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(header)
    header.write('IHDR', 12, 'ascii')
    header.writeUInt32BE(32, 16)
    header.writeUInt32BE(48, 20)
    expect(pngSize(header)).toEqual({ width: 32, height: 48 })
  })

  it('returns null for a body that is not a PNG', () => {
    // The wiki serving an error page with a 200 is the case this catches; the
    // alternative is writing HTML to disk as a sprite.
    expect(pngSize(Buffer.from('<!DOCTYPE html><html>...'))).toBeNull()
    expect(pngSize(Buffer.alloc(4))).toBeNull()
  })
})
