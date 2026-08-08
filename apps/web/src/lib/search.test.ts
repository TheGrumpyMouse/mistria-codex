import { describe, expect, it } from 'vitest'
import type { DisplayIndex } from './data'
import { rankOf, search } from './search'

const index: DisplayIndex = {
  ore_copper: { n: 'Copper Ore', i: null, c: 'material', v: 20 },
  copper_nugget_beetle: { n: 'Copper Nugget Beetle', i: null, c: 'bug', v: 90 },
  copper_axe: { n: 'Copper Axe', i: null, c: 'tool', v: null },
  ingot_copper: { n: 'Copper Ingot', i: null, c: 'material', v: 60 },
  coal: { n: 'Coal', i: null, c: 'material', v: 15 },
  haydens_shop: { n: "Hayden's Shop", i: null, c: 'location', v: null },
  celine: { n: 'Céline', i: null, c: 'character', v: null },
}

describe('rankOf', () => {
  it('ranks an exact name best', () => {
    expect(rankOf('Coal', 'coal')).toBe(0)
  })

  it('ranks a prefix above a word start above anywhere', () => {
    expect(rankOf('Copper Ore', 'copper')).toBe(1)
    expect(rankOf('Copper Ore', 'ore')).toBe(2)
    expect(rankOf('Storeroom', 'ore')).toBe(3)
  })

  it('is null when there is no match at all', () => {
    expect(rankOf('Copper Ore', 'zzz')).toBeNull()
  })

  it('ignores apostrophes and accents', () => {
    // Nobody types the apostrophe in Hayden's or the accent in Céline.
    expect(rankOf("Hayden's Shop", 'haydens')).toBe(1)
    expect(rankOf('Céline', 'celine')).toBe(0)
  })
})

describe('search', () => {
  it('puts the thing you meant first', () => {
    // A plain substring filter puts "Copper Nugget Beetle" above "Copper Ore".
    // Shorter and earlier is almost always what was meant.
    expect(search(index, 'copper').map((h) => h.entry.n)).toEqual([
      'Copper Axe',
      'Copper Ore',
      'Copper Ingot',
      'Copper Nugget Beetle',
    ])
  })

  it('prefers an exact name over a longer one containing it', () => {
    expect(search(index, 'coal')[0]?.entry.n).toBe('Coal')
  })

  it('is empty for an empty query rather than everything', () => {
    expect(search(index, '')).toEqual([])
    expect(search(index, '   ')).toEqual([])
  })

  it('searches villagers and places, not just items', () => {
    expect(search(index, 'hayden')[0]?.id).toBe('haydens_shop')
    expect(search(index, 'celine')[0]?.id).toBe('celine')
  })
})
