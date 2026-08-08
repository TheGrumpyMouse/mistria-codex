import { DAYS_PER_SEASON, SEASONS, type Season } from '@mistria/schema'
import { Link } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { Column } from '~/app/AppShell'
import { Section } from '~/components/Section'
import { loadDataset } from '~/lib/data'

/**
 * The year on one page: whose birthday, and which festival.
 *
 * Two datasets that were already shipped and only readable one record at a
 * time. Birthdays are the thing you want a week's warning about and the app
 * could only tell you about one villager at a time, on a page you had to know
 * to visit.
 *
 * Four grids of 28, not a scrolling list. The 4x7 shape is the same one the Day
 * Dial uses, and it is the shape that lets you see "nothing until the 17th" at a
 * glance — which is the actual question. A list of twelve dated rows does not.
 */

interface CharacterRecord {
  id: string
  name: string
  birthday: { season: string; day: number } | null
}

interface FestivalRecord {
  id: string
  name: string
  date: { season: string; day: number } | null
  implemented: boolean
  location_id: string | null
}

interface DayEntry {
  kind: 'birthday' | 'festival'
  id: string
  name: string
  /** Festivals the files describe and the game does not run. */
  unimplemented: boolean
}

export function CalendarRoute() {
  const [state, setState] = useState<{
    byDay: Map<string, DayEntry[]>
    loading: boolean
  }>({ byDay: new Map(), loading: true })

  useEffect(() => {
    let live = true
    Promise.all([
      loadDataset<CharacterRecord>('characters'),
      loadDataset<FestivalRecord>('festivals'),
    ])
      .then(([characters, festivals]) => {
        if (!live) return
        const byDay = new Map<string, DayEntry[]>()
        const add = (season: string, day: number, entry: DayEntry): void => {
          const key = `${season}:${day}`
          byDay.set(key, [...(byDay.get(key) ?? []), entry])
        }

        for (const person of characters) {
          if (person.birthday === null) continue
          add(person.birthday.season, person.birthday.day, {
            kind: 'birthday',
            id: person.id,
            name: person.name,
            unimplemented: false,
          })
        }
        for (const festival of festivals) {
          if (festival.date === null) continue
          add(festival.date.season, festival.date.day, {
            kind: 'festival',
            id: festival.id,
            name: festival.name,
            unimplemented: !festival.implemented,
          })
        }

        setState({ byDay, loading: false })
      })
      .catch(() => live && setState((s) => ({ ...s, loading: false })))
    return () => {
      live = false
    }
  }, [])

  const { byDay, loading } = state

  return (
    <Column width="wide">
      <header>
        <h1 className="text-2xl">The year</h1>
        <p className="mt-1 text-ink-mute text-sm">
          Every birthday and every festival, across all{' '}
          <span data-numeral>{SEASONS.length * DAYS_PER_SEASON}</span> days.
        </p>
      </header>

      {loading ? (
        <p className="mt-4 text-ink-mute text-sm">Loading…</p>
      ) : (
        SEASONS.map((season) => <SeasonGrid key={season} season={season} byDay={byDay} />)
      )}
    </Column>
  )
}

function SeasonGrid({ season, byDay }: { season: Season; byDay: Map<string, DayEntry[]> }) {
  const days = Array.from({ length: DAYS_PER_SEASON }, (_, i) => i + 1)

  return (
    <Section title={season[0]?.toUpperCase() + season.slice(1)}>
      {/*
        Seven columns because the week is seven days and repeats exactly four
        times in a season — so a column is always the same weekday, and "the
        Saturday market" lines up down one edge.
      */}
      <ul className="grid grid-cols-7 gap-1">
        {days.map((day) => {
          const entries = byDay.get(`${season}:${day}`) ?? []
          return (
            <li
              key={day}
              className="min-h-[3.5rem] rounded-tile border border-rule p-1"
              style={entries.length > 0 ? { background: `var(--${season}-tint)` } : undefined}
            >
              <span data-numeral className="text-[10px] text-ink-faint">
                {day}
              </span>
              <ul className="mt-0.5 flex flex-col gap-0.5">
                {entries.map((entry) => (
                  <li key={`${entry.kind}:${entry.id}`} className="text-[10px] leading-tight">
                    {entry.kind === 'birthday' ? (
                      <Link
                        to="/villager/$id"
                        params={{ id: entry.id }}
                        className="text-ink underline decoration-rule underline-offset-2"
                      >
                        {entry.name}
                      </Link>
                    ) : (
                      // A festival the files describe and the game does not run
                      // is still worth showing — it is the difference between
                      // "not in the game" and "we never heard of it".
                      <span className={entry.unimplemented ? 'unverified px-1' : 'text-ink'}>
                        {entry.name}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </li>
          )
        })}
      </ul>
    </Section>
  )
}
