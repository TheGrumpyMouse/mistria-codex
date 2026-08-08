import { describe, expect, it } from 'vitest'
import {
  allGameWeather,
  hoursToRange,
  plantableTrees,
  rarityFor,
  seasonsFor,
  statedWeather,
  weatherFor,
} from './game-facts.js'

/** The mapping as `curated/vocab/weather.json` states it. */
const CLASSES = {
  calm: { spring: 'clear', summer: 'clear', fall: 'clear', winter: 'clear' },
  inclement: { spring: 'rain', summer: 'rain', fall: 'rain', winter: 'snow' },
  heavy_inclement: { spring: 'storm', summer: 'storm', fall: 'storm', winter: 'blizzard' },
  special: { spring: 'wind', summer: null, fall: 'wind', winter: null },
} as const

describe('hoursToRange', () => {
  it('keeps a window that wraps past midnight as a wrapping range', () => {
    // 26 is not an hour. It is 02:00 the next morning, because the game day
    // ends at 02:00 — clamping it to 24 would delete the whole night window.
    expect(hoursToRange([20, 26])).toEqual({ from: '20:00', to: '02:00' })
  })

  it('reads a plain daytime window', () => {
    expect(hoursToRange([6, 17])).toEqual({ from: '06:00', to: '17:00' })
  })

  it('reads no restriction as null', () => {
    expect(hoursToRange(null)).toBe(null)
  })

  it('drops a window covering the whole game day — a restriction that restricts nothing', () => {
    expect(hoursToRange([6, 26])).toBe(null)
  })
})

describe('seasonsFor', () => {
  it('reads no restriction as all four, never as none', () => {
    expect(seasonsFor(null)).toEqual(['spring', 'summer', 'fall', 'winter'])
  })

  it('keeps a stated list', () => {
    expect(seasonsFor(['spring'])).toEqual(['spring'])
  })

  it('falls back to all four rather than silently narrowing on an unknown word', () => {
    // Quietly dropping the word we did not recognise would delete availability
    // and look like a correct answer. Widening is the safe direction.
    expect(seasonsFor(['spring', 'harvest'])).toEqual(['spring', 'summer', 'fall', 'winter'])
  })
})

describe('weatherFor', () => {
  it('expands one class differently per season', () => {
    expect(weatherFor(['heavy_inclement'], ['fall'], CLASSES)).toEqual(['storm'])
    expect(weatherFor(['heavy_inclement'], ['winter'], CLASSES)).toEqual(['blizzard'])
  })

  it('unions across the seasons a single window covers', () => {
    expect(weatherFor(['inclement'], ['fall', 'winter'], CLASSES)).toEqual(['rain', 'snow'])
  })

  it('reads no restriction as null so the caller can expand it', () => {
    expect(weatherFor(null, ['spring'], CLASSES)).toBe(null)
  })

  it('reports a class that cannot occur in these seasons as unknown, not as impossible', () => {
    // Summer has no special weather at all. An empty list would read as "no
    // weather works", which is a claim; null reads as "we cannot say".
    expect(weatherFor(['special'], ['summer'], CLASSES)).toBe(null)
  })
})

describe('allGameWeather', () => {
  it('gives winter snow and blizzard and no rain', () => {
    expect(allGameWeather(['winter'], CLASSES)).toEqual(['blizzard', 'clear', 'snow'])
  })

  it('gives summer no wind, because the game grants summer no special days', () => {
    expect(allGameWeather(['summer'], CLASSES)).toEqual(['clear', 'rain', 'storm'])
  })
})

describe('statedWeather', () => {
  it('expands "no restriction" to every weather the season allows', () => {
    expect(statedWeather(null, ['spring'], CLASSES)).toEqual(['clear', 'rain', 'storm', 'wind'])
  })

  it('leaves a stated restriction narrow', () => {
    expect(statedWeather(['inclement', 'heavy_inclement'], ['spring'], CLASSES)).toEqual([
      'rain',
      'storm',
    ])
  })
})

describe('rarityFor', () => {
  it('folds the game five grades of common onto one', () => {
    expect(rarityFor('ultra_common')).toBe('common')
    expect(rarityFor('very_common')).toBe('common')
  })

  it('keeps very_rare distinct as epic — six bugs the wiki grades as nothing', () => {
    expect(rarityFor('very_rare')).toBe('epic')
  })

  it('refuses the junk and chest tiers, which say what a thing is and not how rare', () => {
    expect(rarityFor('junk')).toBe(null)
    expect(rarityFor('gold_chest')).toBe(null)
  })
})

describe('plantableTrees', () => {
  const tree = (id: string, harvest: string | null) => ({
    id,
    harvest,
    seasons: harvest === null ? null : ['spring'],
    regrow_days: harvest === null ? null : 3,
    yield: harvest === null ? null : 3,
    // Fifteen entries, last stage on the fifteenth — fourteen days of growth.
    day_to_stage: [0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 4],
  })
  const sapling = (id: string, plants: string) =>
    ({ id, sapling: plants }) as unknown as Parameters<typeof plantableTrees>[1][number]

  it('keys a tree by its fruit and pairs it with the sapling that plants it', () => {
    const found = plantableTrees(
      [tree('tree_lemon', 'lemon')],
      [sapling('sapling_lemon', 'tree_lemon')],
    )
    expect(found.get('lemon')?.saplingItemId).toBe('sapling_lemon')
  })

  it('reads growth as one fewer than the stage table has entries', () => {
    const found = plantableTrees(
      [tree('tree_lemon', 'lemon')],
      [sapling('sapling_lemon', 'tree_lemon')],
    )
    expect(found.get('lemon')?.growthDays).toBe(14)
  })

  it('drops a tree nothing sells you — plum blossom is wild, not a crop', () => {
    const found = plantableTrees(
      [tree('tree_plum_blossom', 'plum_blossom')],
      [sapling('sapling_lemon', 'tree_lemon')],
    )
    expect(found.has('plum_blossom')).toBe(false)
  })

  it('drops a timber tree, which has no fruit to key on', () => {
    const found = plantableTrees([tree('tree_oak', null)], [sapling('sapling_oak', 'tree_oak')])
    expect(found.size).toBe(0)
  })
})
