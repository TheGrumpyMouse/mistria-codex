import { describe, expect, it } from 'vitest'
import { unlockQuestOf } from '../../enrich/places.js'
import { headingWords, parseSchedulePage, parseStops } from '../../enrich/schedules.js'
import { tableRows } from '../../lib/wiki.js'
import { blocksFromStops, parseClock, splitPlace } from './schedules.js'

describe('headingWords', () => {
  it('reads a season out of its template', () => {
    expect(headingWords('{{Season|Spring}} Schedules')).toBe('Spring')
  })

  it('takes the last positional argument, not the first', () => {
    // `{{SourceIcon|Story quest short|Repair the Bridge}}` names an icon first
    // and the quest second. Reading the first argument gated a whole Saturday
    // schedule on a quest called "Story quest short", which does not exist.
    expect(
      headingWords('After {{SourceIcon|Story quest short|Repair the Bridge}} is complete'),
    ).toBe('After Repair the Bridge is complete')
  })

  it('ignores styling arguments', () => {
    expect(headingWords('{{Season|Winter|width=18px}} Variant')).toBe('Winter Variant')
  })

  it('drops file links, which is all a Friday Night heading is made of', () => {
    expect(
      headingWords('[[File:fp wiki calendar.png|link=x|30x30px]] Friday Night at the Inn'),
    ).toBe('Friday Night at the Inn')
  })
})

describe('parseStops', () => {
  it('reads a table whose row separators are indented', () => {
    // MediaWiki allows leading whitespace on table markup, and Celine's
    // schedule indents every `|-` by six spaces. Anchoring the row split to
    // column zero collapsed her whole week into one row and produced stops
    // whose "place" was a time.
    const table = [
      '{|',
      '      |-',
      '      |06:00',
      "      |Town: Celine's Garden",
      '      |-',
      '      |11:49',
      '      |Inn: North Table',
      '|}',
    ].join('\n')

    expect(tableRows(table).length).toBeGreaterThan(1)
    expect(parseStops(table)).toEqual([
      { time: '06:00', place: "Town: Celine's Garden" },
      { time: '11:49', place: 'Inn: North Table' },
    ])
  })

  it('reads the inline cell style too', () => {
    const table = '{|\n|-\n|06:00||Manor: Foyer\n|-\n|09:30||Town: Fountain\n|}'
    expect(parseStops(table)).toEqual([
      { time: '06:00', place: 'Manor: Foyer' },
      { time: '09:30', place: 'Town: Fountain' },
    ])
  })
})

describe('parseSchedulePage', () => {
  const PAGE = [
    '== {{Season|Spring}} Schedules ==',
    '=== Monday ===',
    '{|\n|-\n|6:00 AM\n|Town\n|}',
    '=== Saturday ===',
    '==== Before {{SourceIcon|Story quest short|Repair the Bridge}} is complete ====',
    '{|\n|-\n|6:00 AM\n|Manor: Foyer\n|}',
    '==== After {{SourceIcon|Story quest short|Repair the Bridge}} is complete ====',
    '{|\n|-\n|6:00 AM\n|Town: Fountain\n|}',
  ].join('\n')

  it('tags each table with its season, day and condition', () => {
    expect(parseSchedulePage(PAGE)).toEqual([
      {
        section: 'Spring',
        group: 'Monday',
        variant: null,
        stops: [{ time: '6:00 AM', place: 'Town' }],
      },
      {
        section: 'Spring',
        group: 'Saturday',
        variant: 'Before Repair the Bridge is complete',
        stops: [{ time: '6:00 AM', place: 'Manor: Foyer' }],
      },
      {
        section: 'Spring',
        group: 'Saturday',
        variant: 'After Repair the Bridge is complete',
        stops: [{ time: '6:00 AM', place: 'Town: Fountain' }],
      },
    ])
  })
})

describe('parseClock', () => {
  it('reads both clock styles', () => {
    expect(parseClock('6:00 AM')).toBe('06:00')
    expect(parseClock('06:00')).toBe('06:00')
    expect(parseClock('8:12 PM')).toBe('20:12')
    expect(parseClock('7:00am')).toBe('07:00')
    expect(parseClock('2am')).toBe('02:00')
  })

  it('handles the two noons', () => {
    expect(parseClock('12:10 AM')).toBe('00:10')
    expect(parseClock('12:33 PM')).toBe('12:33')
  })

  it('ignores "(next day)", which repeats what 12:10 AM already says', () => {
    expect(parseClock('12:10 AM (next day)')).toBe('00:10')
    expect(parseClock('12:23 AM (Next Day)')).toBe('00:23')
  })

  it('refuses "1 Day Post" rather than inventing a bedtime', () => {
    expect(parseClock('1 Day Post')).toBe(null)
    expect(parseClock('-')).toBe(null)
  })
})

describe('splitPlace', () => {
  it('splits both notations the schedules use', () => {
    expect(splitPlace("Manor: Adeline's Bedroom")).toEqual({
      place: 'Manor',
      detail: "Adeline's Bedroom",
    })
    expect(splitPlace('Inn (South Table Bottom 1)')).toEqual({
      place: 'Inn',
      detail: 'South Table Bottom 1',
    })
  })

  it('leaves a bare place alone', () => {
    expect(splitPlace('Town')).toEqual({ place: 'Town', detail: null })
  })
})

const stop = (time: string, location_id: string | null, activity_key: string | null = null) => ({
  time,
  location_id,
  activity_key,
})

describe('blocksFromStops', () => {
  it('ends each block where the next one starts, and cycles round to the first', () => {
    // The last stop runs to the first one's time, because a day is a cycle —
    // and that wrap is split at midnight here rather than shipped.
    expect(
      blocksFromStops([stop('06:00', 'mistria'), stop('11:30', 'the_inn')]).map((b) => [
        b.from,
        b.to,
        b.location_id,
      ]),
    ).toEqual([
      ['06:00', '11:30', 'mistria'],
      ['11:30', '00:00', 'the_inn'],
      ['00:00', '06:00', 'the_inn'],
    ])
  })

  it('splits a stint that runs past midnight, so nothing downstream compares from > to', () => {
    const blocks = blocksFromStops([stop('06:00', 'mistria'), stop('22:40', 'the_inn')])
    expect(blocks.slice(1)).toEqual([
      { from: '22:40', to: '00:00', location_id: 'the_inn', x: null, y: null, activity_key: null },
      { from: '00:00', to: '06:00', location_id: 'the_inn', x: null, y: null, activity_key: null },
    ])
    expect(blocks.every((b) => b.from < b.to || b.to === '00:00')).toBe(true)
  })

  it('leaves a hole where the place could not be resolved', () => {
    // "Meadow" is not in the vocabulary. Dropping the stop and letting the
    // previous block run over it would claim she is still at the Inn at 13:00.
    const blocks = blocksFromStops([
      stop('06:00', 'the_inn'),
      stop('13:00', null),
      stop('19:00', 'mistria'),
    ])
    expect(blocks.map((b) => [b.from, b.to, b.location_id])).toEqual([
      ['06:00', '13:00', 'the_inn'],
      ['19:00', '00:00', 'mistria'],
      ['00:00', '06:00', 'mistria'],
    ])
  })

  it('treats a one-stop day as all day', () => {
    expect(blocksFromStops([stop('06:00', 'mistria')])).toEqual([
      { from: '00:00', to: '00:00', location_id: 'mistria', x: null, y: null, activity_key: null },
    ])
  })
})

describe('unlockQuestOf', () => {
  it('names the quest a building waits on', () => {
    expect(unlockQuestOf('{{SourceIcon|Story Quest|Repair the Bell Tower}}')).toBe(
      'Repair the Bell Tower',
    )
  })

  it('reads "from the start" as an answer, not a missing value', () => {
    expect(unlockQuestOf('{{SourceIcon|Start}}')).toBe(null)
    expect(unlockQuestOf(undefined)).toBe(null)
  })

  it('collapses the double spaces the wiki types into quest names', () => {
    expect(unlockQuestOf('{{SourceIcon|Story Quest Nil|The Mill  Restoration Project}}')).toBe(
      'The Mill Restoration Project',
    )
  })
})
