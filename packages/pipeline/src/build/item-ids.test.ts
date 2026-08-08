import { toSnakeId } from '@mistria/schema'
import { describe, expect, it } from 'vitest'
import { type ItemNamesExtract, parseNameTable } from '../enrich/item-names.js'
import { buildItemIdIndex, divergences } from './item-ids.js'

const VOCAB = {
  url: '',
  gameVersion: '0.15.0',
  attribution: '',
  excludeMarkers: ['DISABLED', 'GLITCHED', 'PLACEHOLDER'],
  missingDisplayName: 'MISSING',
}

/** The mod's README table, as it is actually written. */
const TABLE = [
  '| Item ID  | Internal Item Name | Displayed Item Name | Notes |',
  '| -------- | ------------------ | ------------------- | ----- |',
  '| 1 | acorn | Acorn |',
  '| 29 | animal_cosmetic | MISSING | **DISABLED** |',
  '| 30 | animal_currency | Shiny Bead |',
  '| 173 | balors_crate | Balors Crate | **GLITCHED** |',
  '| 1636 | ore_copper | Copper Ore |',
  '| 1637 | ore_copper_alt | Copper Ore |',
].join('\n')

describe('parseNameTable', () => {
  const names = parseNameTable(TABLE, VOCAB)

  it('skips the header and the divider', () => {
    expect(names.map((n) => n.internalName)).toEqual([
      'acorn',
      'animal_cosmetic',
      'animal_currency',
      'balors_crate',
      'ore_copper',
      'ore_copper_alt',
    ])
  })

  it('reads MISSING as no display name at all', () => {
    expect(names.find((n) => n.internalName === 'animal_cosmetic')?.displayName).toBe(null)
  })

  it('keeps the markers that say a row is not a usable item', () => {
    expect(names.find((n) => n.internalName === 'balors_crate')?.markers).toEqual(['GLITCHED'])
  })

  it('reads a row with no notes column', () => {
    expect(names.find((n) => n.internalName === 'acorn')).toEqual({
      numericId: 1,
      internalName: 'acorn',
      displayName: 'Acorn',
      markers: [],
    })
  })
})

const EXTRACT: ItemNamesExtract = {
  gameVersion: '0.15.0',
  attribution: '',
  url: '',
  names: parseNameTable(TABLE, VOCAB),
}

describe('buildItemIdIndex', () => {
  const index = buildItemIdIndex(EXTRACT)

  it('maps a display name to the game internal name', () => {
    expect(index.internalByDisplay.get('Shiny Bead')).toBe('animal_currency')
  })

  it('refuses a display name the snapshot uses twice', () => {
    // Display name is the only column the wiki and the snapshot share, so a
    // duplicate cannot be resolved — picking one would be a coin flip that
    // renames an item. It keeps its slug and the conflict is reported.
    expect(index.internalByDisplay.has('Copper Ore')).toBe(false)
    expect(index.ambiguous).toEqual(['Copper Ore'])
  })

  it('ignores rows the mod marks unusable', () => {
    // A DISABLED item crashes the game when created, and a GLITCHED one is half
    // implemented. Naming one of our items after either would be adopting the
    // identity of something a player can never hold.
    expect(index.internalByDisplay.has('Balors Crate')).toBe(false)
    expect([...index.internalByDisplay.values()]).not.toContain('animal_cosmetic')
  })
})

describe('divergences', () => {
  it('reports only the names the slug got wrong', () => {
    const index = buildItemIdIndex({
      ...EXTRACT,
      names: EXTRACT.names.filter((n) => n.internalName !== 'ore_copper_alt'),
    })

    expect(divergences(index, ['Acorn', 'Shiny Bead', 'Copper Ore'], toSnakeId)).toEqual([
      { displayName: 'Copper Ore', slug: 'copper_ore', internalName: 'ore_copper' },
      { displayName: 'Shiny Bead', slug: 'shiny_bead', internalName: 'animal_currency' },
    ])
  })
})
