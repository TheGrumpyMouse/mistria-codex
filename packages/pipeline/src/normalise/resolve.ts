/**
 * Turn loose wiki tokens into controlled-vocabulary values.
 *
 * The governing rule: **an unrecognised token is recorded, never guessed.** A
 * guess becomes a wrong fact that looks exactly like a right one and is
 * effectively impossible to find later. Everything unresolved lands in
 * `build/unresolved.json` with suggestions, which is the curation to-do list.
 */
import { join } from 'node:path'
import {
  type GameDate,
  type Habitat,
  type Precision,
  type Requirement,
  SEASONS,
  type Season,
  type SpawnMethod,
  type TimeOfDay,
  type TimeRange,
  toSnakeId,
  WEATHERS,
  type Weather,
} from '@mistria/schema'
import { CURATED_DIR } from '../lib/paths.js'
import { readJsonFile } from '../lib/read-json.js'

export interface UnresolvedToken {
  token: string
  field: string
  owner: string
  suggestions: string[]
}

interface SeasonVocab {
  aliases: Record<Season, string[]>
  allSeasons: string[]
  datePattern: string
}

interface WeatherVocab {
  aliases: Record<Weather, string[]>
  allWeather: string[]
}

export interface LocationRecord {
  id: string
  name: string
  kind: string
  parent_id?: string
  habitats: Habitat[]
  aliases: string[]
  /** Story quest that has to be finished before the place exists. */
  unlock_quest?: string | null
  wiki_page?: string
}

/** Loose spellings that appear in one source and name a place indirectly. */
interface PlaceAliases {
  entries: { alias: string; id: string; reason: string }[]
}

interface LocationAliases {
  habitats: { alias: string; habitat: Habitat; policy: string }[]
  ignore: string[]
  depthPattern: string
  requiresPattern: string
  entries: { alias: string; id: string | null; method?: SpawnMethod; note?: string }[]
}

/** Case- and punctuation-insensitive key, so "Deep Woods" matches "deep woods". */
const fold = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

interface TimeLabelVocab {
  noRestriction: string[]
  ranges: Record<string, { from: TimeOfDay; to: TimeOfDay }>
  hoursPattern: string
}

/** "6 AM" -> "06:00", "12 AM" -> "00:00", "12 PM" -> "12:00". */
function to24h(hour: number, meridiem: string): TimeOfDay | null {
  if (!Number.isInteger(hour) || hour < 1 || hour > 12) return null
  const isPm = meridiem.toUpperCase() === 'PM'
  const h = hour === 12 ? (isPm ? 12 : 0) : isPm ? hour + 12 : hour
  return `${String(h).padStart(2, '0')}:00`
}

/** Small edit distance, only ever used to suggest fixes in a report. */
function editDistance(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = prev[0] ?? 0
    prev[0] = i
    for (let j = 1; j <= b.length; j += 1) {
      const temp = prev[j] ?? 0
      prev[j] = Math.min(
        (prev[j] ?? 0) + 1,
        (prev[j - 1] ?? 0) + 1,
        diagonal + (a[i - 1] === b[j - 1] ? 0 : 1),
      )
      diagonal = temp
    }
  }
  return prev[b.length] ?? 0
}

export interface LocationResolution {
  locations: string[]
  habitats: Habitat[]
  depth: { min: number; max: number } | null
  requires: Requirement[]
  methods: SpawnMethod[]
  /** True when a token said something real that we could not pin to a place. */
  hasGap: boolean
}

export class Resolver {
  readonly unresolved: UnresolvedToken[] = []

  private constructor(
    private readonly seasons: SeasonVocab,
    private readonly weather: WeatherVocab,
    readonly locations: LocationRecord[],
    private readonly locationAliases: LocationAliases,
    private readonly timeLabels: TimeLabelVocab,
    private readonly locationByAlias: Map<string, LocationRecord>,
    private readonly habitatByAlias: Map<string, Habitat>,
    private readonly ignored: Set<string>,
    /**
     * Spellings that name a place without being one of its names — the rooms
     * and shorthands that only ever appear in NPC schedules. Kept apart from
     * `locationByAlias` because these resolve to an id that may not have been
     * registered yet: buildings are added from `sources/` after load.
     */
    private readonly idByLooseAlias: Map<string, string>,
  ) {}

  /**
   * Register a location the curated vocabulary does not hold.
   *
   * Buildings come from `sources/wiki/pages/places.json`, because the region a
   * building sits in is a fact on its page rather than something to type from
   * memory — the Museum is in The Narrows. Loading that here would put a source
   * dependency inside the resolver, so the build context adds them instead.
   */
  addLocation(record: LocationRecord): void {
    if (this.locations.some((l) => l.id === record.id)) {
      throw new Error(`Duplicate location id "${record.id}".`)
    }
    this.locations.push(record)
    this.locationByAlias.set(fold(record.name), record)
    for (const alias of record.aliases) this.locationByAlias.set(fold(alias), record)
  }

  static async load(): Promise<Resolver> {
    const seasons = await readJsonFile<SeasonVocab>(join(CURATED_DIR, 'vocab', 'seasons.json'))
    const weather = await readJsonFile<WeatherVocab>(join(CURATED_DIR, 'vocab', 'weather.json'))
    const { locations } = await readJsonFile<{ locations: LocationRecord[] }>(
      join(CURATED_DIR, 'vocab', 'locations.json'),
    )
    const locationAliases = await readJsonFile<LocationAliases>(
      join(CURATED_DIR, 'aliases', 'location_aliases.json'),
    )
    const timeLabels = await readJsonFile<TimeLabelVocab>(
      join(CURATED_DIR, 'vocab', 'time_labels.json'),
    )

    const locationByAlias = new Map<string, LocationRecord>()
    for (const record of locations) {
      locationByAlias.set(fold(record.name), record)
      for (const alias of record.aliases) locationByAlias.set(fold(alias), record)
    }

    const habitatByAlias = new Map<string, Habitat>()
    for (const entry of locationAliases.habitats)
      habitatByAlias.set(fold(entry.alias), entry.habitat)

    const ignored = new Set(locationAliases.ignore.map(fold))

    const placeAliases = await readJsonFile<PlaceAliases>(
      join(CURATED_DIR, 'aliases', 'schedule_places.json'),
    )
    const idByLooseAlias = new Map(placeAliases.entries.map((e) => [fold(e.alias), e.id] as const))

    return new Resolver(
      seasons,
      weather,
      locations,
      locationAliases,
      timeLabels,
      locationByAlias,
      habitatByAlias,
      ignored,
      idByLooseAlias,
    )
  }

  /**
   * Record a token this class doesn't resolve itself.
   *
   * Builders hit references the resolver knows nothing about — a shop selling
   * a cosmetic the dataset deliberately does not model yet. Those belong in
   * the same queue as everything else: a number in a
   * `data_gaps` array is invisible, whereas `pnpm data:unresolved` is the list
   * somebody actually works through.
   */
  recordUnresolved(token: string, field: string, owner: string, candidates: string[] = []): void {
    this.record(token, field, owner, candidates)
  }

  /**
   * Resolve a place to a location id, given every spelling a source offers.
   *
   * `resolveLocations` reads the loose `Items.location` column and has to cope
   * with floor ranges and catch methods mixed in with places. This is the plain
   * case: something that is meant to be a place, from a source where a miss is
   * a renamed region rather than a parsing accident.
   *
   * Several spellings because a wiki link carries two — `[[Farm|The Player's
   * Farm]]` targets a page we know and displays a phrase we don't. Which half
   * is canonical varies by page, so both are offered and the first that
   * resolves wins. Only a miss on all of them is reported.
   */
  locationId(names: string[], owner: string): string | null {
    const tried = names.map((n) => n.trim()).filter((n) => n !== '')
    for (const name of tried) {
      const place = this.locationByAlias.get(fold(name))
      if (place !== undefined) return place.id
      const loose = this.idByLooseAlias.get(fold(name))
      if (loose !== undefined) return loose
    }

    const first = tried[0]
    if (first !== undefined) this.record(first, 'location', owner, [...this.locationByAlias.keys()])
    return null
  }

  private record(token: string, field: string, owner: string, candidates: string[]): void {
    const suggestions = candidates
      .map((c) => ({ c, d: editDistance(fold(token), fold(c)) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, 3)
      .filter((s) => s.d <= Math.max(3, fold(token).length / 2))
      .map((s) => s.c)
    this.unresolved.push({ token, field, owner, suggestions })
  }

  /**
   * Resolve the season column, which holds three different kinds of value:
   * a season, several seasons, or a festival date range.
   *
   * An empty value means "not seasonal" — a tool, a cooked dish — and resolves
   * to all four seasons, because such an item is obtainable whenever. It is the
   * single most common value in the column, so getting this wrong would mis-file
   * 725 of 1,154 items.
   */
  resolveSeasons(raw: string, owner: string): { seasons: Season[]; dates: GameDate[] | null } {
    const text = raw.trim()

    const dateMatch = new RegExp(this.seasons.datePattern, 'i').exec(text)
    if (dateMatch) {
      const season = this.seasonFromWord(dateMatch[1] ?? '')
      const from = Number(dateMatch[2])
      const to = Number(dateMatch[3])
      if (season !== null && Number.isFinite(from) && Number.isFinite(to)) {
        const dates: GameDate[] = []
        for (let day = from; day <= to; day += 1) dates.push({ season, day })
        return { seasons: [season], dates }
      }
    }

    const found = SEASONS.filter((season) =>
      this.seasons.aliases[season].some((alias) => new RegExp(`\\b${alias}\\b`, 'i').test(text)),
    )
    if (found.length > 0) return { seasons: found, dates: null }

    if (this.seasons.allSeasons.some((a) => fold(a) === fold(text))) {
      return { seasons: [...SEASONS], dates: null }
    }

    this.record(text, 'season', owner, [...this.seasons.allSeasons, ...SEASONS])
    return { seasons: [...SEASONS], dates: null }
  }

  /**
   * Strip a trailing qualifier so a more-specific value can fall back to the
   * place it sits inside. Returns null when nothing was stripped, so the caller
   * doesn't retry an identical lookup.
   */
  private baseOf(token: string): string | null {
    const base = token.replace(/\s*[(,].*$/, '').trim()
    return base === '' || base === token ? null : base
  }

  private seasonFromWord(word: string): Season | null {
    for (const season of SEASONS) {
      if (this.seasons.aliases[season].some((a) => fold(a) === fold(word))) return season
    }
    return null
  }

  /**
   * Resolve a time label into concrete ranges.
   *
   * Three outcomes, and keeping them apart is the whole point:
   * - `{ ranges, precision: 'block' }` — a real window ("Night" -> 20:00-02:00)
   * - `{ ranges: null, precision: 'not_applicable' }` — "All day", i.e. no
   *   restriction exists
   * - `{ ranges: null, precision: 'unknown' }` — the cell was empty
   *
   * Collapsing the last two would either invent a restriction or hide a gap.
   */
  resolveTime(raw: string, owner: string): { ranges: TimeRange[] | null; precision: Precision } {
    const value = raw.trim()
    if (value === '') return { ranges: null, precision: 'unknown' }

    if (this.timeLabels.noRestriction.some((a) => fold(a) === fold(value))) {
      return { ranges: null, precision: 'not_applicable' }
    }

    // Explicit hours win over labels — one bug row spells them out.
    const hours = new RegExp(this.timeLabels.hoursPattern, 'gi')
    const explicit: TimeRange[] = []
    for (let m = hours.exec(value); m !== null; m = hours.exec(value)) {
      const from = to24h(Number(m[1]), m[2] ?? 'AM')
      const to = to24h(Number(m[3]), m[4] ?? 'AM')
      if (from !== null && to !== null) explicit.push({ from, to })
    }
    if (explicit.length > 0) return { ranges: explicit, precision: 'exact' }

    const labels = Object.keys(this.timeLabels.ranges).filter((label) =>
      new RegExp(`\\b${label}\\b`, 'i').test(value),
    )
    if (labels.length > 0) {
      const ranges = labels.map((label) => {
        const range = this.timeLabels.ranges[label]
        return { from: range?.from ?? '00:00', to: range?.to ?? '00:00' }
      })
      return { ranges, precision: 'block' }
    }

    this.record(value, 'time', owner, [
      ...this.timeLabels.noRestriction,
      ...Object.keys(this.timeLabels.ranges),
    ])
    return { ranges: null, precision: 'unknown' }
  }

  /** `null` here means the source said nothing, which the caller treats as a gap. */
  resolveWeather(tokens: string[], owner: string): Weather[] | null {
    if (tokens.length === 0) return null

    const result = new Set<Weather>()
    for (const token of tokens) {
      if (this.weather.allWeather.some((a) => fold(a) === fold(token))) {
        for (const w of WEATHERS) result.add(w)
        continue
      }
      const match = WEATHERS.find((w) =>
        this.weather.aliases[w].some((a) => fold(a) === fold(token)),
      )
      if (match !== undefined) {
        result.add(match)
        continue
      }
      this.record(token, 'weather', owner, [
        ...this.weather.allWeather,
        ...WEATHERS.flatMap((w) => this.weather.aliases[w]),
      ])
    }

    return result.size > 0 ? [...result] : null
  }

  /**
   * Resolve the location column, which mixes places with things that are not
   * places at all: floor ranges, catch methods, and perk gates.
   *
   * Each of those is pulled out into the field it actually belongs in — `depth`,
   * `method`, `requires` — rather than being dropped or mistaken for a location.
   */
  resolveLocations(tokens: string[], owner: string): LocationResolution {
    const locations = new Set<string>()
    const habitats = new Set<Habitat>()
    const methods = new Set<SpawnMethod>()
    const requires: Requirement[] = []
    let depth: { min: number; max: number } | null = null
    let hasGap = false

    const depthRe = new RegExp(this.locationAliases.depthPattern, 'i')
    const requiresRe = new RegExp(this.locationAliases.requiresPattern, 'ig')

    for (const original of tokens) {
      let token = original.trim()
      if (token === '') continue

      const depthMatch = depthRe.exec(token)
      if (depthMatch) {
        const numbers = (depthMatch[1] ?? '').match(/\d+/g)?.map(Number) ?? []
        if (numbers.length >= 2) {
          const min = Math.min(...numbers)
          const max = Math.max(...numbers)
          depth =
            depth === null
              ? { min, max }
              : { min: Math.min(depth.min, min), max: Math.max(depth.max, max) }
        }
        continue
      }

      // Pull any "(requires X Skill)" or "(requires Story Quest "Y" to be
      // completed)" out of the token, then carry on with what's left.
      requiresRe.lastIndex = 0
      for (let m = requiresRe.exec(token); m !== null; m = requiresRe.exec(token)) {
        const key = (m[1] ?? '').trim()
        if (key === '') continue
        requires.push(
          m[2] === 'Skill'
            ? { type: 'perk', key: toSnakeId(key), op: 'has', value: null }
            : { type: 'quest', key: toSnakeId(key), op: 'done', value: null },
        )
      }
      token = token.replace(requiresRe, '').replace(/\s+/g, ' ').trim()
      if (token === '') continue

      if (this.ignored.has(fold(token))) {
        hasGap = true
        continue
      }

      const place = this.locationByAlias.get(fold(token))
      if (place !== undefined) {
        locations.add(place.id)
        continue
      }

      const habitat = this.habitatByAlias.get(fold(token))
      if (habitat !== undefined) {
        habitats.add(habitat)
        // A habitat is a class of place, not a place — but whether that is a
        // gap depends on whether the class can be enumerated, and this class
        // does not know. The Fishing page names the three ponds, so `pond`
        // expands and is not a gap; `overworld` names nowhere and is. The
        // builder decides, once it has tried. See build/waters.ts.
        continue
      }

      const entry = this.locationAliases.entries.find((e) => fold(e.alias) === fold(token))
      if (entry !== undefined) {
        if (entry.id !== null) locations.add(entry.id)
        if (entry.method !== undefined) methods.add(entry.method)
        if (entry.id === null && entry.method === undefined) hasGap = true
        continue
      }

      // "The Narrows (north)", "The Eastern Road, near the Wishing Well".
      // The base place is a real answer; only the precision is lost. Keep the
      // location and mark the gap, rather than discarding a known place because
      // the wiki was more specific than our vocabulary.
      //
      // The qualifier becomes a spot record at D4, once the maps exist.
      const base = this.baseOf(token)
      if (base !== null) {
        const place = this.locationByAlias.get(fold(base))
        if (place !== undefined) {
          locations.add(place.id)
          hasGap = true
          continue
        }
      }

      this.record(original, 'location', owner, [
        ...this.locationByAlias.keys(),
        ...this.habitatByAlias.keys(),
      ])
      hasGap = true
    }

    return {
      locations: [...locations],
      habitats: [...habitats],
      depth,
      requires,
      methods: [...methods],
      hasGap,
    }
  }
}
