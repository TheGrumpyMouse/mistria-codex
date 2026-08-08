import { describe, expect, it } from 'vitest'
import type { AvailabilityIndex, Instant, Rule } from './findable'
import { findAvailable, groupByKind, ruleMatches, weekdayOf } from './findable'

const SPRING = 1
const SUMMER = 2
const FALL = 4
const CLEAR = 1
const RAIN = 2

const rule = (over: Partial<Rule> = {}): Rule => ({
  e: 'x',
  k: 'fish',
  loc: null,
  sub: null,
  sea: SPRING | SUMMER | FALL,
  wx: CLEAR | RAIN,
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
  time: 720,
  ...over,
})

describe('ruleMatches', () => {
  it('requires the season', () => {
    expect(ruleMatches(rule({ sea: SPRING }), at({ season: 'spring' }))).toBe(true)
    expect(ruleMatches(rule({ sea: SPRING }), at({ season: 'summer' }))).toBe(false)
  })

  it('requires the weather', () => {
    expect(ruleMatches(rule({ wx: RAIN }), at({ weather: 'rain' }))).toBe(true)
    expect(ruleMatches(rule({ wx: RAIN }), at({ weather: 'clear' }))).toBe(false)
  })

  it('matches every time when the rule states none', () => {
    // 801 of 832 rules are in this state. Treating it as "excluded" would empty
    // the flagship screen rather than narrow it.
    expect(ruleMatches(rule({ t: [] }), at({ time: 0 }))).toBe(true)
    expect(ruleMatches(rule({ t: [] }), at({ time: 1439 }))).toBe(true)
  })

  it('matches every time when the player has not narrowed by one', () => {
    expect(ruleMatches(rule({ t: [[360, 400]] }), at({ time: null }))).toBe(true)
  })

  it('respects a stated time window, end-exclusive', () => {
    const r = rule({ t: [[360, 400]] })
    expect(ruleMatches(r, at({ time: 360 }))).toBe(true)
    expect(ruleMatches(r, at({ time: 399 }))).toBe(true)
    expect(ruleMatches(r, at({ time: 400 }))).toBe(false)
    expect(ruleMatches(r, at({ time: 359 }))).toBe(false)
  })

  it('handles a window the build split across midnight', () => {
    // 20:00-02:00 ships as two intervals. Runtime code never compares a start
    // to an end to work out which side of midnight it is on.
    const night = rule({
      t: [
        [1200, 1440],
        [0, 120],
      ],
    })
    expect(ruleMatches(night, at({ time: 1300 }))).toBe(true)
    expect(ruleMatches(night, at({ time: 60 }))).toBe(true)
    expect(ruleMatches(night, at({ time: 600 }))).toBe(false)
  })

  it('respects a day range and a minimum year', () => {
    expect(ruleMatches(rule({ d: [14, 16] }), at({ day: 15 }))).toBe(true)
    expect(ruleMatches(rule({ d: [14, 16] }), at({ day: 17 }))).toBe(false)
    expect(ruleMatches(rule({ y: 2 }), at({ year: 1 }))).toBe(false)
    expect(ruleMatches(rule({ y: 2 }), at({ year: 2 }))).toBe(true)
  })

  it('respects a day-of-week gate', () => {
    // Day 6 of a season is a Saturday: the 28 days are four exact weeks.
    expect(weekdayOf(6)).toBe('sat')
    expect(ruleMatches(rule({ dow: 32 }), at({ day: 6 }))).toBe(true)
    expect(ruleMatches(rule({ dow: 32 }), at({ day: 5 }))).toBe(false)
  })
})

describe('findAvailable', () => {
  const index = (rules: Rule[]): AvailabilityIndex => ({
    locations: ['the_beach', 'the_narrows'],
    rules,
  })

  it('is an OR across an entity’s rules', () => {
    // A bug can be spring-in-town *and* all-season-in-the-mines. Flattening the
    // two into one window produces wrong answers on the flagship screen.
    const found = findAvailable(
      index([rule({ e: 'moth', sea: SPRING, loc: 0 }), rule({ e: 'moth', sea: FALL, loc: 1 })]),
      at({ season: 'fall' }),
    )
    expect(found).toHaveLength(1)
    expect(found[0]?.locationIds).toEqual(['the_narrows'])
  })

  it('collects every place a thing is findable right now', () => {
    const found = findAvailable(
      index([rule({ e: 'bass', loc: 0 }), rule({ e: 'bass', loc: 1 })]),
      at(),
    )
    expect(found[0]?.locationIds).toEqual(['the_beach', 'the_narrows'])
  })

  it('still returns a match when nothing knows the place', () => {
    // Unknown does not exclude: no location on any rule just means an empty
    // location list, never a dropped row.
    const found = findAvailable(index([rule({ e: 'a', loc: null })]), at())
    expect(found).toHaveLength(1)
    expect(found[0]?.locationIds).toEqual([])
  })

  it('keeps the easiest rarity across routes', () => {
    const found = findAvailable(index([rule({ e: 'a', rar: 3 }), rule({ e: 'a', rar: 1 })]), at())
    expect(found[0]?.rarity).toBe(1)
  })
})

describe('every returned rule really matches, and every excluded one really does not', () => {
  // The property the plan asks for, over the shipped shapes rather than random
  // noise: re-checking each rule naively must agree with the scan, both ways.
  const rules: Rule[] = []
  for (const sea of [SPRING, SUMMER, FALL, 8]) {
    for (const wx of [CLEAR, RAIN, CLEAR | RAIN]) {
      for (const t of [
        [],
        [[360, 400]],
        [
          [1200, 1440],
          [0, 120],
        ],
      ] as [number, number][][]) {
        for (const d of [null, [14, 16]] as ([number, number] | null)[]) {
          rules.push(rule({ e: `r${rules.length}`, sea, wx, t, d }))
        }
      }
    }
  }

  it('agrees with a naive re-check across 1,000 instants', () => {
    const index: AvailabilityIndex = { locations: [], rules }
    const seasons = ['spring', 'summer', 'fall', 'winter'] as const
    const weathers = ['clear', 'rain'] as const

    let checked = 0
    for (let i = 0; i < 1000; i += 1) {
      const instant = at({
        season: seasons[i % 4] as (typeof seasons)[number],
        weather: weathers[i % 2] as (typeof weathers)[number],
        day: (i % 28) + 1,
        year: (i % 3) + 1,
        time: i % 7 === 0 ? null : (i * 37) % 1440,
      })

      const returned = new Set(findAvailable(index, instant).map((e) => e.id))
      for (const r of rules) {
        expect(returned.has(r.e)).toBe(ruleMatches(r, instant))
        checked += 1
      }
    }
    expect(checked).toBe(1000 * rules.length)
  })
})

describe('groupByKind', () => {
  it('orders sections and drops empty ones', () => {
    const groups = groupByKind([
      { id: 'a', kind: 'fish', locationIds: [], rarity: null, requires: [] },
      { id: 'b', kind: 'forage', locationIds: [], rarity: null, requires: [] },
    ])
    expect(groups.map((g) => g.kind)).toEqual(['forage', 'fish'])
  })
})
