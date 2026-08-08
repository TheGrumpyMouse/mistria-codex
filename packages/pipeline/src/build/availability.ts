/**
 * Flatten the availability windows into the shape the query wants.
 *
 * `data/` nests windows on the entity because that reviews well in a pull
 * request. The runtime wants the opposite: **one flat rule per (entity, window,
 * location)** with every string already turned into an integer, so answering
 * "what can I find now" is a linear scan of integer comparisons rather than a
 * walk over nested arrays of strings.
 *
 * Three translations happen here and each exists to keep a special case out of
 * the client:
 *
 * 1. **Seasons and weather become bitmasks.** A match is then an AND, not a set
 *    intersection over string arrays.
 * 2. **Time ranges are split at midnight.** A window running 20:00-02:00 ships
 *    as two intervals, so runtime code never contains `if (start > end)` — the
 *    highest-density bug area in this whole project.
 * 3. **A window with no location becomes one rule with no location**, not zero
 *    rules. Dropping it would silently hide everything whose place is unknown,
 *    which is most of the forageables.
 */
import type {
  AvailabilityKind,
  AvailabilityRule,
  AvailabilityWindow,
  Item,
  Season,
  Weather,
} from '@mistria/schema'
import {
  dowMask,
  SEASON_LEGAL_WEATHER,
  seasonMask,
  WEATHER_MASK_ALL,
  weatherMask,
} from '@mistria/schema'

/** Which query bucket a gathering method belongs to. */
const KIND_BY_METHOD: Record<string, AvailabilityKind> = {
  fishing: 'fish',
  diving: 'fish',
  fish_trap: 'fish',
  bug_net: 'bug',
  foraging: 'forage',
  crop_harvest: 'crop',
  dig_spot: 'dig',
  mine_drop: 'mine_drop',
  shop: 'shop_stock',
}

const RARITY_ORDINAL: Record<string, number> = {
  common: 0,
  uncommon: 1,
  rare: 2,
  very_rare: 3,
  legendary: 4,
}

/** `"06:00"` -> 360. */
export function minutes(clock: string): number {
  const [h, m] = clock.split(':').map(Number)
  return (h ?? 0) * 60 + (m ?? 0)
}

/**
 * Split a possibly-wrapping range into non-wrapping minute intervals.
 *
 * `20:00-02:00` becomes `[[1200, 1440], [0, 120]]`. This is the single reason
 * the client can compare a minute against an interval without asking which side
 * of midnight it is on — and why `apps/web/CLAUDE.md` forbids `start > end`
 * outright rather than merely discouraging it.
 *
 * A range that starts and ends at the same minute is a full day, not an empty
 * one: the wiki writes "06:00-06:00" for round-the-clock.
 */
export function splitAtMidnight(from: string, to: string): [number, number][] {
  const start = minutes(from)
  const end = minutes(to)
  if (start === end) return [[0, 1440]]
  if (start < end) return [[start, end]]
  return [
    [start, 1440],
    [0, end],
  ]
}

/**
 * The weather a window really allows, as a mask.
 *
 * Intersected with what the season can physically produce, so a spring rule can
 * never claim snow and "any weather" stays honest. A window with `weather: null`
 * is *not applicable* — mines and interiors have none — which is every weather,
 * not no weather.
 */
export function windowWeatherMask(
  weather: readonly Weather[] | null,
  seasons: readonly Season[],
): number {
  const stated = weather === null ? WEATHER_MASK_ALL : weatherMask(weather)
  const legal = seasons.reduce((mask, season) => mask | SEASON_LEGAL_WEATHER[season], 0)
  return stated & legal
}

/**
 * Specific dates as an inclusive day-of-season range.
 *
 * The shipped rule holds a range, not a list, and collapsing a list into one is
 * only lossless when the days are **contiguous and in a single season** — the
 * Breath of Spring is Spring 14-16, the Queen Berry is Fall 7-10, and those are
 * the only two windows in the corpus with dates at all. A gappy or
 * season-spanning list would silently widen to include days the thing is not
 * there, so it returns null instead and the window keeps its season constraint
 * only. Under-constraining shows an extra day; over-collapsing invents one.
 */
export function dayRange(
  dates: readonly { season: string; day: number }[] | null,
): [number, number] | null {
  if (dates === null || dates.length === 0) return null
  if (new Set(dates.map((d) => d.season)).size !== 1) return null

  const days = [...dates.map((d) => d.day)].sort((a, b) => a - b)
  const first = days[0] as number
  const last = days[days.length - 1] as number
  return last - first + 1 === days.length ? [first, last] : null
}

export interface FlattenInput {
  id: string
  availability: AvailabilityWindow[]
}

/**
 * One rule per (entity, window, location).
 *
 * Locations are emitted as indexes into a table shipped alongside, because the
 * id repeats thousands of times and an integer is four characters instead of
 * twenty.
 */
export function flattenAvailability(
  entities: FlattenInput[],
  locationIds: string[],
  requirementLabel: (r: FlattenInput['availability'][number]['requires'][number]) => string = (r) =>
    `${r.type}:${r.key}`,
): AvailabilityRule[] {
  const indexOf = new Map(locationIds.map((id, i) => [id, i]))
  const rules: AvailabilityRule[] = []

  for (const entity of entities) {
    for (const window of entity.availability) {
      const kind = KIND_BY_METHOD[window.method]
      if (kind === undefined) continue

      const sea = seasonMask(window.seasons)
      // A window with no season matches nothing and is a bug upstream, not a
      // rule to ship — every window carries fully expanded seasons by contract.
      if (sea === 0) continue

      // **A null time is every time, not no time.** 459 of 487 windows have
      // one, because the wiki barely records time at all — treating that as
      // "excluded" would empty the flagship screen. It ships as no intervals,
      // which the matcher reads as unconstrained, and the UI badges it.
      const t = (window.time ?? []).flatMap((range) => splitAtMidnight(range.from, range.to))
      const wx = windowWeatherMask(window.weather, window.seasons)

      const base = {
        e: entity.id,
        k: kind,
        sea,
        wx,
        t,
        d: dayRange(window.dates),
        dow: window.days === null ? null : dowMask(window.days),
        y: window.min_year,
        rar: window.rarity === null ? null : (RARITY_ORDINAL[window.rarity] ?? null),
        // Display-ready. The app only ever shows these — gates are shown, never
        // used to hide — so the token carries the human name where the caller
        // can supply one. The old form concatenated key and op into
        // `perk:well_placedhas`, which rendered exactly like the bug it was.
        req: window.requires.map(requirementLabel),
        p: null,
        conf: window.confidence,
        // An empty `t` alone cannot say whether the method has no clock or
        // nobody has checked — that distinction lives in `time_precision` on
        // the nested window, and this is it surviving the flattening.
        ...(t.length === 0 && window.time_precision === 'not_applicable' ? { ta: 1 as const } : {}),
      }

      // No location is one rule with `loc: null`, never zero rules. Dropping it
      // would hide everything whose place is unknown, which is most of the
      // forageables — and "we do not know where" is not "it does not exist".
      if (window.locations.length === 0) {
        rules.push({ ...base, loc: null, sub: null })
        continue
      }

      for (const locationId of window.locations) {
        rules.push({ ...base, loc: indexOf.get(locationId) ?? null, sub: null })
      }
    }
  }

  return rules
}

/** Everything the shipped index needs, in one object. */
export interface AvailabilityBundle {
  /** Location ids, in the order rules index into. */
  locations: string[]
  rules: AvailabilityRule[]
}

export function buildAvailabilityBundle(
  items: Item[],
  locationIds: string[],
  names?: { perks: Map<string, string>; quests: Map<string, string> },
): AvailabilityBundle {
  // `perk:Well Placed`, `quest:Repair the Beach Bridge`. The type prefix stays
  // so the app can phrase each kind ("the X perk" / "finish 'X'"); the name is
  // resolved here because the app has no reason to download skills.json just
  // to label a pill.
  const label = (r: { type: string; key: string }): string => {
    const name =
      r.type === 'perk'
        ? names?.perks.get(r.key)
        : r.type === 'quest'
          ? names?.quests.get(r.key)
          : undefined
    return `${r.type}:${name ?? r.key}`
  }

  return {
    locations: locationIds,
    rules: flattenAvailability(
      items.map((item) => ({ id: item.id, availability: item.availability })),
      locationIds,
      label,
    ),
  }
}
