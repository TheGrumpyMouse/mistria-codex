/**
 * "When can I next get this?" — the reverse of the Today query.
 *
 * Same index, walked the other way. `findAvailable` asks which entities match
 * one instant; this asks which instants match one entity, and answers with the
 * rules themselves rather than with a list of dates.
 *
 * **That is the whole design decision, and it is not a shortcut.** Weather in
 * Mistria is rolled per season, not scheduled: the game gives Fall four to six
 * wet days and does not say which. So "the next Storm is Fall 17" would be a
 * fabrication, and the fabrication is the tempting part — a date is so much more
 * satisfying to render than a frequency. A rule that needs weather gets a
 * frequency, drawn from the game's own seasonal counts, and never a date.
 *
 * A rule that does *not* need weather has a real answer, and gets one: the day
 * its season next starts, counted forward from now. Keeping those two cases
 * apart is what makes the date trustworthy where it appears.
 */
import {
  DAYS_PER_SEASON,
  SEASON_BIT,
  SEASON_LEGAL_WEATHER,
  SEASONS,
  type Season,
  WEATHER_BIT,
  WEATHERS,
  type Weather,
} from '@mistria/schema'
import type { Instant, Rule } from './findable'

/** How often a weather happens, as shipped in `meta.json`. */
export interface WeatherOdds {
  /**
   * The game weather class this is drawn from.
   *
   * Load-bearing. Rain and storm share the `inclement` pool — they are the same
   * four-to-six wet days seen twice — so anything that adds their counts reports
   * twelve wet days in a twenty-eight day season.
   */
  pool: string
  /** The **pool's** days per season, not this weather's share of them. */
  minDays: number
  maxDays: number
  /** True when this weather is the pool's only member in this season. */
  exact: boolean
}

export type WeatherOddsTable = Record<string, Record<string, WeatherOdds>>

export interface Opportunity {
  rule: Rule
  /** The seasons this rule can fire in, in calendar order. */
  seasons: Season[]
  /** The weathers it needs, or null when it does not care. */
  weather: Weather[] | null
  /** Minute intervals, already split at midnight by the build. */
  time: [number, number][]
  locationId: string | null
  requires: string[]
  /**
   * Days until this rule's season next comes round, or null when it cannot be
   * counted — either because it is available now, or because the rule needs
   * weather and no date can be honest about that.
   */
  daysAway: number | null
  /** True when the rule matches the instant asked about. */
  availableNow: boolean
  /**
   * Why there is no date, when there is none. Null when `daysAway` is set or
   * when the thing is available now.
   */
  noDateReason: 'weather' | null
}

const SEASON_ORDER: Record<Season, number> = { spring: 0, summer: 1, fall: 2, winter: 3 }

/** Every weather the mask allows, in the canonical order. */
export function weathersOf(mask: number): Weather[] {
  return WEATHERS.filter((weather) => (mask & WEATHER_BIT[weather]) !== 0)
}

/** Every season the mask allows, in calendar order. */
export function seasonsOf(mask: number): Season[] {
  return SEASONS.filter((season) => (mask & SEASON_BIT[season]) !== 0)
}

/**
 * Every weather that can actually occur across a set of seasons.
 *
 * Read off the shipped odds when they exist, because the game is stricter than
 * the schema's mask: `SEASON_LEGAL_WEATHER` allows wind in all four seasons and
 * the game gives summer and winter no windy days at all. Falling back to the
 * mask keeps a clone with no odds working, one notch less precise.
 */
export function possibleWeather(seasons: Season[], odds: WeatherOddsTable | undefined): Weather[] {
  const found = new Set<Weather>()

  for (const season of seasons) {
    const row = odds?.[season]
    // Per season, not per table. A missing season must widen to the schema's
    // mask rather than contribute nothing — contributing nothing would make
    // every rule in that season look unrestricted, and the app would start
    // handing out dates for weather it cannot predict. Wrong in the one
    // direction this whole module exists to avoid.
    if (row === undefined) {
      for (const weather of weathersOf(SEASON_LEGAL_WEATHER[season])) found.add(weather)
      continue
    }
    for (const [weather, odd] of Object.entries(row)) {
      if (odd.maxDays > 0 && (WEATHERS as readonly string[]).includes(weather)) {
        found.add(weather as Weather)
      }
    }
  }

  return WEATHERS.filter((w) => found.has(w))
}

/**
 * Days from one instant to the first day of the next occurrence of a season.
 *
 * Zero when that season is the current one — you are already in it, and the
 * thing is available today or later this season either way. The year is 112
 * days, so this never exceeds 84.
 */
export function daysUntilSeason(from: Instant, season: Season): number {
  const current = SEASON_ORDER[from.season]
  const target = SEASON_ORDER[season]
  if (current === target) return 0

  const seasonsAhead = (target - current + 4) % 4
  return seasonsAhead * DAYS_PER_SEASON - (from.day - 1)
}

/**
 * Every way to get one entity, soonest first.
 *
 * Rules are not deduplicated across locations: three ponds is three places to
 * go, and collapsing them would answer "where" with a shrug. They are ordered
 * by how soon they can happen, with anything available right now first.
 */
export function opportunitiesFor(
  rules: Rule[],
  locations: string[],
  entityId: string,
  from: Instant,
  matches: (rule: Rule, instant: Instant) => boolean,
  odds?: WeatherOddsTable,
): Opportunity[] {
  const found: Opportunity[] = []

  for (const rule of rules) {
    if (rule.e !== entityId) continue

    const seasons = seasonsOf(rule.sea)
    const weather = weathersOf(rule.wx)

    // Gated only if the rule excludes weather that could otherwise happen in
    // its own seasons. Comparing against all six instead would call a winter
    // fish weather-gated for not biting in the rain, and winter has no rain —
    // it would refuse a date that is perfectly honest to give.
    const possible = possibleWeather(seasons, odds)
    const gatedByWeather = weather.length > 0 && possible.some((w) => !weather.includes(w))
    const availableNow = matches(rule, from)

    const soonest = seasons.reduce<number | null>((best, season) => {
      const days = daysUntilSeason(from, season)
      return best === null || days < best ? days : best
    }, null)

    found.push({
      rule,
      seasons,
      weather: gatedByWeather ? weather : null,
      time: rule.t,
      locationId: rule.loc === null ? null : (locations[rule.loc] ?? null),
      requires: rule.req,
      daysAway: availableNow || gatedByWeather ? null : soonest,
      availableNow,
      noDateReason: !availableNow && gatedByWeather ? 'weather' : null,
    })
  }

  return found.sort((a, b) => {
    if (a.availableNow !== b.availableNow) return a.availableNow ? -1 : 1
    const aDays = a.daysAway ?? Number.POSITIVE_INFINITY
    const bDays = b.daysAway ?? Number.POSITIVE_INFINITY
    return aDays - bDays
  })
}

/**
 * How many days of a season satisfy *any* of a set of weathers.
 *
 * **Grouped by pool, then added.** A rule needing rain or storm is satisfied on
 * any of the season's four-to-six wet days, not on eight to twelve of them —
 * rain and storm are one pool seen twice. Adding the entries would report a
 * twelve-day rainy season and read exactly like a fact.
 *
 * A pool counts as exactly known when the rule asks for every one of its members
 * that this season has: rain-or-storm is the whole `inclement` pool, so its
 * four-to-six is precise, while storm alone is a share of that pool and is
 * therefore an upper bound.
 *
 * Null when nothing was shipped, which is a real state and not an error: a clone
 * whose sources predate the extraction has no counts, and saying nothing is the
 * correct output.
 */
export function oddsFor(
  odds: WeatherOddsTable | undefined,
  season: Season,
  weathers: Weather[],
): WeatherOdds | null {
  const inSeason = odds?.[season]
  if (inSeason === undefined) return null

  const wanted = weathers.flatMap((w) => {
    const row = inSeason[w]
    return row === undefined ? [] : [{ weather: w, row }]
  })
  if (wanted.length === 0) return null

  const pools = new Map<string, { row: WeatherOdds; asked: number; members: number }>()
  for (const { row } of wanted) {
    const existing = pools.get(row.pool)
    pools.set(row.pool, { row, asked: (existing?.asked ?? 0) + 1, members: 0 })
  }
  for (const row of Object.values(inSeason)) {
    const pool = pools.get(row.pool)
    if (pool !== undefined) pool.members += 1
  }

  const totals = [...pools.values()]
  return {
    // The pool of the first weather asked for. Only meaningful when one pool is
    // involved, and nothing reads it in the multi-pool case.
    pool: totals.length === 1 ? (totals[0]?.row.pool ?? '') : 'mixed',
    minDays: Math.min(
      DAYS_PER_SEASON,
      totals.reduce((n, p) => n + p.row.minDays, 0),
    ),
    maxDays: Math.min(
      DAYS_PER_SEASON,
      totals.reduce((n, p) => n + p.row.maxDays, 0),
    ),
    exact: totals.every((p) => p.asked >= p.members),
  }
}

/**
 * The weather requirement as one sentence fragment, across every season the
 * rule fires in.
 *
 * Written as one line rather than one per season because the common case is a
 * rule with a single season, and the four-season case would otherwise print
 * four near-identical clauses. Where the seasons disagree, each is named — the
 * shape of the answer follows the data instead of a fixed template.
 */
export function oddsPhrase(
  odds: WeatherOddsTable | undefined,
  seasons: Season[],
  weathers: Weather[],
): string | null {
  const rows = seasons.flatMap((season) => {
    const row = oddsFor(odds, season, weathers)
    return row === null ? [] : [{ season, row }]
  })
  if (rows.length === 0) return null

  const first = rows[0]?.row
  if (first === undefined) return null
  const uniform = rows.every(
    (r) =>
      r.row.minDays === first.minDays &&
      r.row.maxDays === first.maxDays &&
      r.row.exact === first.exact,
  )

  if (uniform) {
    const scope =
      rows.length === SEASONS.length
        ? 'every season'
        : `every ${joinSeasons(rows.map((r) => r.season))}`
    return `${count(first)} of ${scope}`
  }

  return rows.map((r) => `${count(r.row)} in ${r.season}`).join(', ')
}

/**
 * `4–6 days`, or `at most 4–6 days`.
 *
 * The hedge is not politeness. `exact: false` means the game publishes the pool
 * a weather is drawn from and not its own share — a storm comes out of the same
 * four-to-six wet days as rain — so a flat "4–6 days" would state a number the
 * files do not contain.
 */
function count(row: WeatherOdds): string {
  const days = row.minDays === row.maxDays ? `${row.minDays}` : `${row.minDays}–${row.maxDays}`
  const noun = row.maxDays === 1 ? 'day' : 'days'
  return row.exact ? `${days} ${noun}` : `at most ${days} ${noun}`
}

const joinSeasons = (seasons: Season[]): string =>
  seasons.length <= 1
    ? (seasons[0] ?? '')
    : `${seasons.slice(0, -1).join(', ')} and ${seasons[seasons.length - 1]}`
