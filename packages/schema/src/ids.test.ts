import { describe, expect, it } from 'vitest'
import { isValidId, toSnakeId } from './ids.js'

/**
 * `toSnakeId`'s output becomes a database key, so its behaviour is pinned here
 * rather than left to whatever a dependency happens to do this month. These are
 * real names from the game, chosen because each one breaks a naive slugifier.
 */
describe('toSnakeId', () => {
  it('lowercases and joins words', () => {
    expect(toSnakeId('Rainbow Trout')).toBe('rainbow_trout')
    expect(toSnakeId('Breath of Spring')).toBe('breath_of_spring')
  })

  it('folds accents rather than dropping the letter', () => {
    // The naive result is "c_line", which would collide with nothing and be
    // impossible to spot in a diff of 1,154 items.
    expect(toSnakeId('Céline')).toBe('celine')
    expect(toSnakeId('Café')).toBe('cafe')
  })

  it('treats apostrophes as joining, not separating', () => {
    expect(toSnakeId("Balor's Wagon")).toBe('balors_wagon')
    expect(toSnakeId('Errol’s Cabin')).toBe('errols_cabin')
  })

  it('spells out ampersands', () => {
    expect(toSnakeId('Salt & Pepper')).toBe('salt_and_pepper')
  })

  it('collapses punctuation and runs of separators', () => {
    expect(toSnakeId('Tide Caverns (Floors 21-39)')).toBe('tide_caverns_floors_21_39')
    expect(toSnakeId('  Spaced   Out  ')).toBe('spaced_out')
    expect(toSnakeId('Home Upgrade — Level 4')).toBe('home_upgrade_level_4')
  })

  it('keeps digits', () => {
    expect(toSnakeId('Copper Ore x5')).toBe('copper_ore_x5')
  })

  it('always produces a valid id for real names', () => {
    const names = [
      'Rainbow Trout',
      'Céline',
      "Balor's Wagon",
      'Salt & Pepper',
      'Perfect Pink Diamond',
      'Tide Caverns (Floors 21-39)',
    ]
    for (const name of names) expect(isValidId(toSnakeId(name))).toBe(true)
  })

  it('is idempotent — slugifying a slug changes nothing', () => {
    for (const name of ['Rainbow Trout', "Balor's Wagon", 'Salt & Pepper']) {
      const once = toSnakeId(name)
      expect(toSnakeId(once)).toBe(once)
    }
  })
})

describe('isValidId', () => {
  it('rejects shapes that would break as keys', () => {
    expect(isValidId('Rainbow_Trout')).toBe(false) // uppercase
    expect(isValidId('rainbow trout')).toBe(false) // space
    expect(isValidId('_rainbow')).toBe(false) // leading underscore
    expect(isValidId('rainbow_')).toBe(false) // trailing underscore
    expect(isValidId('rainbow__trout')).toBe(false) // doubled separator
    expect(isValidId('')).toBe(false)
  })
})
