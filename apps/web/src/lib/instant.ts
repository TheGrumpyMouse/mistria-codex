import { DAYS_PER_SEASON, SEASONS, type Season, WEATHERS, type Weather } from '@mistria/schema'
import { z } from 'zod'

/**
 * The instant the app is answering for: a date, a weather, and a time.
 *
 * **It lives in the URL**, validated, because it is the whole state of the
 * flagship screen. That makes an answer linkable, survivable across a reload,
 * and back-buttonable — and it keeps the alternative (a store, plus
 * string-munging on every read) out of the codebase entirely.
 */
/**
 * Read a search param that should be a number.
 *
 * A param arrives as a string when someone types or pastes the URL, and as a
 * number when the router serialised it itself. Both have to work: the whole
 * point of putting the instant in the URL is that an answer is shareable, and
 * a shared link that throws is worse than no link at all.
 *
 * Anything unreadable falls through to `undefined` so the field's default
 * applies — a nonsense `day=99` should land you on day 1, not on an error page.
 */
const numeric = z.preprocess((value) => {
  if (typeof value === 'number') return value
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (trimmed === '' || trimmed === 'null' || trimmed === 'undefined') return null
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : undefined
}, z.number().nullable())

export const InstantSearch = z.object({
  season: z.enum(SEASONS).catch('spring').default('spring'),
  day: numeric.pipe(z.number().int().min(1).max(DAYS_PER_SEASON)).catch(1).default(1),
  year: numeric.pipe(z.number().int().min(1)).catch(1).default(1),
  weather: z.enum(WEATHERS).catch('clear').default('clear'),
  /**
   * Minutes past midnight, or null for "any time".
   *
   * Null is a real answer and not a missing one: it means the player has not
   * narrowed by time, and the query should return everything rather than
   * assume midnight.
   */
  time: numeric.pipe(z.number().int().min(0).max(1439).nullable()).catch(null).default(null),
})
export type InstantSearch = z.infer<typeof InstantSearch>

export interface Instant {
  season: Season
  day: number
  year: number
  weather: Weather
  time: number | null
}

/** `4:00 PM`. Twelve-hour, because that is how the game's clock reads. */
export function formatClock(minutes: number): string {
  const hour24 = Math.floor(minutes / 60)
  const minute = minutes % 60
  const meridiem = hour24 < 12 ? 'AM' : 'PM'
  const hour = hour24 % 12 === 0 ? 12 : hour24 % 12
  return `${hour}:${String(minute).padStart(2, '0')} ${meridiem}`
}

/** `Fall 12 · Y2`. */
export const formatDate = (instant: Pick<Instant, 'season' | 'day' | 'year'>): string =>
  `${titleCase(instant.season)} ${instant.day} · Y${instant.year}`

export const titleCase = (word: string): string => word.charAt(0).toUpperCase() + word.slice(1)

/**
 * Which day of the week a date falls on.
 *
 * A Mistria season is 28 days, which is four seven-day weeks exactly, so the
 * weekday is a pure function of the day number and never drifts across seasons
 * or years. That is also why the Day Dial is a 4x7 grid: the calendar really is
 * that shape, so the grid is not a layout choice imposed on the data.
 */
export const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const

export const weekdayOf = (day: number): (typeof DAY_NAMES)[number] =>
  DAY_NAMES[(day - 1) % 7] ?? 'Mon'

/**
 * Weather a season can physically have.
 *
 * Winter has no rain and summer has no snow. The picker only offers what the
 * season allows, so the app can never be asked a question the game has no
 * answer to.
 */
export const SEASON_WEATHER: Readonly<Record<Season, readonly Weather[]>> = {
  spring: ['clear', 'rain', 'storm', 'wind'],
  summer: ['clear', 'rain', 'storm', 'wind'],
  fall: ['clear', 'rain', 'storm', 'wind'],
  winter: ['clear', 'snow', 'blizzard', 'wind'],
}

/** Snap a weather that the new season cannot have back to something it can. */
export const legalWeather = (season: Season, weather: Weather): Weather =>
  SEASON_WEATHER[season].includes(weather) ? weather : 'clear'
