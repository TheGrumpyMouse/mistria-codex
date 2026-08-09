/**
 * "What can I find right now?" — the question the whole app exists to answer.
 *
 * This is a reference implementation over `data/`, not the shipped engine. The
 * app's engine (milestone A4) works on the flattened, bitmasked
 * `availability.json` for speed. This one reads the reviewable records directly
 * and is the proof that the availability model can actually answer the question
 * before any UI exists.
 *
 * Run: `pnpm --filter @mistria/pipeline exec tsx src/demo/findables.ts \
 *        --season fall --weather rain --time 19:00`
 */
import { join } from 'node:path'
import { argv } from 'node:process'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import {
  type AvailabilityWindow,
  DAYS_PER_SEASON,
  type Item,
  inIntervals,
  type Location,
  SEASONS,
  type Season,
  splitAtMidnight,
  toMinutes,
  WEATHERS,
  type Weather,
} from '@mistria/schema'
import { consola } from 'consola'
import { FINDABLE_METHODS } from '../build/availability.js'
import { DATA_DIR } from '../lib/paths.js'
import { readJsonFile } from '../lib/read-json.js'

export interface QueryContext {
  season: Season
  day: number
  weather: Weather
  minute: number
}

export interface Match {
  item: Item
  window: AvailabilityWindow
  /** Constraints we had no data for. The UI badges these rather than hiding them. */
  unknowns: string[]
  /** Gates the player may not have met. Shown as locked, never filtered away. */
  locked: string[]
}

/**
 * Does this window match the moment?
 *
 * The load-bearing rule: **unknown does not exclude.** A null weather or time
 * means nobody recorded it, and treating that as "no" would quietly hide correct
 * answers — far worse than showing one marked uncertain. Every null that let a
 * window through is reported in `unknowns` so the caller must acknowledge it.
 */
export function matches(window: AvailabilityWindow, ctx: QueryContext): Match['unknowns'] | null {
  const unknowns: string[] = []

  if (!window.seasons.includes(ctx.season)) return null

  if (window.dates !== null) {
    // A festival forageable is only there on its days.
    if (!window.dates.some((d) => d.season === ctx.season && d.day === ctx.day)) return null
  }

  if (window.weather === null) {
    if (window.weather_precision === 'unknown') unknowns.push('weather')
    // `not_applicable` (a cave) is a real answer, not a gap.
  } else if (!window.weather.includes(ctx.weather)) {
    return null
  }

  if (window.time === null) {
    if (window.time_precision === 'unknown') unknowns.push('time')
  } else {
    const intervals = window.time.flatMap((range) => splitAtMidnight(range))
    if (!inIntervals(intervals, ctx.minute)) return null
  }

  if (window.locations.length === 0) unknowns.push('location')

  return unknowns
}

export async function findables(ctx: QueryContext): Promise<Match[]> {
  const items = await readJsonFile<Item[]>(join(DATA_DIR, 'items.json'))
  const results: Match[] = []

  for (const item of items) {
    for (const window of item.availability) {
      // The same set the shipped flattener buckets by. A window whose method
      // answers no season/weather/time question — a letter, a museum reward
      // tier, a quest hand-over — is a fact about the item, not an answer to
      // "what can I find right now", and this query is the reference
      // implementation of that question.
      if (!FINDABLE_METHODS.has(window.method)) continue
      const unknowns = matches(window, ctx)
      if (unknowns === null) continue
      results.push({
        item,
        window,
        unknowns,
        locked: window.requires.map((r) => `${r.type}:${r.key}`),
      })
    }
  }

  return results
}

function parseContext(): QueryContext {
  const { values } = parseArgs({
    options: {
      season: { type: 'string', default: 'fall' },
      day: { type: 'string', default: '12' },
      weather: { type: 'string', default: 'rain' },
      time: { type: 'string', default: '19:00' },
    },
  })

  const season = values.season as Season
  const weather = values.weather as Weather
  if (!SEASONS.includes(season)) throw new Error(`--season must be one of ${SEASONS.join(', ')}`)
  if (!WEATHERS.includes(weather))
    throw new Error(`--weather must be one of ${WEATHERS.join(', ')}`)

  const day = Number(values.day)
  if (!Number.isInteger(day) || day < 1 || day > DAYS_PER_SEASON) {
    throw new Error(`--day must be 1..${DAYS_PER_SEASON}`)
  }

  return { season, day, weather, minute: toMinutes(values.time as `${number}:${number}`) }
}

async function main(): Promise<void> {
  const ctx = parseContext()
  const locations = await readJsonFile<Location[]>(join(DATA_DIR, 'locations.json'))
  const locationName = new Map(locations.map((l) => [l.id, l.name]))

  const results = await findables(ctx)

  consola.log(
    `\n${ctx.season} ${ctx.day}, ${ctx.weather}, ${String(Math.floor(ctx.minute / 60)).padStart(2, '0')}:${String(ctx.minute % 60).padStart(2, '0')} — ${results.length} findable\n`,
  )

  const byCategory = new Map<string, Match[]>()
  for (const match of results) {
    const list = byCategory.get(match.item.category) ?? []
    list.push(match)
    byCategory.set(match.item.category, list)
  }

  for (const [category, matchList] of [...byCategory].sort()) {
    consola.log(`${category.toUpperCase()} (${matchList.length})`)
    for (const { item, window, unknowns, locked } of matchList.slice(0, 12)) {
      const where =
        window.locations.length > 0
          ? window.locations.map((id) => locationName.get(id) ?? id).join(', ')
          : window.habitats.length > 0
            ? `${window.habitats.join('/')} (which one is unknown)`
            : 'location unknown'

      const flags = [
        unknowns.length > 0 ? `?${unknowns.join(',')}` : '',
        locked.length > 0 ? `locked:${locked.join(',')}` : '',
        window.rarity ?? '',
      ]
        .filter(Boolean)
        .join(' ')

      const price = item.sell_value === null ? '—' : `${item.sell_value}t`
      consola.log(
        `  ${item.name.padEnd(24)} ${window.method.padEnd(13)} ${where.padEnd(34)} ${price.padStart(6)}  ${flags}`,
      )
    }
    if (matchList.length > 12) consola.log(`  ... and ${matchList.length - 12} more`)
    consola.log('')
  }

  const withUnknownTime = results.filter((r) => r.unknowns.includes('time')).length
  const withUnknownLocation = results.filter((r) => r.unknowns.includes('location')).length
  consola.info(
    `Honesty check: ${withUnknownTime}/${results.length} have unknown time, ` +
      `${withUnknownLocation}/${results.length} have no concrete location. ` +
      'Those are shown, badged — not hidden.',
  )
}

const entry = argv[1]
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  main().catch((err: unknown) => {
    consola.error(err instanceof Error ? err.message : err)
    process.exitCode = 1
  })
}
