import { describe, expect, it } from 'vitest'
import { buildInventory, type Want } from './inventory.js'
import { linkedIcons } from './link-icons.js'
import { decodeEntities, fileRef } from './names.js'

const want = (iconKey: string, sourceFile: string, family: Want['family'] = 'item'): Want => ({
  family,
  iconKey,
  sourceFile,
})

describe('buildInventory', () => {
  it('collapses two records that share a sprite into one download', () => {
    const entries = buildInventory([
      want('item/milk', 'Milk.png'),
      want('item/cow_milk', 'Milk.png'),
    ])

    expect(entries).toHaveLength(1)
    expect(entries[0]?.iconKeys).toEqual(['item/cow_milk', 'item/milk'])
  })

  it('throws when two different wiki files want the same local name', () => {
    // Silent overwriting is the one failure here that would be invisible in a
    // diff and wrong in the app: one sprite, two records, no error anywhere.
    expect(() =>
      buildInventory([want('item/a', 'Copper Ore.png'), want('item/b', 'Copper-Ore.png')]),
    ).toThrow(/two wiki files map to/)
  })

  it('canonicalises names, so no collector can forget to', () => {
    // `Celine_Portrait.png` and `march icon.png` both reached the fetcher raw.
    // MediaWiki normalises them on the way back, so the resolved URL came home
    // under a key nothing was looking for and eighteen portraits vanished
    // without an error. Canonicalising here is what makes that unrepeatable.
    const entries = buildInventory([
      want('character/celine', 'Celine_Portrait.png', 'portrait'),
      want('character/march', 'march icon.png', 'villager'),
    ])
    expect(entries.map((e) => e.sourceFile)).toEqual(['Celine Portrait.png', 'March icon.png'])
  })

  it('merges wants that differ only in spelling', () => {
    const entries = buildInventory([want('item/a', 'acorn.png'), want('item/b', 'Acorn.png')])
    expect(entries).toHaveLength(1)
    expect(entries[0]?.iconKeys).toEqual(['item/a', 'item/b'])
  })

  it('sorts by key so the manifest is a stable diff', () => {
    const entries = buildInventory([want('item/z', 'Zucchini.png'), want('item/a', 'Acorn.png')])
    expect(entries.map((e) => e.key)).toEqual(['item/acorn', 'item/zucchini'])
  })

  it('files each family in its own directory', () => {
    const entries = buildInventory([want('character/adeline', 'Adeline icon.png', 'villager')])
    expect(entries[0]?.file).toBe('villager/adeline-icon.png')
    expect(entries[0]?.key).toBe('villager/adeline-icon')
  })
})

describe('decodeEntities', () => {
  it('undoes what Cargo does to the markup', () => {
    // Without this the regex finds nothing at all — silently, which is the worst
    // kind of nothing.
    expect(decodeEntities('&lt;span&gt;')).toBe('<span>')
    expect(decodeEntities('Balor&#039;s Wagon')).toBe("Balor's Wagon")
  })
})

describe('fileRef', () => {
  it('decodes entities before reading the name', () => {
    // `Items.icon` really does contain `[[File:Dragon&#039;s horn.png]]`, and
    // asking the wiki for a file with a literal `&#039;` in it gets nothing.
    expect(fileRef('[[File:Dragon&#039;s horn.png]]')).toBe("Dragon's horn.png")
  })
})

describe('linkedIcons', () => {
  it('reads the association a human wrote', () => {
    const found = linkedIcons(['[[File:Fishing_icon.png|20px|link=Fishing]] [[Fishing]]'])
    expect(found.get('fishing')).toBe('Fishing icon.png')
  })

  it('normalises the target the same way record ids were normalised', () => {
    const found = linkedIcons(['[[File:General store icon.png|20px|link=General_Store]]'])
    expect(found.get('general_store')).toBe('General store icon.png')
  })

  it('ignores the section part of a link', () => {
    const found = linkedIcons(['[[File:Inn_icon.png|20px|link=Inn#Menu]]'])
    expect(found.get('inn')).toBe('Inn icon.png')
  })

  it('treats spelling variants of one file as one file', () => {
    const found = linkedIcons([
      '[[File:Fishing_icon.png|20px|link=Fishing]]',
      '[[File:Fishing icon.png|20px|link=Fishing]]',
    ])
    expect(found.get('fishing')).toBe('Fishing icon.png')
  })

  it('drops a target that names two different files rather than picking one', () => {
    // Farming is linked from both an almanac glyph and a watering can. Choosing
    // between them would be a coin toss dressed as data; the record keeps its
    // drawn glyph, which is a correct answer.
    const found = linkedIcons([
      '[[File:Almanac icon crops.png|20px|link=Farming]]',
      '[[File:Iron_Watering_Can.png|20px|link=Farming]]',
    ])
    expect(found.has('farming')).toBe(false)
  })

  it('ignores a file with no link target', () => {
    expect(linkedIcons(['[[File:Tesserae Icon.png|18px|link=]]']).size).toBe(0)
  })
})
