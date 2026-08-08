import type { Season, Weather } from '@mistria/schema'
import { beforeAll, describe, expect, it } from 'vitest'
import { findables, type Match } from './findables.js'

/**
 * End-to-end assertions against the real built dataset.
 *
 * These are the D1 acceptance criteria: the availability model has to answer
 * "what can I find right now" correctly, and be honest about what it doesn't
 * know. Expectations are stated as **explicit item names**, not counts — a
 * count passes for the wrong reason the moment the corpus changes.
 *
 * Requires `pnpm build:data` to have run.
 */

let cache = new Map<string, Match[]>()

const at = async (season: Season, weather: Weather, minute = 720): Promise<Match[]> => {
  const key = `${season}|${weather}|${minute}`
  const hit = cache.get(key)
  if (hit) return hit
  const result = await findables({ season, day: 12, weather, minute })
  cache.set(key, result)
  return result
}

const names = async (season: Season, weather: Weather): Promise<Set<string>> =>
  new Set((await at(season, weather)).map((m) => m.item.name))

beforeAll(() => {
  cache = new Map()
})

describe('season filtering', () => {
  it('includes a spring fish in spring and excludes it in winter', async () => {
    // Anchovy is Spring, any weather.
    expect(await names('spring', 'clear')).toContain('Anchovy')
    expect(await names('winter', 'clear')).not.toContain('Anchovy')
  })
})

describe('weather filtering', () => {
  it('respects a rain-only fish', async () => {
    // Walleye: Spring, weather Rain/Rainy — which fold to the same state.
    expect(await names('spring', 'rain')).toContain('Walleye')
    expect(await names('spring', 'clear')).not.toContain('Walleye')
    expect(await names('spring', 'wind')).not.toContain('Walleye')
  })

  it('respects a wind-only legendary', async () => {
    // Cherry Fish: Spring, Windy, legendary.
    expect(await names('spring', 'wind')).toContain('Cherry Fish')
    expect(await names('spring', 'clear')).not.toContain('Cherry Fish')
    expect(await names('fall', 'wind')).not.toContain('Cherry Fish')
  })

  it('respects a snow/blizzard winter fish', async () => {
    expect(await names('winter', 'blizzard')).toContain('Burbot')
    expect(await names('winter', 'snow')).toContain('Burbot')
    expect(await names('winter', 'clear')).not.toContain('Burbot')
  })

  it('never claims rain for a winter-only "any weather" fish', async () => {
    // 126 of 143 fish say "Any". Stored literally, a winter-only fish would
    // claim it bites in rain — and winter has no rain. The build narrows "Any"
    // to the weather its seasons can actually have.
    //
    // Only *season-restricted* windows narrow. A fish available all year keeps
    // rain, correctly: it can be caught in the rain in spring.
    const winterOnly = (await at('winter', 'clear')).filter(
      (m) => m.item.category === 'fish' && m.window.seasons.length === 1,
    )
    expect(winterOnly.length).toBeGreaterThan(5)
    for (const match of winterOnly) {
      expect(match.window.weather).not.toContain('rain')
      expect(match.window.weather).not.toContain('storm')
    }
  })

  it('leaves an all-season fish its full weather range', async () => {
    const allSeason = (await at('spring', 'rain')).filter(
      (m) =>
        m.item.category === 'fish' && m.window.seasons.length === 4 && m.window.weather !== null,
    )
    expect(allSeason.length).toBeGreaterThan(0)
    expect(allSeason.some((m) => m.window.weather?.includes('rain'))).toBe(true)
  })
})

describe('honesty about gaps', () => {
  it('treats fish time as not applicable, not as a gap', async () => {
    // Time of day has no effect on fishing in this game — verified against the
    // wiki (which carries a `time` column for bugs and none for fish anywhere)
    // and community guides. So a null time here is "no such restriction", not
    // "nobody recorded it". Badging it unknown would put a warning on every
    // fish in the app that no amount of curation could ever clear.
    const results = await at('fall', 'rain', 19 * 60)
    const fish = results.filter((m) => m.item.category === 'fish')
    expect(fish.length).toBeGreaterThan(0)
    for (const match of fish) {
      expect(match.window.time_precision).toBe('not_applicable')
      expect(match.unknowns).not.toContain('time')
    }
  })

  it('still treats bug time as unknown, since bugs do have windows', async () => {
    // The counter-case. Bugs are not ingested until D2, but the rule that
    // governs them must already be the conservative one: a method absent from
    // method_rules.json defaults to unknown rather than not-applicable.
    const { readFile } = await import('node:fs/promises')
    const rules = JSON.parse(
      await readFile(
        new URL('../../../../curated/vocab/method_rules.json', import.meta.url),
        'utf8',
      ),
    )
    expect(rules.timeNotApplicable).not.toContain('bug_net')
    expect(rules.timeNotApplicable).not.toContain('foraging')
  })

  it('expands a habitat into the places that hold it, and marks it inferred', async () => {
    // "River" is four rivers, and the Fishing page names all four. The window
    // gets every one of them so a pin can be drawn, and `confidence: inferred`
    // so those pins are drawn hollow — the wiki said which rivers exist, not
    // which one this fish is in.
    const results = await at('spring', 'rain')
    const walleye = results.find((m) => m.item.name === 'Walleye')
    expect(walleye?.window.habitats).toEqual(['river'])
    expect(walleye?.window.locations).toEqual([
      'mistria',
      'the_eastern_road',
      'the_farm',
      'the_narrows',
    ])
    expect(walleye?.window.confidence).toBe('inferred')
  })

  it('still reports a bug found "in the overworld" as having no location', async () => {
    // The one habitat that stays unexpanded: it means "outdoors, nowhere in
    // particular", and nine pins would dress an absence up as nine facts.
    const results = await at('spring', 'rain')
    const overworld = results.find((m) => m.window.habitats.includes('overworld'))
    expect(overworld?.window.locations).toEqual([])
    expect(overworld?.unknowns).toContain('location')
  })

  it('resolves a concrete location where the wiki gave one', async () => {
    const results = await at('fall', 'rain')
    const apple = results.find((m) => m.item.name === 'Apple')
    expect(apple?.window.locations).toEqual(['the_eastern_road'])
    expect(apple?.unknowns).not.toContain('location')
  })
})

describe('the D1 acceptance query', () => {
  it('answers "fall, raining, 7pm — what can I catch?"', async () => {
    const results = await at('fall', 'rain', 19 * 60)
    expect(results.length).toBeGreaterThan(0)

    const fish = results.filter((m) => m.item.category === 'fish')
    expect(fish.length).toBeGreaterThan(20)

    // Every result must carry a method and a price or an explicit gap — the
    // screen has nothing to render otherwise.
    for (const match of results) {
      expect(match.window.method).toBeTruthy()
      if (match.item.sell_value === null) {
        expect(match.item.data_gaps).toContain('sell_value')
      }
    }
  })
})
