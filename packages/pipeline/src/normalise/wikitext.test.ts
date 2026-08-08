import { describe, expect, it } from 'vitest'
import {
  decodeEntities,
  hasUnparsedTemplate,
  stripWikitext,
  toBoolean,
  toInteger,
  toTokens,
} from './wikitext.js'

/**
 * Every input below is a verbatim value from `sources/wiki/cargo/*.json`, not an
 * invented example. Wikitext is exactly the kind of thing where a parser passes
 * its hand-written tests and then meets the real corpus.
 */

const APPLE_SEASON =
  '&lt;span style=&quot;display:inline; margin-right:0;&quot;&gt;[[File:Season icon autumn.png|24px|link=]]&amp;nbsp;[[Fall]]&lt;/span&gt;'

const APPLE_LOCATION = '[[The_Eastern_Road#Apple_Tree|The Eastern Road]]'

const ANCHOVY_SOURCE_SHOP =
  '[[File:Tackleshop icon.png|20px|link=Tackle_Shop#Fish]] [[Tackle_Shop#Fish|Tackle Shop]] for &lt;span class=&quot;no-wrap&quot;&gt;[[File:Tesserae Icon.png|18px|link=]]70t&lt;/span&gt;'

const ANCHOVY_SOURCE_FISHING =
  '&lt;span style=&quot;display:none; margin-right:0; white-space: wrap;&quot;&gt;&lt;/span&gt;[[File:Fishing_icon.png|20px|link=Fishing]] [[Fishing]]'

const FISH_WEATHER_ANY =
  '&lt;span style=&quot;display:inline; margin-right:0; white-space: nowrap;&quot;&gt;[[Weather|Any]]&lt;/span&gt;'

const BALOR_SOURCE =
  '[[File:Fp_wiki_balor.png|20px|link=Balor&#039;s Wagon#Crops/Forageables Cooking Ingredients]] [[Balor&#039;s Wagon#Crops/Forageables Cooking Ingredients|Balor&#039;s Wagon]] &lt;small&gt;(conditional)&lt;/small&gt; for &lt;span class=&quot;no-wrap&quot;&gt;[[File:Tesserae Icon.png|18px|link=]]180t&lt;/span&gt;'

describe('decodeEntities', () => {
  it('decodes the entities Cargo escapes', () => {
    expect(decodeEntities('&lt;span&gt;')).toBe('<span>')
    expect(decodeEntities('&quot;x&quot;')).toBe('"x"')
    expect(decodeEntities('Balor&#039;s')).toBe("Balor's")
  })

  it('is a single pass — Cargo escapes once, so one decode is one level', () => {
    // Cargo escapes the whole cell once, so wikitext that contained a literal
    // `&nbsp;` arrives as `&amp;nbsp;` and comes out of one pass as `&nbsp;`.
    // Resolving that residual entity is stripWikitext's job, not this one's.
    expect(decodeEntities('&amp;nbsp;')).toBe('&nbsp;')
    expect(decodeEntities('&nbsp;')).toBe(' ')
  })
})

describe('stripWikitext', () => {
  it('pulls a season out of its span and icon', () => {
    expect(stripWikitext(APPLE_SEASON)).toBe('Fall')
  })

  it('prefers the display text of a piped link', () => {
    expect(stripWikitext(APPLE_LOCATION)).toBe('The Eastern Road')
  })

  it('restores underscores in an unpiped link', () => {
    expect(stripWikitext('[[The_Eastern_Road]]')).toBe('The Eastern Road')
  })

  it('drops the anchor from an unpiped link', () => {
    expect(stripWikitext('[[Fishing#Dive-Based_Fishing]]')).toBe('Fishing')
  })

  it('keeps shop prices readable', () => {
    expect(stripWikitext(ANCHOVY_SOURCE_SHOP)).toBe('Tackle Shop for 70t')
    expect(stripWikitext(BALOR_SOURCE)).toBe("Balor's Wagon (conditional) for 180t")
  })

  it('handles an empty leading span', () => {
    expect(stripWikitext(ANCHOVY_SOURCE_FISHING)).toBe('Fishing')
  })

  it('reduces a weather cell to its word', () => {
    expect(stripWikitext(FISH_WEATHER_ANY)).toBe('Any')
  })

  it('drops file links entirely', () => {
    expect(stripWikitext('[[File:Apple.png]]')).toBe('')
  })

  it('passes an already-plain value through untouched', () => {
    expect(stripWikitext('Ocean')).toBe('Ocean')
    expect(stripWikitext('')).toBe('')
  })
})

describe('hasUnparsedTemplate', () => {
  it('flags a surviving template rather than letting it vanish', () => {
    expect(hasUnparsedTemplate('{{Tesserae|180}}')).toBe(true)
    expect(hasUnparsedTemplate('Tackle Shop for 70t')).toBe(false)
  })
})

describe('toTokens', () => {
  it('handles the array shape Cargo actually returns for list fields', () => {
    expect(toTokens([APPLE_LOCATION])).toEqual(['The Eastern Road'])
    expect(toTokens(['Ocean'])).toEqual(['Ocean'])
  })

  it('drops empty and placeholder entries', () => {
    // Cabbage's location really is [""] — it is a farmed crop with no site.
    expect(toTokens([''])).toEqual([])
    expect(toTokens(['N/A', '-', 'Unknown'])).toEqual([])
  })

  it('keeps multi-word tokens intact', () => {
    // A space-splitting tokeniser would produce ['The','Eastern','Road'], none
    // of which resolve to a location.
    expect(toTokens(['[[The_Eastern_Road|The Eastern Road]]'])).toEqual(['The Eastern Road'])
  })

  it('treats null and undefined as no tokens', () => {
    expect(toTokens(null)).toEqual([])
    expect(toTokens(undefined)).toEqual([])
  })
})

describe('toBoolean', () => {
  it('maps Cargo 1/0 to true/false', () => {
    expect(toBoolean(1)).toBe(true)
    expect(toBoolean(0)).toBe(false)
  })

  it('keeps null as null, because null means unknown and not false', () => {
    // Amberjack has `fishing: null`. Reading that as "cannot be caught by
    // fishing" would be inventing a fact.
    expect(toBoolean(null)).toBeNull()
    expect(toBoolean(undefined)).toBeNull()
    expect(toBoolean('')).toBeNull()
  })
})

describe('toInteger', () => {
  it('reads numbers and numeric strings', () => {
    expect(toInteger(45)).toBe(45)
    expect(toInteger('180')).toBe(180)
  })

  it('returns null rather than 0 for absent values', () => {
    // Rendering a null sell value as 0 would tell someone an item is worthless.
    expect(toInteger(null)).toBeNull()
    expect(toInteger('')).toBeNull()
    expect(toInteger('n/a')).toBeNull()
  })
})
