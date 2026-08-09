import { describe, expect, it } from 'vitest'
import {
  maskOfSeasons,
  maskOfWeathers,
  oddsFor,
  oddsPhrase,
  opportunitiesFromWindows,
  possibleWeather,
  seasonsOf,
  type Window,
  weathersOf,
} from './opportunity'

const SPRING = 1
const FALL = 4
const CLEAR = 1
const STORM = 4

const window = (over: Partial<Window> = {}): Window => ({
  method: 'fishing',
  seasons: ['spring'],
  weather: ['clear', 'rain', 'storm', 'wind'],
  locations: ['the_farm'],
  habitats: [],
  time: null,
  time_precision: 'not_applicable',
  rarity: 'common',
  confidence: 'wiki',
  requires: [],
  ...over,
})

/**
 * The odds `meta.json` ships, as the game states them.
 *
 * Note that rain and storm carry the *same* range and the same pool: they are
 * one set of wet days seen twice, not two sets.
 */
const ODDS = {
  spring: {
    clear: { pool: 'calm', minDays: 16, maxDays: 20, exact: true },
    rain: { pool: 'inclement', minDays: 4, maxDays: 6, exact: false },
    storm: { pool: 'inclement', minDays: 4, maxDays: 6, exact: false },
    wind: { pool: 'special', minDays: 4, maxDays: 6, exact: true },
  },
  winter: {
    clear: { pool: 'calm', minDays: 22, maxDays: 24, exact: true },
    snow: { pool: 'inclement', minDays: 4, maxDays: 6, exact: false },
    blizzard: { pool: 'inclement', minDays: 4, maxDays: 6, exact: false },
  },
}

describe('weathersOf / seasonsOf', () => {
  it('reads a mask back into names, in the canonical order', () => {
    expect(weathersOf(CLEAR | STORM)).toEqual(['clear', 'storm'])
    expect(seasonsOf(FALL | SPRING)).toEqual(['spring', 'fall'])
  })

  it('round-trips through the inverses, dropping names it does not know', () => {
    expect(seasonsOf(maskOfSeasons(['fall', 'spring']))).toEqual(['spring', 'fall'])
    expect(weathersOf(maskOfWeathers(['storm', 'clear']))).toEqual(['clear', 'storm'])
    // A season a later schema adds must not take a page down on the way past.
    expect(maskOfSeasons(['harvest'])).toBe(0)
    expect(seasonsOf(maskOfSeasons(['spring', 'harvest']))).toEqual(['spring'])
  })
})

describe('possibleWeather', () => {
  it('uses the shipped odds, which are stricter than the schema mask', () => {
    // The schema allows wind in winter; the game gives winter no special days
    // and therefore no wind. The odds win.
    expect(possibleWeather(['winter'], ODDS)).toEqual(['clear', 'snow', 'blizzard'])
  })

  it('falls back to the mask when nothing was shipped', () => {
    expect(possibleWeather(['winter'], undefined)).toEqual(['clear', 'wind', 'snow', 'blizzard'])
  })
})

describe('opportunitiesFromWindows', () => {
  const find = (windows: Window[]) => opportunitiesFromWindows(windows, ODDS)

  it('names a weather the window genuinely narrows', () => {
    const found = find([window({ seasons: ['fall'], weather: ['rain', 'storm'] })])
    expect(found[0]?.weather).toEqual(['rain', 'storm'])
  })

  it('says nothing when the weather excludes nothing its seasons can produce', () => {
    // The case that matters most. A rule's weather is already intersected with
    // what its seasons allow, so a fall fish that bites in anything ships as
    // all four — and tagging it would put a label that narrows nothing on four
    // fifths of the dataset.
    const found = find([window({ seasons: ['fall'], weather: ['clear', 'rain', 'storm', 'wind'] })])
    expect(found[0]?.weather).toBe(null)
  })

  it('does not call a winter window weather-gated for lacking rain', () => {
    // Winter has no rain, and the shipped odds give it no wind either. A window
    // allowing everything winter *can* have is unrestricted.
    const found = find([window({ seasons: ['winter'], weather: ['clear', 'snow', 'blizzard'] })])
    expect(found[0]?.weather).toBe(null)
  })

  it('treats null weather as "does not apply", not as a restriction', () => {
    // A mine drop and an apiary have no weather at all. Reading the empty list
    // as "appears in no weather" would tag them as impossible.
    expect(find([window({ weather: null })])[0]?.weather).toBe(null)
  })

  it('keeps a window whole, with every place on the one entry', () => {
    // Splitting them into a row each — which the screen this replaced did,
    // because each of its rows carried a different countdown — produces three
    // cards identical but for the place name, each repeating the same weather
    // sentence. The map pins all three either way.
    const found = find([window({ locations: ['mistria', 'the_farm', 'the_beach'] })])
    expect(found).toHaveLength(1)
    expect(found[0]?.locationIds).toEqual(['mistria', 'the_farm', 'the_beach'])
  })

  it('keeps a window that names no place at all', () => {
    // Eleven items are only ever produced by a machine and the flat rules index
    // has no row for any of them. Dropping a placeless window would blank their
    // whole section.
    const found = find([window({ method: 'apiary', locations: [] })])
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({ method: 'apiary', locationIds: [] })
  })

  it('keeps two windows apart', () => {
    // A bug can be spring-in-town-at-night *and* all-season-in-the-mines. The
    // array is an OR and flattening it gives wrong answers.
    const found = find([window({ seasons: ['spring'] }), window({ seasons: ['fall'] })])
    expect(found.map((o) => o.seasons)).toEqual([['spring'], ['fall']])
  })

  it('carries the method, not a kind, and the rarity as written', () => {
    const found = find([window({ method: 'dig_spot', rarity: 'uncommon' })])
    expect(found[0]).toMatchObject({ method: 'dig_spot', rarity: 'uncommon' })
  })

  it('flags an inferred place and what it was inferred from', () => {
    const found = find([window({ confidence: 'inferred', habitats: ['ocean'] })])
    expect(found[0]).toMatchObject({ placesInferred: true, habitat: 'ocean' })
    // An inference with no habitat recorded still hedges — 30 of the 153 do.
    expect(find([window({ confidence: 'inferred' })])[0]).toMatchObject({
      placesInferred: true,
      habitat: null,
    })
    expect(find([window()])[0]?.placesInferred).toBe(false)
  })

  it('separates a stated "any time" from an unsourced one', () => {
    expect(find([window({ time: null, time_precision: 'not_applicable' })])[0]?.timeIsAnyTime).toBe(
      true,
    )
    expect(find([window({ time: null, time_precision: 'unknown' })])[0]?.timeIsAnyTime).toBe(false)
  })

  it('passes clock ranges through untouched, midnight wrap and all', () => {
    // Ten windows still wrap (the night bugs). Nothing here works out which
    // side of midnight they fall on — see apps/web/CLAUDE.md §3.
    const found = find([window({ time: [{ from: '20:00', to: '02:00' }] })])
    expect(found[0]?.time).toEqual([{ from: '20:00', to: '02:00' }])
  })
})

describe('oddsFor', () => {
  it('does not double-count two weathers from the same pool', () => {
    // Rain and storm ARE the season's four-to-six wet days. Adding them would
    // report a twelve-day rainy season and read exactly like a fact.
    expect(oddsFor(ODDS, 'spring', ['rain', 'storm'])).toMatchObject({
      minDays: 4,
      maxDays: 6,
    })
  })

  it('knows the whole pool exactly, and a share of it only as a bound', () => {
    // Rain-or-storm is every wet day there is, so the count is precise.
    expect(oddsFor(ODDS, 'spring', ['rain', 'storm'])?.exact).toBe(true)
    // A storm is some unpublished share of those same days.
    expect(oddsFor(ODDS, 'spring', ['storm'])?.exact).toBe(false)
  })

  it('adds across different pools', () => {
    // Calm and special are genuinely separate days, so these do add.
    expect(oddsFor(ODDS, 'spring', ['clear', 'wind'])).toMatchObject({
      minDays: 20,
      maxDays: 26,
      exact: true,
    })
  })

  it('caps the sum at the length of a season', () => {
    expect(oddsFor(ODDS, 'spring', ['clear', 'rain', 'storm', 'wind'])?.maxDays).toBe(28)
  })

  it('is null when nothing was shipped', () => {
    expect(oddsFor(undefined, 'spring', ['rain'])).toBe(null)
    expect(oddsFor(ODDS, 'summer', ['rain'])).toBe(null)
  })
})

describe('oddsPhrase', () => {
  it('states an exact count plainly', () => {
    expect(oddsPhrase(ODDS, ['spring'], ['wind'])).toBe('4–6 days of every spring')
  })

  it('words an unstated share as an upper bound', () => {
    // A storm comes out of the same 4-6 wet days as rain, and the split is not
    // in the files. "4-6 days" would claim a number nobody published.
    expect(oddsPhrase(ODDS, ['spring'], ['storm'])).toBe('at most 4–6 days of every spring')
  })

  it('names each season when they disagree, and collapses them when they do not', () => {
    expect(oddsPhrase(ODDS, ['spring', 'winter'], ['clear'])).toBe(
      '16–20 days in spring, 22–24 days in winter',
    )
    expect(oddsPhrase(ODDS, ['spring', 'winter'], ['blizzard', 'storm'])).toBe(
      'at most 4–6 days of every spring and winter',
    )
  })

  it('says nothing at all when nothing was shipped', () => {
    expect(oddsPhrase(undefined, ['spring'], ['rain'])).toBe(null)
    expect(oddsPhrase(ODDS, ['summer'], ['rain'])).toBe(null)
  })
})
