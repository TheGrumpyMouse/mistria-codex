import { describe, expect, it } from 'vitest'
import { adoptSyncedCalendarSelection } from './instant-memory'

/**
 * The synced calendar selection is "the newest positive `calendar:` row", and
 * these tests pin the three ways that can go wrong: an older row winning, a
 * tombstone or junk row being adopted, and a timestamp tie resolving
 * differently on two devices.
 */

describe('adoptSyncedCalendarSelection', () => {
  it('adopts the newest positive calendar row', () => {
    expect(
      adoptSyncedCalendarSelection([
        { key: 'calendar:spring_12', t: 100 },
        { key: 'calendar:fall_3', t: 200 },
        { key: 'museum:ore_copper', t: 999 },
      ]),
    ).toEqual({ season: 'fall', day: 3 })
  })

  it('ignores tombstones — an undone row is not a selection', () => {
    expect(
      adoptSyncedCalendarSelection([
        { key: 'calendar:spring_12', t: 100 },
        { key: 'calendar:fall_3', t: -200 },
      ]),
    ).toEqual({ season: 'spring', day: 12 })
  })

  it('refuses junk a remote blob could carry', () => {
    // A row is remote input: adopting `calendar:zzz_99` would trade the real
    // last selection for the schema's fallback defaults.
    expect(
      adoptSyncedCalendarSelection([
        { key: 'calendar:zzz_12', t: 300 },
        { key: 'calendar:spring_99', t: 300 },
        { key: 'calendar:spring', t: 300 },
        { key: 'calendar:winter_28', t: 100 },
      ]),
    ).toEqual({ season: 'winter', day: 28 })
  })

  it('breaks a timestamp tie deterministically, so two devices agree', () => {
    const rows = [
      { key: 'calendar:fall_3', t: 100 },
      { key: 'calendar:spring_12', t: 100 },
    ]
    expect(adoptSyncedCalendarSelection(rows)).toEqual(
      adoptSyncedCalendarSelection([...rows].reverse()),
    )
  })

  it('adopts nothing from a set with no calendar rows', () => {
    expect(adoptSyncedCalendarSelection([{ key: 'museum:ore_copper', t: 1 }])).toBeNull()
  })
})
