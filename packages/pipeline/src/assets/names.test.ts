import { describe, expect, it } from 'vitest'
import { canonicalWikiName, extensionOf, filePageUrl, fileRef, localName } from './names.js'

describe('canonicalWikiName', () => {
  it('treats underscores and spaces as the same character', () => {
    expect(canonicalWikiName('Alda_clay_pot.png')).toBe('Alda clay pot.png')
    expect(canonicalWikiName('Alda clay pot.png')).toBe('Alda clay pot.png')
  })

  it('uppercases the first letter, because MediaWiki does', () => {
    // Both spellings are in the real Items.icon column. Left alone they are two
    // downloads of one file, and two entries claiming the same local name.
    expect(canonicalWikiName('acorn.png')).toBe('Acorn.png')
    expect(canonicalWikiName('Acorn.png')).toBe('Acorn.png')
  })

  it('leaves the rest of the name case-sensitive', () => {
    // "Sapling hat.png" and "Sapling Hat.png" really are two different files.
    expect(canonicalWikiName('Sapling hat.png')).not.toBe(canonicalWikiName('Sapling Hat.png'))
  })

  it('collapses runs of whitespace and trims', () => {
    expect(canonicalWikiName('  worn   hoe.png ')).toBe('Worn hoe.png')
  })

  it('returns empty for an empty name rather than throwing', () => {
    expect(canonicalWikiName('   ')).toBe('')
  })
})

describe('localName', () => {
  it('kebab-cases the stem and keeps the extension', () => {
    expect(localName('Copper Ore.png')).toBe('copper-ore.png')
    expect(localName('Alda clay pot.png')).toBe('alda-clay-pot.png')
  })

  it('strips accents rather than mangling them', () => {
    expect(localName('Céline icon.png')).toBe('celine-icon.png')
  })

  it('drops apostrophes and spells out an ampersand', () => {
    expect(localName("Hayden's shop icon.png")).toBe('haydens-shop-icon.png')
    expect(localName('Bread & Butter.png')).toBe('bread-and-butter.png')
  })

  it('lowercases the extension', () => {
    expect(localName('Thing.PNG')).toBe('thing.png')
  })

  it('never produces a name that is only an extension', () => {
    expect(localName('---.png')).toBe('unnamed.png')
  })
})

describe('fileRef', () => {
  it('reads the file out of an Items.icon fragment', () => {
    expect(fileRef('[[File:Abyssal chest.png]]')).toBe('Abyssal chest.png')
  })

  it('canonicalises what it finds', () => {
    expect(fileRef('[[File:acorn.png]]')).toBe('Acorn.png')
  })

  it('stops at the first pipe, which starts display options', () => {
    expect(fileRef('[[File:Fishing_icon.png|20px|link=Fishing]]')).toBe('Fishing icon.png')
  })

  it('is null when there is no file, not an empty string', () => {
    expect(fileRef('')).toBeNull()
    expect(fileRef('just some text')).toBeNull()
  })
})

describe('filePageUrl', () => {
  it('points at the description page, not the bytes', () => {
    // The direct /images/ URL carries a cache-busting hash that changes with the
    // file, so recording it would churn the manifest on every re-upload.
    expect(filePageUrl('https://fieldsofmistria.wiki.gg', 'Copper Ore.png')).toBe(
      'https://fieldsofmistria.wiki.gg/wiki/File:Copper%20Ore.png',
    )
  })
})

describe('extensionOf', () => {
  it('includes the dot and lowercases', () => {
    expect(extensionOf('A.PNG')).toBe('.png')
  })

  it('is empty when there is no extension', () => {
    expect(extensionOf('Calendar icon')).toBe('')
  })
})
