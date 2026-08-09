/**
 * "Where do I get this, and what does it take?" — one item's whole answer.
 *
 * The Today query asks which entities match one instant. This asks the reverse
 * of one entity, and answers with the windows themselves rather than with a
 * list of dates.
 *
 * **Refusing to invent a date is the design decision here, not a shortcut.**
 * Weather in Mistria is rolled per season, not scheduled: the game gives Fall
 * four to six wet days and does not say which. So "the next Storm is Fall 17"
 * would be a fabrication, and the fabrication is the tempting part — a date is
 * so much more satisfying to render than a frequency. Anything weather-gated
 * gets a frequency, drawn from the game's own seasonal counts.
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

/** One availability window, exactly as an item record ships it. */
export interface Window {
  method: string
  seasons: string[]
  /** `null` is "weather does not apply here", not "unknown". */
  weather: string[] | null
  locations: string[]
  /** The habitat the places were expanded from, when they were. */
  habitats?: string[]
  time: { from: string; to: string }[] | null
  time_precision: string
  rarity: string | null
  confidence: string
  requires: { type: string; key: string; op?: string; value?: unknown }[]
}

export interface Opportunity {
  /** How you get it — `fishing`, `dig_spot`, `apiary`. See `METHOD_LABELS`. */
  method: string
  /** The seasons this window covers, in calendar order. */
  seasons: Season[]
  /** The weathers it needs, or null when it does not narrow anything. */
  weather: Weather[] | null
  /**
   * Clock ranges as the record states them, rendered and never compared.
   *
   * Ten of them still wrap midnight (`20:00–02:00`, the night bugs) because the
   * split-at-build guarantee holds for the flat rules index and not for
   * `items.json`. Nothing here works out which side of midnight a range is on —
   * see apps/web/CLAUDE.md §3 — which is why this page has no "available now".
   */
  time: { from: string; to: string }[]
  /** 1 when an empty `time` is a fact — the method has no clock — not a gap. */
  timeIsAnyTime: boolean
  /**
   * Every place this one window covers, kept together rather than split into a
   * row each.
   *
   * The screen this was folded in from split them, and rightly — each of its
   * rows carried its own countdown, so three ponds really were three answers.
   * With no date to differ on, splitting produced three cards identical but for
   * the place name, each repeating the same weather sentence. The map still
   * pins every one of them, which is where "three ponds is three places to go"
   * actually gets answered.
   */
  locationIds: string[]
  rarity: string | null
  requires: { type: string; key: string; op?: string; value?: unknown }[]
  /** True when the places were deduced from a habitat rather than sourced. */
  placesInferred: boolean
  /** `ocean`, `pond`, `river` — what they were deduced from, when stated. */
  habitat: string | null
}

/** Every weather the mask allows, in the canonical order. */
export function weathersOf(mask: number): Weather[] {
  return WEATHERS.filter((weather) => (mask & WEATHER_BIT[weather]) !== 0)
}

/** Every season the mask allows, in calendar order. */
export function seasonsOf(mask: number): Season[] {
  return SEASONS.filter((season) => (mask & SEASON_BIT[season]) !== 0)
}

/**
 * The inverses, for records that ship names rather than masks.
 *
 * Unknown names are dropped rather than throwing: a season the schema gains
 * later must not take a page down, and the bit it would have set is one this
 * build has no meaning for anyway.
 */
export const maskOfSeasons = (seasons: readonly string[]): number =>
  seasons.reduce((mask, s) => mask | (SEASON_BIT[s as Season] ?? 0), 0)

export const maskOfWeathers = (weathers: readonly string[]): number =>
  weathers.reduce((mask, w) => mask | (WEATHER_BIT[w as Weather] ?? 0), 0)

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
 * Every way to get one item, one card per place.
 *
 * **Read from the item's own windows and not from the flat rules index**, which
 * looks like the obvious source and is the wrong one three times over: the index
 * drops eleven items whose only method is a machine (`apiary`, `terrarium`), it
 * keys rows by entity *kind* so a fish's page would say "Fish" where the window
 * says "Fishing", and its requirements are display-name strings that have to be
 * matched back to ids. The window carries the method, the string rarity and
 * requirement objects with real ids, so every link it produces is exact.
 *
 * One entry per window, and every window keeps all of its places.
 */
export function opportunitiesFromWindows(
  windows: readonly Window[],
  odds?: WeatherOddsTable,
): Opportunity[] {
  const found: Opportunity[] = []

  for (const window of windows) {
    const seasons = seasonsOf(maskOfSeasons(window.seasons))

    // Gated only when the window excludes weather its own seasons could
    // otherwise produce. Comparing against all six instead would call a winter
    // fish weather-gated for not biting in the rain, and winter has no rain —
    // four fifths of the dataset would wear a label that narrows nothing.
    // `null` weather is "does not apply", which narrows nothing either.
    const stated = window.weather === null ? [] : weathersOf(maskOfWeathers(window.weather))
    const possible = possibleWeather(seasons, odds)
    const gated = stated.length > 0 && possible.some((w) => !stated.includes(w))

    found.push({
      method: window.method,
      seasons,
      weather: gated ? stated : null,
      time: window.time ?? [],
      timeIsAnyTime: window.time === null && window.time_precision === 'not_applicable',
      // A window naming no place is still a way to get the thing — a machine,
      // a shop line — and dropping it would lose the row entirely.
      locationIds: window.locations,
      rarity: window.rarity,
      requires: window.requires,
      placesInferred: window.confidence === 'inferred',
      habitat: window.habitats?.[0] ?? null,
    })
  }

  return found
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
