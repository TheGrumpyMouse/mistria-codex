import {
  SEASON_BIT,
  SEASONS,
  type Season,
  WEATHER_BIT,
  WEATHERS,
  type Weather,
} from '@mistria/schema'
import { useCallback, useSyncExternalStore } from 'react'
import { weatherRestriction } from './findable'

/**
 * How a findable list is ordered: alphabetically, or with the narrowest
 * windows first.
 *
 * **Season and weather do not sort by their value — they sort by how much they
 * narrow.** That is not a liberty taken with the request; it is the only
 * reading that says anything on these two screens. Every row on the calendar
 * already matches the chosen season and weather, and every row under a map
 * chip already matches the chip, so "put spring first" would put everything
 * first. What actually differs between two rows on the same day is whether the
 * thing is there *because* of today — rain-only, spring-only — or there
 * anyway. Ordering by that answers "what disappears tomorrow", which is the
 * question a calendar is asked.
 *
 * With no season or weather chosen (the map's "Any" chips) there is nothing to
 * be first, so it degenerates to the same thing without a focus: constrained
 * rows above unconstrained ones, clustered by the constraint they share.
 */
export type ListSort = 'name' | 'season' | 'weather'

export const LIST_SORTS: readonly ListSort[] = ['name', 'season', 'weather']

export const LIST_SORT_LABELS: Record<ListSort, string> = {
  name: 'Name',
  season: 'Season',
  weather: 'Weather',
}

/**
 * A real preference, not a per-screen toggle — the same reasoning as
 * `display-mode`, and the same mechanism. Someone who wants alphabetical wants
 * it on the map and on the calendar, and two mounted screens stay in step
 * without a provider.
 *
 * Deliberately **not** in the URL. The instant, the region and the filters are
 * there because they change *what* is answered and a shared link must carry
 * the answer; a sort changes only the order of the same rows, so putting it in
 * the URL would make two identical answers look like different links.
 */
const KEY = 'mistria-codex:list-sort'
const listeners = new Set<() => void>()

const read = (): ListSort => {
  const stored = localStorage.getItem(KEY)
  return stored === 'season' || stored === 'weather' ? stored : 'name'
}

export function useListSort(): [ListSort, (sort: ListSort) => void] {
  const sort = useSyncExternalStore(
    useCallback((onChange) => {
      listeners.add(onChange)
      return () => listeners.delete(onChange)
    }, []),
    read,
  )

  const set = useCallback((next: ListSort) => {
    localStorage.setItem(KEY, next)
    for (const listener of listeners) listener()
  }, [])

  return [sort, set]
}

/** What "the selected weather" and "the selected season" currently are. */
export interface SortFocus {
  season: Season | null
  weather: Weather | null
}

export const NO_FOCUS: SortFocus = { season: null, weather: null }

export interface SortableEntity {
  id: string
  seasonMask: number
  weatherMask: number
}

/**
 * Three tiers, in the order a planner cares about them:
 *
 * 0. narrowed, and the focus is inside the narrowing — the reason to go today
 * 1. not narrowed at all — here whatever the day does
 * 2. narrowed, and the focus is outside it — not today
 *
 * Tier 2 is unreachable on both screens as they stand (a chosen season or
 * weather has already filtered those rows out, and the calendar's rows all
 * match its instant). It exists so that a future caller passing a focus it did
 * not filter by gets a sane answer instead of a silently wrong one.
 */
const tierFor = (narrowed: boolean, matchesFocus: boolean | null): number =>
  !narrowed ? 1 : matchesFocus === false ? 2 : 0

interface SortKey {
  tier: number
  /** Groups rows that share a constraint, so identical tags sit together. */
  cluster: number
  /**
   * Separates clusters that collide on the number above.
   *
   * Built from **canonical indices**, never from the names. Comparing
   * `'fall'` to `'spring'` as text puts autumn before spring, and every other
   * season list in the app runs spring → winter; a sort that alone disagreed
   * would read as a bug in the data. Same for weather, where the alphabet
   * would put snow ahead of storm.
   *
   * Only ever compared within one cluster, so the strings being compared
   * always have the same number of parts and lexicographic order is index
   * order.
   */
  detail: string
  name: string
}

function keyFor<T extends SortableEntity>(
  entity: T,
  sort: ListSort,
  name: string,
  focus: SortFocus,
): SortKey {
  if (sort === 'season') {
    const seasons = SEASONS.filter((s) => (entity.seasonMask & SEASON_BIT[s]) !== 0)
    const allYear = seasons.length === SEASONS.length
    return {
      tier: tierFor(!allYear, focus.season === null ? null : seasons.includes(focus.season)),
      // Fewest seasons first: "spring only" is a narrower window than "spring
      // and fall", and the narrower one is the one with a deadline.
      cluster: seasons.length,
      detail: seasons.map((s) => SEASONS.indexOf(s)).join(','),
      name,
    }
  }

  if (sort === 'weather') {
    const note = weatherRestriction(entity.seasonMask, entity.weatherMask)
    const matches =
      focus.weather === null ? null : (entity.weatherMask & WEATHER_BIT[focus.weather]) !== 0
    return {
      tier: tierFor(note !== null, matches),
      // "only in rain" above "not in wind": a positive list is the stronger
      // statement, and within each the canonical weather order keeps rain with
      // rain rather than scattering it alphabetically.
      cluster:
        note === null
          ? 0
          : (note.kind === 'only' ? 0 : WEATHERS.length + 1) +
            WEATHERS.indexOf(note.weathers[0] as Weather),
      detail: note === null ? '' : note.weathers.map((w) => WEATHERS.indexOf(w)).join(','),
      name,
    }
  }

  return { tier: 0, cluster: 0, detail: '', name }
}

/**
 * Order a list of findables. Stable in the only sense that matters: the name is
 * always the final tiebreak, so the same set never comes back in two orders.
 *
 * Decorated up front rather than compared lazily — `weatherRestriction` is not
 * free and a comparator would call it O(n log n) times on a list that can run
 * to several hundred rows under the Narrows.
 */
export function sortEntities<T extends SortableEntity>(
  entities: readonly T[],
  sort: ListSort,
  nameOf: (entity: T) => string,
  focus: SortFocus = NO_FOCUS,
): T[] {
  return entities
    .map((entity) => ({ entity, key: keyFor(entity, sort, nameOf(entity), focus) }))
    .sort(
      (a, b) =>
        a.key.tier - b.key.tier ||
        a.key.cluster - b.key.cluster ||
        a.key.detail.localeCompare(b.key.detail) ||
        a.key.name.localeCompare(b.key.name),
    )
    .map(({ entity }) => entity)
}
