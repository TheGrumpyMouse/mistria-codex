/**
 * NPC daily routines, read from `t2/Schedules/**.s.toml`.
 *
 * Each file is one candidate day: a `requires` list saying when it applies,
 * then one table per NPC whose keys are clock stamps and whose values name a
 * destination as `room/Marker`. The game walks its schedule files and takes
 * the first whose conditions hold — exactly the first-match-wins model the
 * shipped `Schedule` entity already uses.
 *
 * **The season directories are shelving, not conditions.** A file states its
 * own `season` requirement only when it overrides — `fall_monday.toml` says
 * `season = "fall"`, while the files under "Spring Schedules" mostly state no
 * season at all because they are the *defaults* every season falls back to.
 * Reading the directory as a condition would pin the default week to spring
 * and leave three seasons empty.
 *
 * Conditions are read structurally and anything unrecognised is kept as an
 * unread key, never dropped: the rainy variants select between themselves on a
 * `rain_counter` the player cannot see, and a builder that ignored that would
 * render a coin flip as a fact. `start_writes`/`end_writes` and the
 * `on_arrival_*` tables are scene behaviour, not locations, and are not read.
 */
import { join } from 'node:path'
import { readToml, resolveIn, str, type Table, table, tomlFiles } from './toml.js'

export interface GameScheduleStop {
  /** The stamp as written — `6:21am`, `12:12am`. Parsed at build time. */
  time: string
  /** The room half of `room/Marker`. */
  room: string
  /** The marker half, or null when the destination names only a room. */
  marker: string | null
}

export interface GameScheduleNpc {
  npc: string
  stops: GameScheduleStop[]
}

export interface GameScheduleFile {
  /** Path relative to `t2/Schedules`, POSIX separators. */
  file: string
  /** The top-level directory — `Spring Schedules`, `Rainy Schedules`… */
  group: string
  day_of_week: string | null
  /** The file's weather word — `pleasant`, `rainy` — not our vocabulary. */
  weather: string | null
  /** Stated only when the file overrides the default week. */
  season: string | null
  /** From a `quest_<id>_complete = true` condition, as the quest's game id. */
  quest_complete: string | null
  /** Condition keys nobody models — `rain_counter`, `any`. Non-empty means "do not apply this file plainly". */
  unread_requirement_keys: string[]
  npcs: GameScheduleNpc[]
}

export interface GameSchedulesExtract {
  gameVersion: string
  files: GameScheduleFile[]
}

const STAMP = /^\d{1,2}:\d{2}(?:am|pm)$/i

function readRequires(value: unknown): {
  day: string | null
  weather: string | null
  season: string | null
  quest: string | null
  unread: string[]
} {
  let day: string | null = null
  let weather: string | null = null
  let season: string | null = null
  let quest: string | null = null
  const unread: string[] = []

  if (Array.isArray(value)) {
    for (const raw of value) {
      const condition = table(raw)
      if (condition === null) continue
      for (const [key, conditionValue] of Object.entries(condition)) {
        if (key === 'day_of_the_week') day = str(conditionValue) ?? day
        else if (key === 'weather') weather = str(conditionValue) ?? weather
        else if (key === 'season') season = str(conditionValue) ?? season
        else if (/^quest_.+_complete$/.test(key) && conditionValue === true) {
          quest = key.replace(/^quest_/, '').replace(/_complete$/, '')
        } else unread.push(key)
      }
    }
  }
  return { day, weather, season, quest, unread: unread.sort() }
}

function readNpcs(doc: Table): GameScheduleNpc[] {
  const npcs: GameScheduleNpc[] = []
  for (const [npc, value] of Object.entries(doc)) {
    const section = table(value)
    if (section === null) continue
    const stops: GameScheduleStop[] = []
    for (const [stamp, rawStop] of Object.entries(section)) {
      if (!STAMP.test(stamp)) continue
      const stop = table(rawStop)
      const destination = str(stop?.destination)
      if (destination === null) continue
      const slash = destination.indexOf('/')
      stops.push({
        time: stamp,
        room: slash === -1 ? destination : destination.slice(0, slash),
        marker: slash === -1 ? null : destination.slice(slash + 1),
      })
    }
    if (stops.length > 0) npcs.push({ npc, stops })
  }
  return npcs
}

export async function extractSchedules(
  root: string,
  gameVersion: string,
): Promise<GameSchedulesExtract> {
  const files = await tomlFiles(root, join('t2', 'Schedules'))
  const scheduleFiles = files.filter((f) => f.endsWith('.s.toml'))
  if (scheduleFiles.length === 0) {
    throw new Error(
      't2/Schedules holds no .s.toml files. Refusing to write an empty schedule extract ' +
        'over a good one — check MISTRIA_GAME_DIR points at the unpacked assets folder.',
    )
  }

  const out: GameScheduleFile[] = []
  for (const file of scheduleFiles) {
    const group = file.includes('/') ? (file.split('/')[0] ?? '') : ''
    // Dev fixtures, not the game.
    if (group === 'Test Schedules') continue

    const doc = await readToml(resolveIn(root, 't2', 'Schedules', file))
    const { day, weather, season, quest, unread } = readRequires(doc.requires)
    const npcs = readNpcs(doc)
    if (npcs.length === 0) continue

    out.push({
      file,
      group,
      day_of_week: day,
      weather,
      season,
      quest_complete: quest,
      unread_requirement_keys: unread,
      npcs,
    })
  }

  if (out.length === 0) throw new Error('t2/Schedules parsed to zero usable files.')
  out.sort((a, b) => (a.file < b.file ? -1 : 1))
  return { gameVersion, files: out }
}
