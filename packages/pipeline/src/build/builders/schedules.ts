import type {
  DayOfWeek,
  Schedule,
  ScheduleBlock,
  Season,
  TimeOfDay,
  Weather,
} from '@mistria/schema'
import { toSnakeId } from '@mistria/schema'
import { consola } from 'consola'
import type { ExtractedStop, ExtractedTable } from '../../enrich/schedules.js'
import type { BuildContext } from '../context.js'
import { buildLocations } from './fish-crops.js'
import { foldPlaceName } from './grants.js'

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

export function buildSchedules(ctx: BuildContext, shippedQuestIds?: Set<string>): Schedule[] {
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
  const game = gameEntries(ctx, shippedQuestIds)

  const built = ctx.characterRules.roster.map((character): Schedule => {
    const characterId = toSnakeId(character)
    const extracted = byCharacter.get(character)
    const fromGame = game.entriesByCharacter.get(characterId) ?? []

    const gaps = new Set<string>(fromGame.length > 0 ? game.gapsByCharacter.get(characterId) : [])
    const entries: Entry[] = [...fromGame]

    for (const table of extracted?.tables ?? []) {
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

    if (entries.length === 0) {
      return { character_id: characterId, entries: [], data_gaps: ['schedule'] }
    }

    // The game's default week covers six days; Fridays and rain still vary on
    // conditions nobody models, and both stay said.
    if (fromGame.length > 0) {
      gaps.add('friday_variants')
      gaps.add('rain_variants')
    } else if (entries.length < DAY_IDS.length * seasonOf.size) {
      gaps.add('partial_schedule')
    }

    return {
      character_id: characterId,
      // Lower priority first, so a consumer takes the first match and stops.
      // Ties keep source order, which is season then day.
      entries: entries.sort((a, b) => a.priority - b.priority),
      data_gaps: [...gaps].sort(),
    }
  })

  const covered = built.filter((s) => s.entries.length > 0).length
  consola.info(`schedules: ${covered}/${built.length} characters carry a routine`)
  return built
}

/**
 * The game's own weekday routines, as priority-ordered entries.
 *
 * The reading that makes this correct: **a schedule file states its own
 * conditions, and the season directories are shelving.** `fall_monday` says
 * `season = "fall"`; the files under "Spring Schedules" mostly state no season
 * because they are the defaults every season falls back to. Priorities mirror
 * the game's own specificity — market upgrades above the market, seasonal
 * overrides above the default week — so first-match-wins resolves exactly as
 * the game does.
 *
 * A file whose conditions carry a key nobody models (`rain_counter`, the
 * FNATI groups) is **skipped whole and the variance said as a gap** — first
 * match would render a hidden counter's coin flip as a fact.
 *
 * The schedule weather words are their own vocabulary: `pleasant` is the
 * calm/special classes (clear, wind), `snowy`/`rainy` the inclement ones.
 * The mapping mirrors curated/vocab/weather.json's class reasoning.
 */
const SCHEDULE_WEATHER: Record<string, Weather[]> = {
  pleasant: ['clear', 'wind'],
  snowy: ['snow', 'blizzard'],
  rainy: ['rain', 'storm'],
}

/** Group -> priority band. Lower is checked first; more specific sits lower. */
const GROUP_PRIORITY: Record<string, number> = {
  'Upgraded Market Schedules/Upgrade Two': 2,
  'Upgraded Market Schedules/Upgrade One': 4,
}

function gameEntries(
  ctx: BuildContext,
  shippedQuestIds?: Set<string>,
): {
  entriesByCharacter: Map<string, Entry[]>
  gapsByCharacter: Map<string, Set<string>>
} {
  const entriesByCharacter = new Map<string, Entry[]>()
  const gapsByCharacter = new Map<string, Set<string>>()
  const game = ctx.game
  if (game === null) return { entriesByCharacter, gapsByCharacter }

  // Our locations by folded name, so a room named "Carpenter's Shop" lands on
  // the_carpenter rather than falling back to its outdoor map.
  const locationByFoldedName = new Map<string, string>()
  for (const location of buildLocations(ctx)) {
    locationByFoldedName.set(foldPlaceName(location.name), location.id)
  }

  // A gate must name a quest record this build actually ships — the plaza
  // upgrade is a real game quest and not a record, and a gate pointing at
  // nothing fails the gate check. When the shipped set is unknown (a caller
  // outside the build loop) the game's own list is the best available.
  const questIds = shippedQuestIds ?? new Set(ctx.game?.storyQuestById.keys() ?? [])
  let unresolvedRooms = 0
  let skippedVariantFiles = 0
  const gapFor = (characterId: string): Set<string> => {
    const set = gapsByCharacter.get(characterId) ?? new Set<string>()
    gapsByCharacter.set(characterId, set)
    return set
  }

  const resolveRoom = (room: string): string | null => {
    const direct = game.locationByRoom.get(room)
    if (direct !== undefined) return direct
    const meta = game.roomById.get(room)
    if (meta === undefined) return null
    const byName =
      meta.name === null ? undefined : locationByFoldedName.get(foldPlaceName(meta.name))
    if (byName !== undefined) return byName
    if (meta.map_location !== null) {
      const outdoor = game.locationByRoom.get(meta.map_location)
      if (outdoor !== undefined) return outdoor
    }
    return null
  }

  for (const file of game.gameScheduleFiles) {
    if (file.unread_requirement_keys.length > 0) {
      skippedVariantFiles += 1
      // The variance lands on every NPC the file names — their week genuinely
      // has a version nobody can select for them yet.
      for (const npc of file.npcs) gapFor(npc.npc).add('schedule_variants')
      continue
    }
    const weather = file.weather === null ? null : (SCHEDULE_WEATHER[file.weather] ?? null)
    if (file.weather !== null && weather === null) {
      skippedVariantFiles += 1
      continue
    }
    // A gate naming a quest we cannot link is worse than skipping the file:
    // the ungated sibling remains and says less, not wrong.
    if (file.quest_complete !== null && !questIds.has(file.quest_complete)) {
      skippedVariantFiles += 1
      continue
    }

    const day = DAY_IDS.find((d) => file.day_of_week?.startsWith(d) === true) ?? null
    const season = (['spring', 'summer', 'fall', 'winter'] as Season[]).find(
      (s) => s === file.season,
    )

    const priority =
      GROUP_PRIORITY[file.group] ??
      (file.quest_complete !== null && season !== undefined
        ? 6
        : season !== undefined
          ? 8
          : file.quest_complete !== null
            ? 12
            : 14)

    const labelParts = [
      season !== undefined ? season[0]?.toUpperCase() + season.slice(1) : null,
      day === null ? 'Any day' : DAY_LABELS[day],
      file.weather === 'snowy' ? 'in snow' : null,
      file.quest_complete !== null ? `after ${titleWords(file.quest_complete)}` : null,
      file.group.startsWith('Upgraded Market') ? 'upgraded market' : null,
    ].filter((part): part is string => part !== null)

    for (const npc of file.npcs) {
      const stops = npc.stops
        .flatMap((stop) => {
          const time = parseClock(stop.time)
          if (time === null) return []
          const locationId = resolveRoom(stop.room)
          if (locationId === null) {
            unresolvedRooms += 1
            gapFor(npc.npc).add('unresolved_places')
          }
          return [
            {
              time,
              location_id: locationId,
              activity_key: stop.marker === null ? null : toSnakeId(stop.marker),
            },
          ]
        })
        // The day runs 06:00 to 02:00; sort in day order, not clock order.
        .sort((a, b) => dayMinutes(a.time) - dayMinutes(b.time))

      const blocks = blocksFromStops(stops)
      if (blocks.length === 0) continue

      const entry: Entry = {
        priority,
        label: labelParts.join(', '),
        when: {
          seasons: season === undefined ? null : [season],
          days: day === null ? null : [day],
          weather,
          dates: null,
          requires:
            file.quest_complete === null
              ? []
              : [
                  {
                    type: 'quest' as const,
                    key: file.quest_complete,
                    op: 'done' as const,
                    value: null,
                  },
                ],
        },
        blocks,
      }
      entriesByCharacter.set(npc.npc, [...(entriesByCharacter.get(npc.npc) ?? []), entry])
    }
  }

  if (entriesByCharacter.size > 0) {
    consola.info(
      `schedules: game routines for ${entriesByCharacter.size} characters · ` +
        `${skippedVariantFiles} variant file(s) skipped (conditions nobody models) · ` +
        `${unresolvedRooms} stop(s) in unplaced rooms`,
    )
  }
  return { entriesByCharacter, gapsByCharacter }
}

const DAY_LABELS: Record<DayOfWeek, string> = {
  mon: 'Monday',
  tue: 'Tuesday',
  wed: 'Wednesday',
  thu: 'Thursday',
  fri: 'Friday',
  sat: 'Saturday',
  sun: 'Sunday',
}

/** Minutes since 06:00, wrapping — the game day ends at 02:00. */
const dayMinutes = (time: TimeOfDay): number => {
  const [h, m] = time.split(':')
  return (Number(h) * 60 + Number(m) - 360 + 1440) % 1440
}

/** `repair_the_bridge` -> "Repair the Bridge" — a quest id back into words. */
const titleWords = (id: string): string =>
  id
    .split('_')
    .map((word, index) =>
      index > 0 && ['the', 'a', 'of', 'and'].includes(word)
        ? word
        : word.charAt(0).toUpperCase() + word.slice(1),
    )
    .join(' ')

/**
 * Gated tables outrank the plain one; "after the quest" outranks "before".
 * The whole band sits below every game entry (2–14): where both sources
 * describe the same day the game's own file wins, per the precedence rule.
 */
const PRIORITY = { after: 40, before: 45, plain: 50 } as const

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
