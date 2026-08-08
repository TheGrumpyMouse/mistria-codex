/**
 * "What can I go and find right now?"
 *
 * The flagship query. A rule matches an instant when **every** constraint it
 * states is satisfied — the window is an AND — and an entity is findable when
 * **any** of its rules match, because the array is an OR. A bug can be
 * spring-in-town-at-night *and* all-season-in-the-mines-any-time, and flattening
 * those two into one window produces wrong answers.
 *
 * **Unknown does not exclude.** A rule with no time intervals matches every
 * time; a rule with no location matches anywhere. 801 of 832 rules have no
 * recorded time, so excluding on unknown would empty this screen rather than
 * narrow it. The result carries what it did not know so the UI can say so.
 *
 * The scan is linear over every rule and that is the intended design, not a
 * placeholder: 832 rules times six integer comparisons is microseconds, fits in
 * cache, and has none of the bug surface of an interval tree.
 */
import {
  type DayOfWeek,
  DOW_BIT,
  SEASON_BIT,
  type Season,
  WEATHER_BIT,
  type Weather,
} from '@mistria/schema'

/** One flattened rule, exactly as shipped. */
export interface Rule {
  e: string
  k: string
  loc: number | null
  sub: number | null
  sea: number
  wx: number
  t: [number, number][]
  /** 1 when the empty `t` is a fact — the method has no clock — not a gap. */
  ta?: 1
  d: [number, number] | null
  dow: number | null
  y: number | null
  rar: number | null
  req: string[]
  p: [number, number] | null
  conf: string
}

export interface AvailabilityIndex {
  locations: string[]
  rules: Rule[]
}

export interface Instant {
  season: Season
  day: number
  year: number
  weather: Weather
  /** Minutes past midnight, or null for "any time" — which matches everything. */
  time: number | null
}

/** The seven-day week repeats exactly four times in a 28-day season. */
const DAY_NAMES: DayOfWeek[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
export const weekdayOf = (day: number): DayOfWeek => DAY_NAMES[(day - 1) % 7] as DayOfWeek

export interface Match {
  rule: Rule
  /** The location id, or null when the rule does not say. */
  locationId: string | null
  /** True when the rule states no time — the result is real but unverified. */
  timeUnknown: boolean
  /** True when the rule states no place. */
  placeUnknown: boolean
  /** Gate tokens the player may not have met. Shown, never used to hide. */
  requires: string[]
}

/**
 * Does one rule match?
 *
 * Every clause is "the rule does not constrain this, or the instant satisfies
 * it". Written that way round deliberately: the alternative — checking the
 * instant against a constraint and treating absence as failure — is how unknown
 * quietly becomes excluded.
 */
export function ruleMatches(rule: Rule, instant: Instant): boolean {
  if ((rule.sea & SEASON_BIT[instant.season]) === 0) return false
  if ((rule.wx & WEATHER_BIT[instant.weather]) === 0) return false

  if (rule.y !== null && instant.year < rule.y) return false
  if (rule.d !== null && (instant.day < rule.d[0] || instant.day > rule.d[1])) return false
  if (rule.dow !== null && (rule.dow & DOW_BIT[weekdayOf(instant.day)]) === 0) return false

  // No intervals means unconstrained. A null instant time means the player has
  // not narrowed by time, which also matches everything — both directions of
  // "unknown does not exclude" meet here.
  if (rule.t.length > 0 && instant.time !== null) {
    const minute = instant.time
    // Intervals are already split at midnight by the build, so this never has
    // to ask which side of it we are on. See apps/web/CLAUDE.md.
    if (!rule.t.some(([from, to]) => minute >= from && minute < to)) return false
  }

  return true
}

/** Every rule that matches, in the order they were shipped. */
export function findMatches(index: AvailabilityIndex, instant: Instant): Match[] {
  const matches: Match[] = []

  for (const rule of index.rules) {
    if (!ruleMatches(rule, instant)) continue
    matches.push({
      rule,
      locationId: rule.loc === null ? null : (index.locations[rule.loc] ?? null),
      // Not merely "no intervals": a dig spot has no clock at all, and that is
      // a fact (`ta`), not a gap. Only the genuinely unsourced get the hedge.
      timeUnknown: rule.t.length === 0 && rule.ta !== 1,
      placeUnknown: rule.loc === null,
      requires: rule.req,
    })
  }

  return matches
}

export interface FindableEntity {
  id: string
  kind: string
  /** Distinct locations this can be found in right now. */
  locationIds: string[]
  /** True when *every* matching rule lacked a time. */
  timeUnknown: boolean
  /** True when *every* matching rule lacked a place. */
  placeUnknown: boolean
  /** The lowest rarity across matching rules — the easiest way to get it. */
  rarity: number | null
  requires: string[]
}

/**
 * Collapse matches to one row per entity.
 *
 * `timeUnknown` and `placeUnknown` are ANDs across the matching rules: if one
 * route to the thing has a known time, the entity is not "time unknown" — it is
 * findable at a time we can name, and badging it otherwise would understate
 * what we know. The same logic as `gated` on the request board, for the same
 * reason.
 */
export function findAvailable(index: AvailabilityIndex, instant: Instant): FindableEntity[] {
  const byEntity = new Map<string, FindableEntity & { locationSet: Set<string> }>()

  for (const match of findMatches(index, instant)) {
    const existing = byEntity.get(match.rule.e) ?? {
      id: match.rule.e,
      kind: match.rule.k,
      locationIds: [],
      timeUnknown: true,
      placeUnknown: true,
      rarity: match.rule.rar,
      requires: [],
      locationSet: new Set<string>(),
    }

    if (match.locationId !== null) existing.locationSet.add(match.locationId)
    if (!match.timeUnknown) existing.timeUnknown = false
    if (!match.placeUnknown) existing.placeUnknown = false
    if (match.rule.rar !== null) {
      existing.rarity =
        existing.rarity === null ? match.rule.rar : Math.min(existing.rarity, match.rule.rar)
    }
    for (const token of match.requires) {
      if (!existing.requires.includes(token)) existing.requires.push(token)
    }

    byEntity.set(match.rule.e, existing)
  }

  return [...byEntity.values()].map(({ locationSet, ...entity }) => ({
    ...entity,
    locationIds: [...locationSet].sort(),
  }))
}

export interface FoundEntity {
  id: string
  kind: string
  /** Which of the four seasons any rule here covers, as season names. */
  seasonMask: number
}

/**
 * Everything obtainable at a set of places, regardless of when.
 *
 * The planning-view complement to `findAvailable`: no instant, just "what
 * comes from here". Takes a *set* of location ids because a region and the
 * buildings inside it are different location records — the map's region panel
 * passes the region plus its children, so a fish caught at the Tackle Shop's
 * pier still counts as "at the Beach". Seasons are unioned across rules the
 * same way `findAvailable` unions locations.
 */
export function foundAt(index: AvailabilityIndex, placeIds: Set<string>): FoundEntity[] {
  const byEntity = new Map<string, FoundEntity>()

  for (const rule of index.rules) {
    if (rule.loc === null) continue
    const locationId = index.locations[rule.loc]
    if (locationId === undefined || !placeIds.has(locationId)) continue

    const existing = byEntity.get(rule.e)
    if (existing === undefined) {
      byEntity.set(rule.e, { id: rule.e, kind: rule.k, seasonMask: rule.sea })
    } else {
      existing.seasonMask |= rule.sea
    }
  }

  return [...byEntity.values()]
}

/** Group findables by kind, in the order the Today view shows them. */
export const KIND_ORDER = [
  'forage',
  'fish',
  'bug',
  'crop',
  'dig',
  'mine_drop',
  'shop_stock',
] as const

export const KIND_LABELS: Record<string, string> = {
  forage: 'Forage',
  fish: 'Fish',
  bug: 'Bugs',
  crop: 'Crops ready',
  dig: 'Dig spots',
  mine_drop: 'In the mines',
  shop_stock: 'In the shops',
}

export function groupByKind(
  entities: FindableEntity[],
): { kind: string; entities: FindableEntity[] }[] {
  const groups = new Map<string, FindableEntity[]>()
  for (const entity of entities) {
    groups.set(entity.kind, [...(groups.get(entity.kind) ?? []), entity])
  }

  return KIND_ORDER.flatMap((kind) => {
    const found = groups.get(kind)
    return found === undefined || found.length === 0 ? [] : [{ kind, entities: found }]
  })
}
