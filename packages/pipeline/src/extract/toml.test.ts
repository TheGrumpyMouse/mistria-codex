import { describe, expect, it } from 'vitest'
import {
  bool,
  defaults,
  entries,
  field,
  GameFilesError,
  num,
  range,
  resolveIn,
  str,
  strList,
  table,
} from './toml.js'

/**
 * The sentinels are the whole point of these tests.
 *
 * The game writes `false` for "no restriction" and `"<..>"` for "derive it from
 * the name". Both look like data and neither is, and reading either literally
 * produces a record that is confidently wrong — a fish that bites in no weather
 * at all, or an item whose display name is the string `<..>`.
 */
describe('str', () => {
  it('reads a string', () => {
    expect(str('Chum')).toBe('Chum')
  })

  it('trims', () => {
    expect(str('  Chum \n')).toBe('Chum')
  })

  it('reads the derive sentinel as absent, not as a name', () => {
    expect(str('<..>')).toBe(null)
  })

  it('reads the not-applicable sentinel as absent', () => {
    expect(str('<n/a>')).toBe(null)
  })

  it('reads an empty string as absent', () => {
    expect(str('')).toBe(null)
  })

  it('refuses a number', () => {
    expect(str(75)).toBe(null)
  })
})

describe('num', () => {
  it('reads a literal', () => {
    expect(num(75)).toBe(75)
  })

  it('refuses a formula, which is what half the sell values are', () => {
    expect(num('self.recipe * 1.1')).toBe(null)
  })

  it('refuses a numeric string, because a coerced formula is a fabricated price', () => {
    expect(num('75')).toBe(null)
  })
})

describe('bool', () => {
  it('keeps false distinct from absent — false is a real answer here', () => {
    expect(bool(false)).toBe(false)
    expect(bool(undefined)).toBe(null)
  })
})

describe('strList', () => {
  it('wraps a bare string, which is how the game writes a one-element list', () => {
    expect(strList('river')).toEqual(['river'])
  })

  it('reads a list', () => {
    expect(strList(['river', 'pond'])).toEqual(['river', 'pond'])
  })

  it('reads `false` as null, which callers must read as ALL and not as none', () => {
    expect(strList(false)).toBe(null)
  })

  it('reads the crop default `seasons = -1` as null rather than as a season', () => {
    expect(strList(-1)).toBe(null)
  })

  it('drops sentinels inside a list', () => {
    expect(strList(['river', '<..>'])).toEqual(['river'])
  })
})

describe('range', () => {
  it('keeps an hour that runs past midnight as written', () => {
    expect(range([20, 26])).toEqual([20, 26])
  })

  it('refuses anything that is not two numbers', () => {
    expect(range([6])).toBe(null)
    expect(range(false)).toBe(null)
    expect(range(['6', '20'])).toBe(null)
  })
})

const DOC = {
  default: { seasons: false, rarity: 'common', hours: [6, 17] },
  butterfly: { seasons: ['spring'], hours: [6, 20] },
  count: 3,
  names: ['a', 'b'],
}

describe('entries', () => {
  it('yields only the tables, skipping [default] and any scalar keys', () => {
    expect(entries(DOC).map(([id]) => id)).toEqual(['butterfly'])
  })

  it('can be told to keep [default], for files where it is a real entry', () => {
    expect(entries(DOC, { skip: [] }).map(([id]) => id)).toEqual(['default', 'butterfly'])
  })
})

describe('field', () => {
  const base = defaults(DOC)
  const entry = DOC.butterfly as Record<string, unknown>

  it('prefers the entry', () => {
    expect(field(entry, base, 'hours')).toEqual([6, 20])
  })

  it('falls back to [default]', () => {
    expect(field(entry, base, 'rarity')).toBe('common')
  })
})

describe('table', () => {
  it('rejects an array, which is an object to typeof and not a table', () => {
    expect(table([1, 2])).toBe(null)
    expect(table({ bin: 5 })).toEqual({ bin: 5 })
  })
})

describe('resolveIn', () => {
  it('joins under the root', () => {
    expect(resolveIn('/game', 'fiddle', 'fish.toml')).toMatch(/fish\.toml$/)
  })

  it('refuses to read outside MISTRIA_GAME_DIR', () => {
    expect(() => resolveIn('/game', '..', '..', 'etc', 'passwd')).toThrow(GameFilesError)
  })
})
