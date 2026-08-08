import { getRouteApi } from '@tanstack/react-router'
import { useEffect, useMemo, useState } from 'react'
import { Column } from '~/app/AppShell'
import { DayDial } from '~/components/DayDial'
import { FindableList } from '~/components/FindableList'
import { type DisplayIndex, loadAvailability, loadDataset, loadDisplayIndex } from '~/lib/data'
import { type AvailabilityIndex, findAvailable } from '~/lib/findable'
import { formatDate, type Instant, titleCase, weekdayOf } from '~/lib/instant'

interface TodayData {
  availability: AvailabilityIndex
  index: DisplayIndex
  locationNames: Map<string, string>
}

const route = getRouteApi('/')

/**
 * The flagship screen: it is Fall 12, Year 2, it's raining, it's 4pm — what can
 * I go and do?
 *
 * At A0 the picker is real and the answer is not. That is deliberate: the
 * instant is the whole state of this screen, it belongs in the URL, and getting
 * that right is what A4 plugs the query engine into. Building the picker last
 * would mean building it twice.
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

  const [data, setData] = useState<TodayData | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    Promise.all([
      loadAvailability(),
      loadDisplayIndex(),
      loadDataset<{ id: string; name: string }>('locations'),
    ])
      .then(([availability, index, locations]) => {
        if (!live) return
        setData({
          availability,
          index,
          locationNames: new Map(locations.map((l) => [l.id, l.name])),
        })
      })
      .catch((err: unknown) => live && setError(err instanceof Error ? err.message : String(err)))
    return () => {
      live = false
    }
  }, [])

  // Recomputed only when the instant or the data changes. Dragging the time
  // slider re-runs an 832-rule integer scan, which is microseconds — the memo is
  // for React's sake, not the query's.
  const findable = useMemo(
    () => (data === null ? [] : findAvailable(data.availability, instant)),
    [data, instant],
  )

  return (
    <Column>
      <div className="flex flex-col gap-5">
        <header>
          <h1 className="text-2xl">Today</h1>
          <p className="mt-0.5 text-ink-mute text-sm">
            {formatDate(instant)} · {weekdayOf(instant.day)} · {titleCase(instant.weather)}
          </p>
        </header>

        <DayDial value={instant} onChange={update} />

        {error !== null && (
          <p className="text-gap text-sm">
            The data could not be loaded. Run <code>pnpm build:ship</code> and reload.
          </p>
        )}

        {error === null && data === null && (
          <p className="text-ink-mute text-sm">Working out what is findable…</p>
        )}

        {data !== null && (
          <p className="-mt-2 text-ink-mute text-sm">
            <span data-numeral>{findable.length}</span> things findable now.
          </p>
        )}

        {data !== null && (
          <FindableList entities={findable} index={data.index} locationNames={data.locationNames} />
        )}
      </div>
    </Column>
  )
}
