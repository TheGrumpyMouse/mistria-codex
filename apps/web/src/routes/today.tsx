import { getRouteApi, Link } from '@tanstack/react-router'
import { useEffect, useMemo, useState } from 'react'
import { Column } from '~/app/AppShell'
import { DayDial, type DayMark } from '~/components/DayDial'
import { FindableRow } from '~/components/FindableList'
import { ItemIcon } from '~/components/ItemIcon'
import { LoadError } from '~/components/Section'
import { SpoilerChip } from '~/components/Spoiler'
import { type DisplayIndex, loadAvailability, loadDataset, loadDisplayIndex } from '~/lib/data'
import { type AvailabilityIndex, findAvailable, groupByKind, KIND_LABELS } from '~/lib/findable'
import { formatDate, type Instant, titleCase, weekdayOf } from '~/lib/instant'
import { useSpoilers } from '~/lib/spoilers'

interface CharacterRecord {
  id: string
  name: string
  spoiler?: boolean
  icon_key: string | null
  birthday: { season: string; day: number } | null
}

interface FestivalRecord {
  id: string
  name: string
  unreleased?: boolean
  icon_key: string | null
  date: { season: string; day: number } | null
  location_id: string | null
  implemented: boolean
}

interface CalendarData {
  availability: AvailabilityIndex
  index: DisplayIndex
  locationNames: Map<string, string>
  characters: CharacterRecord[]
  festivals: FestivalRecord[]
}

const route = getRouteApi('/')

/**
 * The flagship screen: a calendar you ask questions of.
 *
 * The season grid wears its days' faces — a birthday tile shows the villager,
 * a festival tile its banner — and picking a day answers below it: who to
 * congratulate, what is on, and then everything findable at that instant,
 * folded into groups. **Collapsed by default**, because "217 things findable"
 * as a flat list buried the calendar this screen is named for; the counts say
 * what is worth opening.
 *
 * The search box cuts across every group at once and force-opens the ones
 * that match — finding one fish must not require knowing it is a fish.
 */
export function TodayRoute() {
  const search = route.useSearch()
  const navigate = route.useNavigate()

  const instant: Instant = search

  // The chrome takes the season's colour, so nothing has to wear a badge
  // saying which season you are looking at.
  useEffect(() => {
    document.documentElement.dataset.season = instant.season
  }, [instant.season])

  const update = (next: Partial<Instant>): void => {
    void navigate({ search: (prev) => ({ ...prev, ...next }), replace: true })
  }

  const [data, setData] = useState<CalendarData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  useEffect(() => {
    let live = true
    Promise.all([
      loadAvailability(),
      loadDisplayIndex(),
      loadDataset<{ id: string; name: string }>('locations'),
      loadDataset<CharacterRecord>('characters'),
      loadDataset<FestivalRecord>('festivals'),
    ])
      .then(([availability, index, locations, characters, festivals]) => {
        if (!live) return
        setData({
          availability,
          index,
          locationNames: new Map(locations.map((l) => [l.id, l.name])),
          characters,
          festivals,
        })
      })
      .catch((err: unknown) => live && setError(err instanceof Error ? err.message : String(err)))
    return () => {
      live = false
    }
  }, [])

  const spoilers = useSpoilers()

  // The tiles' faces: every birthday and festival in the visible season.
  const marks = useMemo(() => {
    const byDay: Record<number, DayMark[]> = {}
    const add = (day: number, mark: DayMark): void => {
      byDay[day] = [...(byDay[day] ?? []), mark]
    }
    for (const person of data?.characters ?? []) {
      if (person.birthday?.season !== instant.season) continue
      // A veiled character's tile mark carries neither face nor name — the
      // tooltip and the screen-reader label are exactly as informed as the eye.
      const veiled = person.spoiler === true && !spoilers.shown(person.id)
      add(person.birthday.day, {
        kind: 'birthday',
        iconKey: veiled ? 'spoiler/hidden' : (person.icon_key ?? `character/${person.id}`),
        label: veiled ? 'A birthday — story spoiler' : `${person.name}'s birthday`,
      })
    }
    for (const festival of data?.festivals ?? []) {
      if (festival.date?.season !== instant.season) continue
      // A festival the game does not run yet keeps its tile mark but not its
      // name or banner — same rule as the veiled birthday above.
      const veiled = festival.unreleased === true && !spoilers.shown(festival.id)
      add(festival.date.day, {
        kind: 'festival',
        iconKey: veiled ? 'spoiler/hidden' : (festival.icon_key ?? `festival/${festival.id}`),
        label: veiled ? 'A festival — coming later' : festival.name,
      })
    }
    return byDay
  }, [data, instant.season, spoilers])

  const birthdays = useMemo(
    () =>
      (data?.characters ?? []).filter(
        (p) => p.birthday?.season === instant.season && p.birthday.day === instant.day,
      ),
    [data, instant.season, instant.day],
  )
  const festivals = useMemo(
    () =>
      (data?.festivals ?? []).filter(
        (f) => f.date?.season === instant.season && f.date.day === instant.day,
      ),
    [data, instant.season, instant.day],
  )

  // Recomputed only when the instant or the data changes. Dragging the time
  // slider re-runs an 832-rule integer scan, which is microseconds — the memo is
  // for React's sake, not the query's.
  const findable = useMemo(
    () => (data === null ? [] : findAvailable(data.availability, instant)),
    [data, instant],
  )

  const needle = query.trim().toLowerCase()
  const groups = useMemo(() => {
    const named = (id: string): string => data?.index[id]?.n ?? id.replace(/_/g, ' ')
    return groupByKind(findable)
      .map((group) => ({
        ...group,
        entities:
          needle === ''
            ? group.entities
            : group.entities.filter((e) => named(e.id).toLowerCase().includes(needle)),
      }))
      .filter((group) => group.entities.length > 0)
  }, [findable, needle, data])

  return (
    <Column>
      <div className="flex flex-col gap-5">
        <header>
          <h1 className="text-2xl">Calendar</h1>
          <p className="mt-0.5 text-ink-mute text-sm">
            {formatDate(instant)} · {weekdayOf(instant.day)} · {titleCase(instant.weather)}
          </p>
        </header>

        <DayDial value={instant} onChange={update} marks={marks} />

        {error !== null && <LoadError />}

        {error === null && data === null && (
          <p className="text-ink-mute text-sm">Working out what is findable…</p>
        )}

        {data !== null && (birthdays.length > 0 || festivals.length > 0) && (
          <section aria-label="On this day" className="-mt-1 flex flex-col gap-2">
            {birthdays.map((person) =>
              person.spoiler === true && !spoilers.shown(person.id) ? (
                // The card exists and still navigates; the villager page asks.
                <Link
                  key={person.id}
                  to="/villager/$id"
                  params={{ id: person.id }}
                  className="flex items-center gap-3 rounded-card border border-rule bg-surface px-3 py-2 transition-colors hover:bg-sunk"
                >
                  <SpoilerChip />
                  <span className="text-ink-mute text-sm">a birthday</span>
                </Link>
              ) : (
                <Link
                  key={person.id}
                  to="/villager/$id"
                  params={{ id: person.id }}
                  className="flex items-center gap-3 rounded-card border border-rule bg-surface px-3 py-2 transition-colors hover:bg-sunk"
                >
                  <ItemIcon
                    iconKey={person.icon_key ?? `character/${person.id}`}
                    name={person.name}
                    size="sm"
                  />
                  <span className="text-ink text-sm">
                    {person.name}
                    <span className="text-ink-mute">’s birthday — bring a loved gift</span>
                  </span>
                </Link>
              ),
            )}
            {festivals.map((festival) =>
              festival.unreleased === true && !spoilers.shown(festival.id) ? (
                // Described by the wiki, not run by the game. Hidden until
                // asked for — the tap is the ask, since a festival has no
                // detail page to do the asking.
                <button
                  key={festival.id}
                  type="button"
                  onClick={() => spoilers.reveal(festival.id)}
                  className="flex items-center gap-3 rounded-card border border-rule bg-surface px-3 py-2 text-left"
                >
                  <SpoilerChip reason="unreleased" />
                  <span className="text-ink-faint text-xs">tap to show</span>
                </button>
              ) : (
                <div
                  key={festival.id}
                  className="flex items-center gap-3 rounded-card border border-rule bg-surface px-3 py-2"
                >
                  <ItemIcon
                    iconKey={festival.icon_key ?? `festival/${festival.id}`}
                    name={festival.name}
                    size="sm"
                  />
                  <span className="text-ink text-sm">
                    {festival.name}
                    {festival.location_id !== null && (
                      <>
                        <span className="text-ink-mute"> — at </span>
                        <Link
                          to="/place/$id"
                          params={{ id: festival.location_id }}
                          className="text-ink-mute underline decoration-rule underline-offset-4 hover:text-ink"
                        >
                          {data.locationNames.get(festival.location_id) ??
                            festival.location_id.replace(/_/g, ' ')}
                        </Link>
                      </>
                    )}
                    {/* Revealed but still not runnable — the badge keeps saying
                      so before someone plans a day around it. */}
                    {!festival.implemented && (
                      <span className="unverified ml-2 rounded-tile px-1.5 py-0.5 text-[10px]">
                        not yet in the game
                      </span>
                    )}
                  </span>
                </div>
              ),
            )}
          </section>
        )}

        {data !== null && (
          <div>
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-ink-mute text-sm">
                <span data-numeral>{findable.length}</span> things findable now
              </p>
            </div>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Find something in this day…"
              aria-label="Filter what is findable"
              className="mt-2 w-full rounded-tile border border-rule bg-surface px-3 py-2 text-ink text-sm placeholder:text-ink-faint"
            />

            {groups.length === 0 && needle !== '' && (
              <p className="mt-3 text-ink-mute text-sm">
                Nothing findable today matches “{query.trim()}” — it may need another day or
                different weather.{' '}
                <Link
                  to="/search"
                  className="underline decoration-rule underline-offset-4 hover:text-ink"
                >
                  Search everything
                </Link>
                .
              </p>
            )}

            <div className="mt-3 flex flex-col gap-2">
              {groups.map((group) => (
                // Collapsed by default; a live search forces matches open. The
                // key includes the needle so a new search re-mounts the group
                // with the right initial state — `open` is uncontrolled after
                // mount, and half-stale disclosure is worse than a re-mount.
                <details
                  key={`${group.kind}:${needle === '' ? '' : 'open'}`}
                  open={needle !== ''}
                  className="rounded-card border border-rule bg-surface px-3 py-1"
                >
                  <summary className="cursor-pointer py-1.5 text-ink text-sm">
                    {KIND_LABELS[group.kind] ?? group.kind.replace(/_/g, ' ')}
                    <span className="text-ink-faint"> · {group.entities.length}</span>
                  </summary>
                  <ul className="flex flex-col divide-y divide-rule border-rule border-t">
                    {group.entities.map((entity) => (
                      <FindableRow
                        key={entity.id}
                        entity={entity}
                        index={data.index}
                        locationNames={data.locationNames}
                      />
                    ))}
                  </ul>
                </details>
              ))}
            </div>
          </div>
        )}
      </div>
    </Column>
  )
}
