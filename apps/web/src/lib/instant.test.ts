import { describe, expect, it } from 'vitest'
import { formatClock, formatDate, InstantSearch, legalWeather, weekdayOf } from './instant'

describe('InstantSearch', () => {
  it('reads params the router serialised as numbers', () => {
    expect(
      InstantSearch.parse({ season: 'fall', day: 12, year: 2, weather: 'rain', time: 960 }),
    ).toEqual({ season: 'fall', day: 12, year: 2, weather: 'rain', time: 960 })
  })

  it('reads the same params as strings, because a pasted URL has no types', () => {
    // The whole point of putting the instant in the URL is that an answer is
    // shareable. A shared link that throws is worse than no link.
    expect(
      InstantSearch.parse({ season: 'fall', day: '12', year: '2', weather: 'rain', time: '960' }),
    ).toEqual({ season: 'fall', day: 12, year: 2, weather: 'rain', time: 960 })
  })

  it('falls back rather than throwing on nonsense', () => {
    // A day of 99 should land you on day 1, not on an error page.
    expect(InstantSearch.parse({ day: 99, season: 'harvest', time: 'lunchtime' })).toEqual({
      season: 'spring',
      day: 1,
      year: 1,
      weather: 'clear',
      time: null,
    })
  })

  it('keeps "any time" as null rather than turning it into midnight', () => {
    // Null means the player has not narrowed by time, so the query returns
    // everything. Coercing it to 0 would silently answer a different question.
    expect(InstantSearch.parse({ time: null }).time).toBe(null)
    expect(InstantSearch.parse({ time: 'null' }).time).toBe(null)
    expect(InstantSearch.parse({}).time).toBe(null)
  })

  it('keeps midnight, which is not the same as no time at all', () => {
    expect(InstantSearch.parse({ time: 0 }).time).toBe(0)
  })
})

describe('formatClock', () => {
  it('reads as the game clock does', () => {
    expect(formatClock(0)).toBe('12:00 AM')
    expect(formatClock(6 * 60)).toBe('6:00 AM')
    expect(formatClock(12 * 60)).toBe('12:00 PM')
    expect(formatClock(16 * 60)).toBe('4:00 PM')
    expect(formatClock(23 * 60 + 59)).toBe('11:59 PM')
  })
})

describe('weekdayOf', () => {
  it('never drifts, because 28 days is exactly four weeks', () => {
    expect(weekdayOf(1)).toBe('Mon')
    expect(weekdayOf(8)).toBe('Mon')
    expect(weekdayOf(28)).toBe('Sun')
  })
})

describe('legalWeather', () => {
  it('snaps weather a season cannot have', () => {
    // Winter has no rain. Carrying it across a season change would let the app
    // be asked a question the game has no answer to.
    expect(legalWeather('winter', 'rain')).toBe('clear')
    expect(legalWeather('winter', 'snow')).toBe('snow')
    expect(legalWeather('spring', 'rain')).toBe('rain')
  })
})

describe('formatDate', () => {
  it('reads the way the game writes a date', () => {
    expect(formatDate({ season: 'fall', day: 12, year: 2 })).toBe('Fall 12 · Y2')
  })
})
