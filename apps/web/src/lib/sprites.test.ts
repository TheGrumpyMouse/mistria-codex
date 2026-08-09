import { describe, expect, it } from 'vitest'
import { Atlas, EMPTY_ATLAS, integerScale, renderingFor, spriteStyle } from './sprites'

const index = {
  sheets: [
    {
      file: 'atlas-item.abc123.png',
      width: 128,
      height: 64,
      frames: {
        'item/ore_copper': [0, 0, 16, 16] as [number, number, number, number],
        'item/milk': [17, 0, 16, 16] as [number, number, number, number],
      },
    },
  ],
  portraits: { 'portrait/adeline': 'portrait/adeline-portrait.png' },
}

describe('Atlas', () => {
  it('resolves an icon key to a rectangle in a sheet', () => {
    const atlas = new Atlas(index, '/mistria-codex/')
    expect(atlas.get('item/milk')).toEqual({
      url: '/mistria-codex/assets/game/atlas-item.abc123.png',
      x: 17,
      y: 0,
      width: 16,
      height: 16,
      sheetWidth: 128,
      sheetHeight: 64,
    })
  })

  it('builds URLs from the base path it was given', () => {
    // A leading slash works in dev and 404s on GitHub Pages, which serves from
    // /<repo>/. See apps/web/CLAUDE.md.
    const atlas = new Atlas(index, '/mistria-codex/')
    expect(atlas.get('item/milk')?.url.startsWith('/mistria-codex/')).toBe(true)
  })

  it('returns null for a key with no sprite, rather than throwing', () => {
    // About thirty records have no art on the wiki. Missing is a normal answer.
    const atlas = new Atlas(index, '/')
    expect(atlas.get('item/rabbit_horn')).toBeNull()
    expect(atlas.get(null)).toBeNull()
    expect(atlas.get(undefined)).toBeNull()
  })

  it('finds a villager portrait from their character key', () => {
    const atlas = new Atlas(index, '/')
    expect(atlas.portrait('character/adeline')).toBe('/assets/game/portrait/adeline-portrait.png')
    expect(atlas.portrait('character/caldarus')).toBeNull()
  })

  it('stamps every URL with the asset version', () => {
    // The whole art bundle sits behind one CacheFirst route, and only the
    // sheets carry a hash in their own filename — the portraits and the index
    // do not. Without this the cache pins a device to the first art it ever
    // saw, which is how the fish animation reached devices that never showed
    // it. Sheets take the suffix too: one rule, no per-family exceptions.
    const atlas = new Atlas(index, '/mistria-codex/', 'f87dff6b13')
    expect(atlas.get('item/milk')?.url).toBe(
      '/mistria-codex/assets/game/atlas-item.abc123.png?v=f87dff6b13',
    )
    expect(atlas.portrait('character/adeline')).toBe(
      '/mistria-codex/assets/game/portrait/adeline-portrait.png?v=f87dff6b13',
    )
  })

  it('omits the query when there is no version to state', () => {
    // A clone with no packed assets has no version, and inventing `?v=null`
    // would be a cache key that means nothing.
    expect(new Atlas(index, '/', null).get('item/milk')?.url).toBe(
      '/assets/game/atlas-item.abc123.png',
    )
  })

  it('is empty, not broken, before the index loads', () => {
    // The app renders entirely from drawn glyphs in this state, which is also
    // the state of a clone that has never run `pnpm assets:fetch`.
    expect(EMPTY_ATLAS.get('item/milk')).toBeNull()
    expect(EMPTY_ATLAS.size).toBe(0)
  })
})

describe('integerScale', () => {
  it('picks the largest whole factor that fits going up', () => {
    expect(integerScale(16, 36)).toBe(2)
    expect(integerScale(16, 48)).toBe(3)
    expect(integerScale(16, 24)).toBe(1)
  })

  it('reduces by a whole divisor, so a 72px sprite fits a 24px row', () => {
    // The common case: the wiki's item sprites are 72 square and a list row
    // gives them 24. An earlier version clamped at 1 and they blew out the row.
    expect(integerScale(72, 24)).toBe(1 / 3)
    expect(integerScale(72, 36)).toBe(1 / 2)
    expect(integerScale(72, 72)).toBe(1)
  })

  it('always fits inside the box', () => {
    for (const sprite of [16, 18, 24, 60, 64, 72]) {
      for (const box of [24, 36, 72]) {
        expect(sprite * integerScale(sprite, box)).toBeLessThanOrEqual(box)
      }
    }
  })

  it('is never a factor like 1.5', () => {
    // Some source pixels would become two screen pixels and their neighbours
    // one, which reads as a lopsided sprite.
    for (const sprite of [16, 18, 24, 60, 64, 72]) {
      for (const box of [24, 36, 56, 72]) {
        const scale = integerScale(sprite, box)
        expect(Number.isInteger(scale) || Number.isInteger(1 / scale)).toBe(true)
      }
    }
  })
})

describe('renderingFor', () => {
  it('is pixelated going up and smooth coming down', () => {
    expect(renderingFor(2)).toBe('pixelated')
    expect(renderingFor(1)).toBe('pixelated')
    expect(renderingFor(1 / 3)).toBe('auto')
  })
})

describe('spriteStyle', () => {
  it('offsets the sheet, and scales the offset with it', () => {
    const sprite = {
      url: 'a.png',
      x: 17,
      y: 5,
      width: 16,
      height: 16,
      sheetWidth: 128,
      sheetHeight: 64,
    }
    expect(spriteStyle(sprite, 2)).toMatchObject({
      width: 32,
      height: 32,
      backgroundPosition: '-34px -10px',
      backgroundSize: '256px 128px',
    })
  })
})
