import { z } from 'zod'
import { MINUTES_PER_DAY, TIME_BLOCK_RANGES, TIME_BLOCKS, type TimeBlock } from './primitives.js'

/** `HH:MM` in 24-hour game time. */
export const TimeOfDay = z
  .string()
  .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, 'must be HH:MM in 24-hour time')
export type TimeOfDay = z.infer<typeof TimeOfDay>

/**
 * A time range in authored data. `to` may be less than `from`, meaning the range
 * wraps past midnight (a bug active 20:00-02:00).
 *
 * Wrapping is resolved at build time into non-wrapping minute intervals before
 * anything ships. Runtime code must never contain `if (start > end)` — that
 * check is the single most common source of correctness bugs in this class of
 * app, so the shape that requires it does not survive the build.
 */
export const TimeRange = z.object({
  from: TimeOfDay,
  to: TimeOfDay,
})
export type TimeRange = z.infer<typeof TimeRange>

export function toMinutes(time: TimeOfDay): number {
  const [h, m] = time.split(':')
  return Number(h) * 60 + Number(m)
}

export function fromMinutes(minutes: number): TimeOfDay {
  const normalised = ((minutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY
  const h = Math.floor(normalised / 60)
  const m = normalised % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/** A half-open `[start, end)` interval in minutes past midnight. Never wraps. */
export type MinuteInterval = readonly [number, number]

/**
 * Split an authored range into one or two non-wrapping minute intervals.
 *
 * `20:00 -> 02:00` becomes `[[1200, 1440], [0, 120]]`.
 * A range with `from === to` is treated as the whole day, since a zero-length
 * availability window is never what an author means.
 */
export function splitAtMidnight(range: TimeRange): MinuteInterval[] {
  const from = toMinutes(range.from)
  const to = toMinutes(range.to)
  if (from === to) return [[0, MINUTES_PER_DAY]]
  if (from < to) return [[from, to]]
  return [
    [from, MINUTES_PER_DAY],
    [0, to],
  ]
}

/** True if `minute` falls inside any of the intervals. */
export function inIntervals(intervals: readonly MinuteInterval[], minute: number): boolean {
  for (const [start, end] of intervals) {
    if (minute >= start && minute < end) return true
  }
  return false
}

/**
 * Which canonical UI blocks a set of intervals touches.
 *
 * Derived at build time from `time`, never hand-authored, so the two can't drift.
 */
export function blocksForIntervals(intervals: readonly MinuteInterval[]): TimeBlock[] {
  const touched: TimeBlock[] = []
  for (const block of TIME_BLOCKS) {
    const [start, end] = TIME_BLOCK_RANGES[block]
    const blockIntervals: MinuteInterval[] =
      start < end
        ? [[start, end]]
        : [
            [start, MINUTES_PER_DAY],
            [0, end],
          ]
    const overlaps = blockIntervals.some(([bs, be]) =>
      intervals.some(([is, ie]) => is < be && bs < ie),
    )
    if (overlaps) touched.push(block)
  }
  return touched
}
