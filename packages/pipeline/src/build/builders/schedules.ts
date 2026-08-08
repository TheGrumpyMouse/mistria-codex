import type { DayOfWeek, Schedule, ScheduleBlock, Season, TimeOfDay } from '@mistria/schema'
import { toSnakeId } from '@mistria/schema'
import type { ExtractedStop, ExtractedTable } from '../../enrich/schedules.js'
import type { BuildContext } from '../context.js'

/**
 * Turn the wiki's schedule tables into priority-ordered overrides.
 *
 * Three characters of thirty-four have anything to build from; the rest get an
 * empty schedule and a `schedule` gap, which is the honest shape and the one
 * the coverage report counts. See `curated/vocab/schedules.json` for why the
 * plan's "twelve romanceables first" is not available from this source.
 *
 * The interesting work is all in what gets refused:
 *
 * - **Rainy and Friday-night tables are not turned into entries.** Both select
 *   between several tables using a counter the player cannot see. First match
 *   wins would pick the first variant and render a coin flip as a fact, so the
 *   schedule records a gap naming how many ways it varies.
 * - **A stop whose place we cannot resolve leaves a hole**, rather than letting
 *   the previous block stretch over it. "Unknown at 4pm" is true; "still at the
 *   Inn at 4pm" is not.
 */

type Entry = Schedule['entries'][number]

/**
 * `6:00 AM`, `06:00`, `2am`, `7:00am` — and nothing else.
 *
 * Anchored, and the minutes are only optional when a meridiem says it is a
 * time. Unanchored, this read "1 Day Post" as one o'clock, which is a bedtime
 * invented out of a phrase that names no time at all.
 */
const CLOCK = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i

/**
 * Read a schedule table's time cell.
 *
 * Returns null for `1 Day Post`, which is how some tables say "and then home,
 * some time after midnight". There is no time in that, and inventing a bedtime
 * to fill it in would be worse than the hole it leaves.
 */
export function parseClock(raw: string): TimeOfDay | null {
  // A trailing "(next day)" is not part of the time — 12:10 AM is 00:10 either
  // way, and the note is the wiki telling a reader the day has rolled over.
  const text = raw.replace(/\([^)]*\)/g, '').trim()
  if (text === '' || !/\d/.test(text)) return null

  const match = CLOCK.exec(text)
  if (match === null) return null

  let hour = Number(match[1])
  const minute = Number(match[2] ?? '0')
  const meridiem = match[3]?.toLowerCase()
  // A bare number with no minutes and no am/pm is not a time. "6" could be
  // either end of the day, and the tables never write one.
  if (match[2] === undefined && meridiem === undefined) return null
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || minute > 59) return null

  if (meridiem === 'am') hour = hour === 12 ? 0 : hour
  else if (meridiem === 'pm') hour = hour === 12 ? 12 : hour + 12
  if (hour > 23) return null

  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

/**
 * Split a schedule place into the place and the anchor inside it.
 *
 * `Manor: Adeline's Bedroom` and `Inn (South Table Bottom 1)` are the same
 * shape written two ways, and `Town` is neither.
 */
export function splitPlace(raw: string): { place: string; detail: string | null } {
  const split = /^([^:(]+?)\s*(?::|\()\s*(.*)$/.exec(raw.trim())
  if (split === null) return { place: raw.trim(), detail: null }

  const detail = (split[2] ?? '').replace(/\)\s*$/, '').trim()
  return { place: (split[1] ?? '').trim(), detail: detail === '' ? null : detail }
}

/**
 * Turn stops into blocks.
 *
 * A stop says "from now, be here"; a block needs an end, which is the next
 * stop's start. The last block wraps to the first stop's time, because a
 * schedule is a cycle — and the wrap is split at midnight here so nothing
 * downstream has to know it ever existed.
 */
export function blocksFromStops(
  stops: { time: TimeOfDay; location_id: string | null; activity_key: string | null }[],
): ScheduleBlock[] {
  const blocks: ScheduleBlock[] = []

  for (const [index, stop] of stops.entries()) {
    // An unresolved place still ends the previous block — it just does not
    // start one of its own. That is what leaves the hole rather than a lie.
    if (stop.location_id === null) continue

    const next = stops[(index + 1) % stops.length]
    if (next === undefined) continue
    const to = next.time

    const base = {
      location_id: stop.location_id,
      x: null,
      y: null,
      activity_key: stop.activity_key,
    }
    if (stop.time < to) {
      blocks.push({ from: stop.time, to, ...base })
    } else if (stop.time > to) {
      // Past midnight. `to: "00:00"` is the end of the day, never the start.
      blocks.push({ from: stop.time, to: '00:00', ...base })
      if (to !== '00:00') blocks.push({ from: '00:00', to, ...base })
    } else if (stops.length === 1) {
      // A one-stop day is all day, not a zero-length instant.
      blocks.push({ from: '00:00', to: '00:00', ...base })
    }
  }

  return blocks
}

const DAY_IDS: DayOfWeek[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']

export function buildSchedules(ctx: BuildContext): Schedule[] {
  const vocab = ctx.scheduleVocab
  const seasonOf = new Map(
    Object.entries(vocab.seasonHeadings).map(([season, heading]) => [
      heading.toLowerCase(),
      season,
    ]),
  )
  const dayOf = new Map(
    vocab.dayHeadings.map((heading, index) => [heading.toLowerCase(), DAY_IDS[index]] as const),
  )
  const gateRe = new RegExp(vocab.gatePattern, 'i')

  const byCharacter = new Map(ctx.schedules.schedules.map((s) => [s.character, s] as const))

  return ctx.characterRules.roster.map((character): Schedule => {
    const characterId = toSnakeId(character)
    const extracted = byCharacter.get(character)
    if (extracted === undefined) {
      return { character_id: characterId, entries: [], data_gaps: ['schedule'] }
    }

    const gaps = new Set<string>()
    const entries: Entry[] = []

    for (const table of extracted.tables) {
      const unselectable = vocab.unselectableSections.find((u) =>
        table.section.toLowerCase().startsWith(u.prefix.toLowerCase()),
      )
      if (unselectable !== undefined) {
        gaps.add(unselectable.gap)
        continue
      }

      const season = seasonOf.get(table.section.toLowerCase())
      const day = dayOf.get(table.group.toLowerCase())
      if (season === undefined || day === undefined) {
        gaps.add('unmapped_sections')
        continue
      }

      const entry = entryFor(ctx, table, season as Season, day, gateRe, characterId, gaps)
      if (entry !== null) entries.push(entry)
    }

    // Every day of every season that produced no entry at all.
    if (entries.length < DAY_IDS.length * seasonOf.size) gaps.add('partial_schedule')

    return {
      character_id: characterId,
      // Lower priority first, so a consumer takes the first match and stops.
      // Ties keep source order, which is season then day.
      entries: entries.sort((a, b) => a.priority - b.priority),
      data_gaps: [...gaps].sort(),
    }
  })
}

/** Gated tables outrank the plain one; "after the quest" outranks "before". */
const PRIORITY = { after: 10, before: 20, plain: 30 } as const

function entryFor(
  ctx: BuildContext,
  table: ExtractedTable,
  season: Season,
  day: DayOfWeek,
  gateRe: RegExp,
  characterId: string,
  gaps: Set<string>,
): Entry | null {
  const gate = table.variant === null ? null : gateRe.exec(table.variant)
  const phase = gate?.[1]?.toLowerCase() === 'after' ? 'after' : gate === null ? 'plain' : 'before'
  const quest = gate?.[2]?.trim() ?? null

  if (table.variant !== null && gate === null) {
    // A sub-heading we do not understand is not a schedule we can gate, and
    // emitting it ungated would apply a conditional table unconditionally.
    gaps.add('unmapped_variants')
    return null
  }

  const stops = table.stops.flatMap((stop) => resolveStop(ctx, stop, characterId, gaps))
  if (stops.length === 0) return null

  const blocks = blocksFromStops(stops)
  if (blocks.length === 0) return null

  return {
    priority: PRIORITY[phase],
    label:
      quest === null
        ? `${table.section} ${table.group}`
        : `${table.section} ${table.group}, ${phase} ${quest}`,
    when: {
      seasons: [season],
      days: [day],
      weather: null,
      dates: null,
      requires:
        phase === 'after' && quest !== null
          ? [{ type: 'quest' as const, key: toSnakeId(quest), op: 'done' as const, value: null }]
          : [],
    },
    blocks,
  }
}

function resolveStop(
  ctx: BuildContext,
  stop: ExtractedStop,
  characterId: string,
  gaps: Set<string>,
): { time: TimeOfDay; location_id: string | null; activity_key: string | null }[] {
  const time = parseClock(stop.time)
  if (time === null) {
    // "1 Day Post" — the wiki's way of saying "and then home, after midnight".
    gaps.add('late_night')
    return []
  }

  // The split first, then the whole string — `Balor's Wagon` has no colon but
  // does have an apostrophe, and a place whose own name contains a bracket
  // should still resolve. Both spellings go in one call so a miss is reported
  // once rather than twice.
  const { place, detail } = splitPlace(stop.place)
  const locationId = ctx.resolver.locationId([place, stop.place], `schedule:${characterId}`)
  if (locationId === null) gaps.add('unresolved_places')

  return [
    {
      time,
      location_id: locationId,
      activity_key: detail === null ? null : toSnakeId(detail),
    },
  ]
}
