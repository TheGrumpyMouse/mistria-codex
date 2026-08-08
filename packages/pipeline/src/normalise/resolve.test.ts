import { beforeAll, describe, expect, it } from 'vitest'
import { Resolver } from './resolve.js'

let resolver: Resolver

beforeAll(async () => {
  resolver = await Resolver.load()
})

/**
 * Inputs are real values from `sources/wiki/cargo/Items.json` and `Fish.json`,
 * taken from the vocab report rather than imagined.
 */

describe('seasons', () => {
  it('reads a single season', () => {
    expect(resolver.resolveSeasons('Fall', 'apple').seasons).toEqual(['fall'])
  })

  it('splits a multi-season value', () => {
    // The wiki renders these as adjacent icon spans, which collapse to one string.
    expect(resolver.resolveSeasons('Spring Summer Fall', 'x').seasons).toEqual([
      'spring',
      'summer',
      'fall',
    ])
    expect(resolver.resolveSeasons('Summer Winter', 'x').seasons).toEqual(['summer', 'winter'])
  })

  it('treats an empty season as all four, not as unknown', () => {
    // 725 of 1,154 items are empty here. They are tools and cooked dishes —
    // not seasonal, therefore available whenever.
    expect(resolver.resolveSeasons('', 'hoe').seasons).toEqual([
      'spring',
      'summer',
      'fall',
      'winter',
    ])
  })

  it('expands "All"', () => {
    expect(resolver.resolveSeasons('All', 'x').seasons).toHaveLength(4)
  })

  it('reads a festival date range as dates, not as a season name', () => {
    // "Fall 7 to 10" is the Queen Berry window. Treating it as a plain season
    // would make it available for all 28 days.
    const result = resolver.resolveSeasons('Fall 7 to 10', 'queen_berry')
    expect(result.seasons).toEqual(['fall'])
    expect(result.dates).toEqual([
      { season: 'fall', day: 7 },
      { season: 'fall', day: 8 },
      { season: 'fall', day: 9 },
      { season: 'fall', day: 10 },
    ])
  })

  it('reads the spring festival window', () => {
    const result = resolver.resolveSeasons('Spring 14 to 16', 'breath_of_spring')
    expect(result.dates).toHaveLength(3)
    expect(result.dates?.[0]).toEqual({ season: 'spring', day: 14 })
  })
})

describe('weather', () => {
  it('expands "Any" to every state', () => {
    expect(resolver.resolveWeather(['Any'], 'x')).toHaveLength(6)
  })

  it('folds the wiki’s duplicate spellings together', () => {
    // Rain/Rainy and Storm/Thunderstorm are the same weather. Splitting them
    // would tell someone a fish isn't biting when it is.
    expect(resolver.resolveWeather(['Rain'], 'x')).toEqual(['rain'])
    expect(resolver.resolveWeather(['Rainy'], 'x')).toEqual(['rain'])
    expect(resolver.resolveWeather(['Storm'], 'x')).toEqual(['storm'])
    expect(resolver.resolveWeather(['Thunderstorm'], 'x')).toEqual(['storm'])
  })

  it('maps the winter states', () => {
    expect(resolver.resolveWeather(['Snow'], 'x')).toEqual(['snow'])
    expect(resolver.resolveWeather(['Blizzard'], 'x')).toEqual(['blizzard'])
  })

  it('returns null when the source said nothing', () => {
    expect(resolver.resolveWeather([], 'x')).toBeNull()
  })
})

describe('locations', () => {
  it('resolves a concrete place', () => {
    expect(resolver.resolveLocations(['The Eastern Road'], 'apple').locations).toEqual([
      'the_eastern_road',
    ])
  })

  it('matches aliases and ignores case and punctuation', () => {
    expect(resolver.resolveLocations(['Deep Woods'], 'x').locations).toEqual(['the_deep_woods'])
    expect(resolver.resolveLocations(['the deep woods'], 'x').locations).toEqual(['the_deep_woods'])
  })

  it('records a habitat as a habitat, and leaves the expansion to the build', () => {
    // "Pond" is a class of place, and this class cannot say whether that class
    // is enumerable — the Fishing page can. So no locations and, deliberately,
    // no gap either: build/waters.ts expands it and decides. Calling it a gap
    // here would double-count the uncertainty the expanded window already
    // records as `confidence: "inferred"`.
    const result = resolver.resolveLocations(['Pond'], 'rainbow_trout')
    expect(result.habitats).toEqual(['pond'])
    expect(result.locations).toEqual([])
    expect(result.hasGap).toBe(false)
  })

  it('pulls a floor range into depth rather than treating it as a place', () => {
    const result = resolver.resolveLocations(['The Deep Earth', '(floors 41-59)'], 'x')
    expect(result.locations).toEqual(['the_deep_earth'])
    expect(result.depth).toEqual({ min: 41, max: 59 })
  })

  it('spans a multi-range floor list', () => {
    const result = resolver.resolveLocations(['(floors 1-19, 21-39, 41-59, 61-79, 81-99)'], 'x')
    expect(result.depth).toEqual({ min: 1, max: 99 })
  })

  it('extracts a perk gate and still resolves the rest of the token', () => {
    const result = resolver.resolveLocations(['Dig Spots (requires Well Placed Skill)'], 'x')
    expect(result.methods).toEqual(['dig_spot'])
    expect(result.requires).toEqual([{ type: 'perk', key: 'well_placed', op: 'has', value: null }])
  })

  it('extracts a quest gate', () => {
    const result = resolver.resolveLocations(
      ['The Beach (requires Story Quest "Repair the Beach Bridge" to be completed)'],
      'x',
    )
    expect(result.locations).toEqual(['the_beach'])
    expect(result.requires[0]?.type).toBe('quest')
    expect(result.requires[0]?.key).toBe('repair_the_beach_bridge')
  })

  it('treats a catch method in the location column as a method', () => {
    expect(resolver.resolveLocations(['Fish Trap'], 'x').methods).toEqual(['fish_trap'])
  })

  it('marks an uninformative value as a gap without inventing a place', () => {
    const result = resolver.resolveLocations(['Any'], 'x')
    expect(result.locations).toEqual([])
    expect(result.hasGap).toBe(true)
  })

  it('falls back to the containing place when the wiki is more specific than we are', () => {
    // Real values. "The Narrows (north)" is genuinely in The Narrows — dropping
    // it because we lack a sub-location would lose a fact we actually have.
    // The precision loss is recorded as a gap and becomes a spot record at D4.
    for (const token of [
      'The Narrows (north)',
      'The Eastern Road, near the Wishing Well',
      'The Eastern Road (in the ruins)',
    ]) {
      const result = resolver.resolveLocations([token], 'x')
      expect(result.locations).toHaveLength(1)
      expect(result.hasGap).toBe(true)
    }
  })

  it('does not let the fallback invent a place from an unknown qualifier', () => {
    // "Atlantis (north)" must not resolve just because it has a parenthetical.
    const result = resolver.resolveLocations(['Atlantis (north)'], 'x')
    expect(result.locations).toEqual([])
  })

  it('queues an unknown token instead of guessing at it', () => {
    const fresh = resolver.unresolved.length
    const result = resolver.resolveLocations(['Atlantis'], 'mystery_fish')
    expect(result.locations).toEqual([])
    expect(resolver.unresolved.length).toBe(fresh + 1)
    expect(resolver.unresolved.at(-1)?.token).toBe('Atlantis')
  })
})
