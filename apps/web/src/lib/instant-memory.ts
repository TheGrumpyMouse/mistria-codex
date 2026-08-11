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
 */

const KEY = 'mistria-codex:calendar'

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
