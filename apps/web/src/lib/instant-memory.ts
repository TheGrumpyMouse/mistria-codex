import { DAYS_PER_SEASON, SEASONS } from '@mistria/schema'
import { type ProgressRow, setDone } from './progress'

/**
 * The calendar's memory: the season and day you last dialled in.
 *
 * Only those two. `time: null` ("any time") is the honest opening question for
 * a new visit, yesterday's weather is stale the moment the app reopens, and a
 * `year` only ever arrives via somebody's shared link — making it sticky would
 * turn their link into this device's setting.
 *
 * The values are stored raw and validated on the way out by `InstantSearch`
 * (the router spreads them under the URL's own params), so corrupt storage
 * degrades to the schema defaults exactly like a corrupt link — this module
 * never needs to know what a valid season is.
 *
 * **The selection also rides sync**, as a progress row — the flat table was
 * built to take new domains without a schema bump, and a row is `key -> ±t`
 * with no value payload, so the selection is encoded in the key itself:
 * `calendar:fall_12`, stamped with when it was dialled. "Current selection" is
 * then *the newest positive `calendar:` row*, never a lone stored value — old
 * selections stay behind as older rows (bounded: 112 possible keys) and the
 * CRDT merge needs no special case for any of it. localStorage stays as the
 * synchronous cache the router can read; `adoptSyncedCalendarSelection`
 * refreshes it after every pull.
 */

const KEY = 'mistria-codex:calendar'

/** The progress-table domain. A row looks like `calendar:fall_12`. */
const DOMAIN = 'calendar'

export function savedCalendarSelection(): { season?: unknown; day?: unknown } {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    if (typeof raw !== 'object' || raw === null) return {}
    const stored = raw as Record<string, unknown>
    return {
      ...('season' in stored ? { season: stored.season } : {}),
      ...('day' in stored ? { day: stored.day } : {}),
    }
  } catch {
    return {}
  }
}

export function saveCalendarSelection(selection: { season: string; day: number }): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(selection))
  } catch {
    // Not persistable (private mode) — the calendar still works this visit.
  }
}

/**
 * A **deliberate dial act**, recorded as a progress row so it syncs.
 *
 * Called from the calendar's `update`, never from the arrive-at-the-screen
 * effect: restoring a stored value, landing on a pasted link or pressing Back
 * is *viewing* a date, and stamping those with a fresh timestamp would let
 * merely opening the app outvote a genuine selection made on another device.
 */
export function recordCalendarSelection(selection: { season: string; day: number }): void {
  void setDone(DOMAIN, `${selection.season}_${selection.day}`, true).catch(() => {
    // IndexedDB unavailable — the localStorage cache still carries this device.
  })
}

/**
 * Decode a `calendar:` row id back into a selection, or null for anything that
 * is not one. Strict on purpose: a row is remote input, and adopting
 * `calendar:zzz_99` into the cache would trade the real last selection for the
 * schema's fallback defaults.
 */
function decodeSelection(id: string): { season: string; day: number } | null {
  const match = /^([a-z]+)_(\d+)$/.exec(id)
  if (match === null) return null
  const [, season, rawDay] = match
  const day = Number(rawDay)
  if (!(SEASONS as readonly string[]).includes(season ?? '')) return null
  if (!Number.isInteger(day) || day < 1 || day > DAYS_PER_SEASON) return null
  return { season: season as string, day }
}

/**
 * After a sync pull: refresh the local cache from the merged rows.
 *
 * The newest positive `calendar:` row wins; a timestamp tie breaks on the key,
 * because two devices reading the same merged set must land on the same
 * answer. Writes the cache only — the rows themselves were already applied by
 * the caller, and writing a fresh row here would re-stamp a synced selection
 * as if it had just been dialled. Returns what it adopted (or null), which is
 * also what makes it testable where localStorage does not exist.
 */
export function adoptSyncedCalendarSelection(
  rows: readonly ProgressRow[],
): { season: string; day: number } | null {
  const prefix = `${DOMAIN}:`
  let latest: { selection: { season: string; day: number }; t: number; key: string } | null = null
  for (const row of rows) {
    if (row.t <= 0 || !row.key.startsWith(prefix)) continue
    const selection = decodeSelection(row.key.slice(prefix.length))
    if (selection === null) continue
    if (latest === null || row.t > latest.t || (row.t === latest.t && row.key > latest.key)) {
      latest = { selection, t: row.t, key: row.key }
    }
  }
  if (latest === null) return null
  saveCalendarSelection(latest.selection)
  return latest.selection
}
