import { describe, expect, it } from 'vitest'
import { type Instant, type Rule, ruleMatches } from './findable'
import {
  daysUntilSeason,
  oddsFor,
  oddsPhrase,
  opportunitiesFor,
  possibleWeather,
  seasonsOf,
  weathersOf,
} from './opportunity'

const SPRING = 1
const SUMMER = 2
const FALL = 4
const WINTER = 8
const CLEAR = 1
const RAIN = 2
const STORM = 4
const WIND = 8
const SNOW = 16
const BLIZZARD = 32

const rule = (over: Partial<Rule>): Rule => ({
  e: 'walleye',
  k: 'fish',
  loc: 0,
  sub: null,
  sea: SPRING,
  wx: CLEAR | RAIN | STORM | WIND,
  t: [],
  d: null,
  dow: null,
  y: null,
  rar: null,
  req: [],
  p: null,
  conf: 'wiki',
  ...over,
})

const at = (over: Partial<Instant> = {}): Instant => ({
  season: 'spring',
  day: 1,
  year: 1,
  weather: 'clear',
  time: null,
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
})

describe('daysUntilSeason', () => {
  it('is zero for the season you are already in', () => {
    expect(daysUntilSeason(at({ season: 'spring', day: 12 }), 'spring')).toBe(0)
  })

  it('counts to the first day of the next occurrence', () => {
    // Spring 1 -> Summer 1 is 28 days.
    expect(daysUntilSeason(at({ season: 'spring', day: 1 }), 'summer')).toBe(28)
    // Eleven days into spring, summer is eleven days closer.
    expect(daysUntilSeason(at({ season: 'spring', day: 12 }), 'summer')).toBe(17)
  })

  it('wraps the year rather than going negative', () => {
    expect(daysUntilSeason(at({ season: 'winter', day: 1 }), 'spring')).toBe(28)
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

describe('opportunitiesFor', () => {
  const find = (rules: Rule[], instant: Instant) =>
    opportunitiesFor(rules, ['the_farm', 'mistria'], 'walleye', instant, ruleMatches, ODDS)

  it('returns only the entity asked about', () => {
    const rules = [rule({}), rule({ e: 'chum' })]
    expect(find(rules, at())).toHaveLength(1)
  })

  it('dates a rule that is not weather-gated', () => {
    // Every weather spring can have, so weather is not a gate and a date is a
    // real answer.
    const found = find([rule({ sea: SUMMER })], at({ season: 'spring', day: 1 }))
    expect(found[0]?.daysAway).toBe(28)
    expect(found[0]?.noDateReason).toBe(null)
  })

  it('refuses a date for a weather-gated rule, and says why', () => {
    const found = find([rule({ sea: FALL, wx: RAIN })], at({ season: 'spring', day: 1 }))
    expect(found[0]?.daysAway).toBe(null)
    expect(found[0]?.noDateReason).toBe('weather')
    expect(found[0]?.weather).toEqual(['rain'])
  })

  it('does not call a winter rule weather-gated for lacking rain', () => {
    // Winter has no rain. A rule allowing everything winter *can* have is
    // unrestricted, and withholding its date would be wrong.
    const found = find(
      [rule({ sea: WINTER, wx: CLEAR | SNOW | BLIZZARD })],
      at({ season: 'spring', day: 1 }),
    )
    expect(found[0]?.weather).toBe(null)
    expect(found[0]?.daysAway).toBe(84)
  })

  it('marks a rule that matches the instant as available now, with no date', () => {
    const found = find(
      [rule({ sea: SPRING, wx: CLEAR })],
      at({ season: 'spring', weather: 'clear' }),
    )
    expect(found[0]?.availableNow).toBe(true)
    expect(found[0]?.daysAway).toBe(null)
    expect(found[0]?.noDateReason).toBe(null)
  })

  it('puts what is available now first, then the soonest', () => {
    const found = find(
      [
        rule({ sea: WINTER, wx: CLEAR | WIND | SNOW | BLIZZARD }),
        rule({ sea: SUMMER }),
        rule({ sea: SPRING, wx: CLEAR }),
      ],
      at({ season: 'spring', day: 1, weather: 'clear' }),
    )
    expect(found.map((o) => o.availableNow)).toEqual([true, false, false])
    expect(found[1]?.daysAway).toBe(28)
    expect(found[2]?.daysAway).toBe(84)
  })

  it('resolves the location index to an id, and keeps null as null', () => {
    const found = find([rule({ loc: 1 }), rule({ loc: null })], at())
    expect(found.map((o) => o.locationId)).toEqual(['mistria', null])
  })

  it('keeps one opportunity per location rather than collapsing them', () => {
    // Three ponds is three places to go. Collapsing them answers "where" with
    // a shrug.
    const found = find([rule({ loc: 0 }), rule({ loc: 1 })], at())
    expect(found).toHaveLength(2)
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
