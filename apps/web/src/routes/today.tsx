import { getRouteApi, Link } from '@tanstack/react-router'
import { useEffect, useMemo, useState } from 'react'
import { Column } from '~/app/AppShell'
import { DayDial, type DayMark } from '~/components/DayDial'
import { FindableRow } from '~/components/FindableList'
import { ItemIcon } from '~/components/ItemIcon'
import { PlaceLink } from '~/components/PlaceLink'
import { LoadError } from '~/components/Section'
import { SortPicker } from '~/components/SortPicker'
import { SpoilerChip } from '~/components/Spoiler'
import { type DisplayIndex, loadAvailability, loadDataset, loadDisplayIndex } from '~/lib/data'
import {
  type AvailabilityIndex,
  type FindableEntity,
  findAvailable,
  groupByKind,
  KIND_LABELS,
} from '~/lib/findable'
import { formatDate, type Instant, titleCase, weekdayOf } from '~/lib/instant'
import { type PlaceLabel, placeLabel, placeLabels } from '~/lib/labels'
import { sortEntities, useListSort } from '~/lib/list-sort'
import { doneIn } from '~/lib/progress'
import { useSpoilers } from '~/lib/spoilers'

interface MineRecord {
  location_id: string | null
  floors: { min: number; max: number }
}

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
  places: Map<string, PlaceLabel>
  characters: CharacterRecord[]
  festivals: FestivalRecord[]
  /** Every donatable item id, from the museum sets. */
  museumItemIds: Set<string>
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
      loadDataset<{ item_ids: string[] }>('museum_sets'),
      // 4KB, for five floor ranges — a mine's name alone does not say how deep
      // it is, and that is the fact that decides whether to go down there.
      loadDataset<MineRecord>('mines'),
    ])
      .then(([availability, index, locations, characters, festivals, museumSets, mines]) => {
        if (!live) return
        setData({
          availability,
          index,
          places: placeLabels(locations, mines),
          characters,
          festivals,
          museumItemIds: new Set(museumSets.flatMap((set) => set.item_ids)),
        })
      })
      .catch((err: unknown) => live && setError(err instanceof Error ? err.message : String(err)))
    return () => {
      live = false
    }
  }, [])

  // Ticks are read fresh every mount, never cached with the almanac — they
  // change while the app runs, on the museum screen and on item pages.
  const [donated, setDonated] = useState<Set<string>>(new Set())
  useEffect(() => {
    let live = true
    doneIn('museum').then((done) => live && setDonated(done))
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

  // The filter matches more than names: the kind ("fish") and every place the
  // thing is found ("spring pond") count too, token by token — so "spring
  // pond fish" narrows to exactly the fish in that pond. Anything less and
  // the box only answers questions the player already knows the answer to.
  const needle = query.trim().toLowerCase()
  const matchesQuery = useMemo(() => {
    const tokens = needle.split(/\s+/).filter((t) => t !== '')
    return (entity: FindableEntity): boolean => {
      if (tokens.length === 0) return true
      const haystack = [
        data?.index[entity.id]?.n ?? entity.id.replace(/_/g, ' '),
        KIND_LABELS[entity.kind] ?? entity.kind,
        // The name only. The floor range is rendered beside it but deliberately
        // kept out of the haystack — otherwise typing "39" starts matching
        // every ore in the Tide Caverns.
        ...entity.locationIds.map((l) =>
          data === null ? l.replace(/_/g, ' ') : placeLabel(data.places, l).name,
        ),
      ]
        .join(' ')
        .toLowerCase()
      return tokens.every((token) => haystack.includes(token))
    }
  }, [needle, data])

  /**
   * The order within each group.
   *
   * "Season" and "weather" mean *how narrow*, not *which one* — every row here
   * already matches the chosen instant, so ordering by the value itself would
   * put everything in one bucket. What differs is whether a thing is here
   * because of today or here regardless, which is the difference between an
   * errand and a note. See `lib/list-sort.ts`.
   */
  const [sort, setSort] = useListSort()
  const nameOf = useMemo(
    () => (entity: FindableEntity) => data?.index[entity.id]?.n ?? entity.id.replace(/_/g, ' '),
    [data],
  )
  const focus = useMemo(
    () => ({ season: instant.season, weather: instant.weather }),
    [instant.season, instant.weather],
  )

  const groups = useMemo(
    () =>
      groupByKind(findable)
        .map((group) => ({
          ...group,
          entities: sortEntities(group.entities.filter(matchesQuery), sort, nameOf, focus),
        }))
        .filter((group) => group.entities.length > 0),
    [findable, matchesQuery, sort, nameOf, focus],
  )

  // The museum cut of the same answer: findable now, wanted by a set, not
  // yet donated. Grouped kind -> place, because that is the errand's shape:
  // "I'm at the spring pond with a rod — what does the museum still need?"
  const museumGroups = useMemo(() => {
    const needed = findable.filter(
      (entity) =>
        data?.museumItemIds.has(entity.id) === true &&
        !donated.has(entity.id) &&
        matchesQuery(entity),
    )
    const places = data?.places ?? new Map()
    // Sorted and grouped by the name alone, so a mine's floor range cannot
    // change where its heading lands in the list.
    const placeName = (id: string): string => placeLabel(places, id).name
    return groupByKind(needed).map((group) => {
      const byPlace = new Map<string, FindableEntity[]>()
      for (const entity of group.entities) {
        for (const loc of entity.locationIds.length > 0 ? entity.locationIds : ['']) {
          byPlace.set(loc, [...(byPlace.get(loc) ?? []), entity])
        }
      }
      const grouped = [...byPlace.entries()]
        .map(([loc, entities]) => ({
          loc,
          label: loc === '' ? 'No place recorded yet' : placeName(loc),
          entities: sortEntities(entities, sort, nameOf, focus),
        }))
        .sort((a, b) => (a.loc === '' ? 1 : b.loc === '' ? -1 : a.label.localeCompare(b.label)))
      return { kind: group.kind, count: group.entities.length, places: grouped }
    })
  }, [findable, data, donated, matchesQuery, sort, nameOf, focus])
  const museumCount = useMemo(() => museumGroups.reduce((n, g) => n + g.count, 0), [museumGroups])

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
                        <PlaceLink
                          id={festival.location_id}
                          places={data.places}
                          className="text-ink-mute underline decoration-rule underline-offset-4 hover:text-ink"
                        />
                      </>
                    )}
                    {/* Revealed but still not runnable — the badge keeps saying
                      so before someone plans a day around it. */}
                    {!festival.implemented && (
                      <span className="unverified ml-2 rounded-tile px-1.5 py-0.5 text-[0.625rem]">
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
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
              <p className="text-ink-mute text-sm">
                <span data-numeral>{findable.length}</span> things findable now
              </p>
              <SortPicker value={sort} onChange={setSort} />
            </div>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filter this day — a name, a place, a kind…"
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

            {/* The museum's cut of the day, above the full groups: what a
                set still wants that this instant can supply. Gold-tinted —
                the museum's colour everywhere in the app — and nested:
                kind, then place, because that is how the errand is walked. */}
            {museumCount > 0 && (
              <details
                key={`museum:${needle === '' ? '' : 'open'}`}
                open={needle !== ''}
                className="mt-3 rounded-card border border-rule px-3 py-1"
                style={{ background: 'var(--museum-tint)' }}
              >
                <summary className="tap-target cursor-pointer py-1.5 text-ink text-sm">
                  For the museum
                  <span className="text-ink-mute"> · {museumCount} still needed, findable now</span>
                </summary>
                <div className="flex flex-col gap-1 border-rule border-t pt-1.5 pb-1">
                  {museumGroups.map((group) => (
                    <details
                      key={`${group.kind}:${needle === '' ? '' : 'open'}`}
                      open={needle !== ''}
                      className="rounded-tile bg-surface/70 px-2 py-0.5"
                    >
                      <summary className="tap-target cursor-pointer py-1 text-ink text-sm">
                        {KIND_LABELS[group.kind] ?? group.kind.replace(/_/g, ' ')}
                        <span className="text-ink-faint"> · {group.count}</span>
                      </summary>
                      {group.places.map((place) => (
                        <div key={place.loc} className="mb-1.5">
                          <h4 className="mt-1 text-[0.6875rem] text-ink-mute uppercase tracking-wide">
                            {place.loc === '' ? (
                              place.label
                            ) : (
                              <PlaceLink
                                id={place.loc}
                                places={data.places}
                                className="underline decoration-transparent underline-offset-2 transition-colors hover:decoration-rule"
                              />
                            )}
                          </h4>
                          <ul className="flex flex-col divide-y divide-rule">
                            {place.entities.map((entity) => (
                              <FindableRow
                                key={entity.id}
                                entity={entity}
                                index={data.index}
                                places={data.places}
                              />
                            ))}
                          </ul>
                        </div>
                      ))}
                    </details>
                  ))}
                </div>
              </details>
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
                  <summary className="tap-target cursor-pointer py-1.5 text-ink text-sm">
                    {KIND_LABELS[group.kind] ?? group.kind.replace(/_/g, ' ')}
                    <span className="text-ink-faint"> · {group.entities.length}</span>
                  </summary>
                  <ul className="flex flex-col divide-y divide-rule border-rule border-t">
                    {group.entities.map((entity) => (
                      <FindableRow
                        key={entity.id}
                        entity={entity}
                        index={data.index}
                        places={data.places}
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
