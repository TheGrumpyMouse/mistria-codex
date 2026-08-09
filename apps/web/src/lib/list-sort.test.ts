import { describe, expect, it } from 'vitest'
import { NO_FOCUS, type SortableEntity, sortEntities } from './list-sort'

const SPRING = 1
const SUMMER = 2
const FALL = 4
const WINTER = 8
const ALL_YEAR = SPRING | SUMMER | FALL | WINTER

const CLEAR = 1
const RAIN = 2
const STORM = 4
const WIND = 8
const SPRING_ALL = CLEAR | RAIN | STORM | WIND

const entity = (id: string, seasonMask: number, weatherMask: number): SortableEntity => ({
  id,
  seasonMask,
  weatherMask,
})

const order = (
  entities: SortableEntity[],
  sort: 'name' | 'season' | 'weather',
  focus = NO_FOCUS,
): string[] => sortEntities(entities, sort, (e) => e.id, focus).map((e) => e.id)

describe('sortEntities', () => {
  it('sorts by name, and name is always the last word', () => {
    const list = [
      entity('cod', SPRING, SPRING_ALL),
      entity('anchovy', ALL_YEAR, CLEAR),
      entity('bass', SPRING, RAIN),
    ]
    expect(order(list, 'name')).toEqual(['anchovy', 'bass', 'cod'])
    // Two rows the season sort cannot separate still come back in one order.
    expect(order([entity('b', SPRING, CLEAR), entity('a', SPRING, CLEAR)], 'season')).toEqual([
      'a',
      'b',
    ])
  })

  it('puts the narrowest season window first and all-year last', () => {
    const list = [
      entity('allyear', ALL_YEAR, SPRING_ALL),
      entity('two', SPRING | FALL, SPRING_ALL),
      entity('one', SPRING, SPRING_ALL),
    ]
    expect(order(list, 'season', { season: 'spring', weather: null })).toEqual([
      'one',
      'two',
      'allyear',
    ])
  })

  it('clusters seasons in calendar order, not alphabetical', () => {
    // Sorting the names as text runs fall, spring, summer, winter — and every
    // other season list in the app runs spring first. A sort that alone
    // disagreed would read as a bug in the data rather than a choice.
    const list = [
      entity('w', WINTER, CLEAR),
      entity('f', FALL, CLEAR),
      entity('sp', SPRING, CLEAR),
      entity('su', SUMMER, CLEAR),
    ]
    expect(order(list, 'season')).toEqual(['sp', 'su', 'f', 'w'])
  })

  it('clusters weathers in canonical order, not alphabetical', () => {
    // snow sorts before storm as text and after it in the game's order.
    const list = [entity('snowy', WINTER, 16 /* snow */), entity('stormy', SPRING, STORM)]
    expect(order(list, 'weather')).toEqual(['stormy', 'snowy'])
  })

  it('sinks a season window the focus is outside of', () => {
    // Unreachable on today's screens — a chosen season has already filtered
    // these out — but a caller that does not filter must not get them ranked
    // as this season's specialities.
    const list = [
      entity('elsewhere', WINTER, CLEAR),
      entity('allyear', ALL_YEAR, SPRING_ALL),
      entity('here', SPRING, SPRING_ALL),
    ]
    expect(order(list, 'season', { season: 'spring', weather: null })).toEqual([
      'here',
      'allyear',
      'elsewhere',
    ])
  })

  it('puts what the weather brings above what is there anyway', () => {
    // And below both, the thing this weather rules out: a storm-only fish on a
    // rainy day is not a weaker opportunity, it is not an opportunity. Tier 2
    // is unreachable on today's screens — the weather chip has already filtered
    // it — but the order must be right the day a caller does not filter.
    const list = [
      entity('anytime', SPRING, SPRING_ALL),
      entity('rainonly', SPRING, RAIN),
      entity('stormonly', SPRING, STORM),
    ]
    expect(order(list, 'weather', { season: null, weather: 'rain' })).toEqual([
      'rainonly',
      'anytime',
      'stormonly',
    ])
  })

  it('reads an unrestricted window as unrestricted, whatever the mask says', () => {
    // A mine drop has no weather at all and ships as every legal weather —
    // indistinguishable from "bites in anything", and correctly so. Neither
    // narrows anything, so neither may outrank a genuine restriction.
    const list = [entity('mine', SPRING, SPRING_ALL), entity('windy', SPRING, WIND)]
    expect(order(list, 'weather')).toEqual(['windy', 'mine'])
  })

  it('clusters rows that share a tag rather than interleaving them', () => {
    const list = [
      entity('rain_b', SPRING, RAIN),
      entity('storm_a', SPRING, STORM),
      entity('rain_a', SPRING, RAIN),
    ]
    // Weather order is canonical — rain before storm — and identical tags stay
    // together, so the column reads as groups instead of noise.
    expect(order(list, 'weather')).toEqual(['rain_a', 'rain_b', 'storm_a'])
  })

  it('prefers a positive restriction over an exclusion', () => {
    // "only in rain" is a stronger statement than "not in wind", and the
    // stronger one is the one worth acting on today.
    const list = [entity('notwind', SPRING, CLEAR | RAIN | STORM), entity('rainonly', SPRING, RAIN)]
    expect(order(list, 'weather')).toEqual(['rainonly', 'notwind'])
  })

  it('leaves the input array alone', () => {
    const list = [entity('b', SPRING, CLEAR), entity('a', SPRING, CLEAR)]
    sortEntities(list, 'name', (e) => e.id)
    expect(list.map((e) => e.id)).toEqual(['b', 'a'])
  })
})
