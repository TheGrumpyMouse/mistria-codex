import { describe, expect, it } from 'vitest'
import { monsterName, parseDrops, parseFamilyTable } from '../../enrich/monsters.js'
import { expandSwitch, switchCases } from '../../lib/wiki.js'
import { monstersByBiome } from './monsters.js'

/** Template:MonsterDrops in miniature, including the inner switch. */
const TEMPLATE = [
  '<includeonly>{{#if:{{{2|}}}|x|y}}<ul>{{#switch:{{lc:{{{1|}}}}}',
  '|sapling|green sapling|cool sapling=<li>{{ItemIconAuto|Sap}} (70%)</li>',
  '<li>{{ItemIconAuto|Pet Skin: Sapling}} (5%) <small>(Requires {{SkillPerk|Friend-Shaped}})</small></li>',
  '{{#switch:{{lc:{{{1|}}}}}',
  '|cool sapling=<li>{{ItemIcon|Accessories#Glasses|Sunglasses|Sunglasses.png}} (5%)</li>',
  '}}<li>{{ItemIcon|Accessories#Hats|Sapling Hat|Sapling hat.png}} (5%)</li>',
  '|rock clod=<li>{{ItemIconAuto|Stone}} (70%)</li>',
  '}}</ul></includeonly>',
].join('\n')

describe('switchCases', () => {
  it('reads a branch with several keys', () => {
    const cases = switchCases('|a|b|c=first|d=second')
    expect(cases.map((c) => c.keys)).toEqual([['a', 'b', 'c'], ['d']])
    expect(cases.map((c) => c.body)).toEqual(['first', 'second'])
  })

  it('ignores pipes and equals inside a nested call', () => {
    const cases = switchCases('|a={{Icon|x|size=18}}|b=plain')
    expect(cases.map((c) => c.keys)).toEqual([['a'], ['b']])
    expect(cases[0]?.body).toBe('{{Icon|x|size=18}}')
  })
})

describe('expandSwitch', () => {
  it('resolves the outer branch', () => {
    expect(expandSwitch(TEMPLATE, 'rock clod')).toContain('Stone')
    expect(expandSwitch(TEMPLATE, 'rock clod')).not.toContain('Sap}}')
  })

  it('resolves the inner branch for the variant it belongs to, and only that one', () => {
    // The inner switch is what gives the Cool Sapling its sunglasses. Reading
    // the outer branch alone loses them; ignoring the inner switch gives every
    // sapling a pair.
    expect(expandSwitch(TEMPLATE, 'cool sapling')).toContain('Sunglasses')
    expect(expandSwitch(TEMPLATE, 'green sapling')).not.toContain('Sunglasses')
  })

  it('counts braces one at a time, because {{{1|}}} is not a matched pair', () => {
    // `{{#switch:{{lc:{{{1|}}}}}` has two pipes before the first branch. A
    // pair-counting scanner treated the one inside `{{{1|}}}` as a branch
    // separator and every drop table came out empty.
    expect(expandSwitch(TEMPLATE, 'sapling')).toContain('Sap')
  })
})

describe('parseDrops', () => {
  const drops = parseDrops(expandSwitch(TEMPLATE, 'cool sapling'), 'Friend-Shaped')

  it('reads the rate as a fraction', () => {
    expect(drops.find((d) => d.item === 'Sap')).toEqual({
      item: 'Sap',
      chance: 0.7,
      requiresPerk: null,
      kind: 'item',
    })
  })

  it('marks the drop that only happens once a perk is unlocked', () => {
    expect(drops.find((d) => d.item === 'Pet Skin: Sapling')?.requiresPerk).toBe('Friend-Shaped')
  })

  it('tells an Accessories link apart from an Items row', () => {
    expect(drops.find((d) => d.item === 'Sunglasses')?.kind).toBe('accessory')
    expect(drops.find((d) => d.item === 'Sap')?.kind).toBe('item')
  })
})

describe('monsterName', () => {
  it('puts the family back on a bare variant', () => {
    expect(monsterName('Blue', 'Clod')).toBe('Blue Clod')
    expect(monsterName('Purple', 'Essence Bat')).toBe('Purple Essence Bat')
  })

  it('leaves a variant that already names its family', () => {
    expect(monsterName('Cool Sapling', 'Sapling')).toBe('Cool Sapling')
    expect(monsterName('Mimic', 'Mimic')).toBe('Mimic')
  })

  it('drops the page disambiguator, which is not part of the name', () => {
    expect(monsterName('Red', 'Mushroom (Monster)')).toBe('Red Mushroom')
  })
})

describe('parseFamilyTable', () => {
  const TABLE = [
    '{|',
    '|-',
    '|[[File:x.png|50px]]||Rock||{{BiomesQuick|1 Monster|<br>}}||{{MonsterDrops|Rock Clod}}',
    '|-',
    '|[[File:y.png|50px]]||Mimic||{{BiomesQuick|All Monster|<br>}}||{{MonsterDrops|Mimic}}',
    '|}',
  ].join('\n')

  it('reads the variant, the biome, the drops key and the sprite filename', () => {
    expect(parseFamilyTable(TABLE, 'Clod')).toEqual([
      {
        family: 'Clod',
        variant: 'Rock',
        name: 'Rock Clod',
        dropsKey: 'Rock Clod',
        biomeOrders: [1],
        icon: 'X.png',
      },
      {
        family: 'Clod',
        variant: 'Mimic',
        name: 'Mimic Clod',
        dropsKey: 'Mimic',
        biomeOrders: [],
        icon: 'Y.png',
      },
    ])
  })

  it('takes only the filename from the first cell, not the image', () => {
    // The row's first cell is the sprite. Only its name is read; the art is
    // fetched separately into assets/game/ under attribution.
    const [first] = parseFamilyTable(TABLE, 'Clod')
    expect(first?.icon).toBe('X.png')
  })
})

describe('monstersByBiome', () => {
  it('indexes each biome from the monsters rather than a second authored list', () => {
    const monsters = [
      { id: 'blue_clod', biome_ids: ['tide_caverns'] },
      { id: 'mimic', biome_ids: ['upper_mines', 'tide_caverns'] },
    ] as Parameters<typeof monstersByBiome>[0]

    expect(monstersByBiome(monsters).get('tide_caverns')).toEqual(['blue_clod', 'mimic'])
  })
})
