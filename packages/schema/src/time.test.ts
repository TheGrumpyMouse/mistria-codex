import { describe, expect, it } from 'vitest'
import { blocksForIntervals, fromMinutes, inIntervals, splitAtMidnight, toMinutes } from './time.js'

describe('minute conversion', () => {
  it('round-trips', () => {
    for (const t of ['00:00', '06:00', '13:45', '23:59']) {
      expect(fromMinutes(toMinutes(t))).toBe(t)
    }
  })

  it('wraps out-of-range minutes rather than producing nonsense', () => {
    expect(fromMinutes(24 * 60)).toBe('00:00')
    expect(fromMinutes(-60)).toBe('23:00')
  })
})

/**
 * Midnight wrapping is the highest-density bug area in this codebase, so it gets
 * its own block. The whole point of splitting at build time is that no runtime
 * code ever has to contain `if (start > end)`.
 */
describe('splitAtMidnight', () => {
  it('leaves a normal range alone', () => {
    expect(splitAtMidnight({ from: '06:00', to: '19:00' })).toEqual([[360, 1140]])
  })

  it('splits a range that crosses midnight into two non-wrapping intervals', () => {
    expect(splitAtMidnight({ from: '20:00', to: '02:00' })).toEqual([
      [1200, 1440],
      [0, 120],
    ])
  })

  it('treats an empty range as the whole day, since that is never what an author means', () => {
    expect(splitAtMidnight({ from: '00:00', to: '00:00' })).toEqual([[0, 1440]])
  })

  it('handles a range ending exactly at midnight', () => {
    expect(splitAtMidnight({ from: '18:00', to: '00:00' })).toEqual([
      [1080, 1440],
      [0, 0],
    ])
  })
})

describe('inIntervals', () => {
  const night = splitAtMidnight({ from: '20:00', to: '02:00' })

  it('matches on both sides of midnight', () => {
    expect(inIntervals(night, toMinutes('21:00'))).toBe(true)
    expect(inIntervals(night, toMinutes('01:00'))).toBe(true)
  })

  it('excludes the daytime gap between the two halves', () => {
    expect(inIntervals(night, toMinutes('05:00'))).toBe(false)
    expect(inIntervals(night, toMinutes('12:00'))).toBe(false)
    expect(inIntervals(night, toMinutes('19:59'))).toBe(false)
  })

  it('is half-open — the start is inside, the end is not', () => {
    expect(inIntervals([[360, 1140]], 360)).toBe(true)
    expect(inIntervals([[360, 1140]], 1140)).toBe(false)
  })
})

describe('blocksForIntervals', () => {
  it('derives the blocks a daytime window touches', () => {
    const intervals = splitAtMidnight({ from: '06:00', to: '19:00' })
    expect(blocksForIntervals(intervals)).toEqual(['morning', 'day', 'evening'])
  })

  it('maps a wrapping window to night alone', () => {
    const intervals = splitAtMidnight({ from: '20:00', to: '02:00' })
    expect(blocksForIntervals(intervals)).toEqual(['night'])
  })

  it('covers every block for an all-day window', () => {
    expect(blocksForIntervals([[0, 1440]])).toEqual(['morning', 'day', 'evening', 'night'])
  })
})
