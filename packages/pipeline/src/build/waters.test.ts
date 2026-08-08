import type { AvailabilityWindow } from '@mistria/schema'
import { describe, expect, it } from 'vitest'
import {
  type ExtractedWater,
  parseFloorRanges,
  parseMineFishing,
  parseWaterBlock,
  type WatersExtract,
} from '../enrich/waters.js'
import type { MineInputs } from './context.js'
import { buildWaterIndex, expandHabitats, splitByFishableFloors } from './waters.js'

/** The Fishing page's Pond block, as it is actually written. */
const POND_BLOCK = `<div id="Pond"><li>Ponds can be found in:</li><ul>
<li>[[Mistria]] (West of [[Manor House|The Manor]] at the North of town)</li>
<li>[[The Eastern Road]]</li>
<li>[[The Deep Woods]]</li></ul></div>`

const OCEAN_BLOCK = `<div id="Ocean"><li>The Ocean is reachable in:</li><ul>
<li>[[The Western Ruins]] (not divable)</li>
<li>[[Sweetwater Farm]] (not divable)</li>
<li>[[The Beach]]</li></ul></div>`

const MINE_BLOCK = `<li>Mines' Locations:</li><ul>
<li>{{BiomesQuick|1}} (floors 2 - 19)</li>
<li>{{BiomesQuick|2|no link}}</li>
<li>{{BiomesQuick|5}} (floors 81-89, 91-99)</li>
</ul>`

describe('parseWaterBlock', () => {
  it('reads the regions and not the header line', () => {
    const waters = parseWaterBlock(POND_BLOCK, 'pond')
    expect(waters.map((w) => w.location.target)).toEqual([
      'Mistria',
      'The Eastern Road',
      'The Deep Woods',
    ])
  })

  it('takes only the first link on a line', () => {
    // "[[Mistria]] (West of [[Manor House|The Manor]]…)" has two links, and the
    // second is a building. Reading every link files the Manor House as a pond.
    const waters = parseWaterBlock(POND_BLOCK, 'pond')
    expect(waters.map((w) => w.location.target)).not.toContain('Manor House')
  })

  it('marks the two ocean regions a player cannot dive in', () => {
    // The page spells it "divable". A pattern that only matched "diveable" let
    // every ocean fish claim a dive spot at the Western Ruins.
    const waters = parseWaterBlock(OCEAN_BLOCK, 'ocean')
    expect(waters.filter((w) => w.divable).map((w) => w.location.target)).toEqual(['The Beach'])
  })

  it('keeps both halves of a piped link, because either may be the canonical name', () => {
    const waters = parseWaterBlock("<li>[[Farm|The Player's Farm]]</li>", 'river')
    expect(waters[0]?.location).toEqual({ target: 'Farm', display: "The Player's Farm" })
  })
})

describe('parseFloorRanges', () => {
  it('reads one range', () => {
    expect(parseFloorRanges('(floors 2 - 19)')).toEqual([{ min: 2, max: 19 }])
  })

  it('reads two ranges, because floor 90 has no water', () => {
    expect(parseFloorRanges('(floors 81-89, 91-99)')).toEqual([
      { min: 81, max: 89 },
      { min: 91, max: 99 },
    ])
  })

  it('returns nothing when the line states no range', () => {
    expect(parseFloorRanges('{{BiomesQuick|2|no link}}')).toEqual([])
  })
})

describe('parseMineFishing', () => {
  it('reads the biome order and any narrowed floors', () => {
    expect(parseMineFishing(MINE_BLOCK)).toEqual([
      { biomeOrder: 1, floors: [{ min: 2, max: 19 }] },
      { biomeOrder: 2, floors: [] },
      {
        biomeOrder: 5,
        floors: [
          { min: 81, max: 89 },
          { min: 91, max: 99 },
        ],
      },
    ])
  })
})

const water = (habitat: string, target: string, divable = true): ExtractedWater => ({
  habitat,
  location: { target, display: '' },
  divable,
})

const EXTRACT: WatersExtract = {
  wikiVersionStamp: null,
  lastEdited: '2026-04-15T00:00:00Z',
  waters: [
    water('pond', 'Mistria'),
    water('pond', 'The Deep Woods'),
    water('ocean', 'The Western Ruins', false),
    water('ocean', 'The Beach'),
  ],
  mineFishing: [
    { biomeOrder: 1, floors: [{ min: 2, max: 19 }] },
    { biomeOrder: 2, floors: [] },
  ],
}

const MINES: MineInputs = {
  commonDropItemNames: [],
  biomes: [
    // Deliberately out of floor order: biome order is defined by the floors,
    // not by where a biome happens to sit in the curated array.
    {
      id: 'tide_caverns',
      name: 'The Tide Caverns',
      location_id: 'the_tide_caverns',
      floors: { min: 21, max: 39 },
      seal: { name: 'The Earth Seal', floor: 40, quest: null },
      unlock_quest: null,
      ore_item_names: [],
      artifact_set_ids: [],
      hazards: [],
      wiki_page: 'x',
    },
    {
      id: 'upper_mines',
      name: 'The Upper Mines',
      location_id: 'the_upper_mines',
      floors: { min: 1, max: 19 },
      seal: { name: 'The Water Seal', floor: 20, quest: null },
      unlock_quest: null,
      ore_item_names: [],
      artifact_set_ids: [],
      hazards: [],
      wiki_page: 'x',
    },
  ],
}

const resolve = (names: string[]): string | null => {
  const known: Record<string, string> = {
    Mistria: 'mistria',
    'The Deep Woods': 'the_deep_woods',
    'The Western Ruins': 'the_western_ruins',
    'The Beach': 'the_beach',
  }
  for (const name of names) if (known[name] !== undefined) return known[name]
  return null
}

describe('buildWaterIndex', () => {
  const index = buildWaterIndex(EXTRACT, MINES, resolve)

  it('separates the divable subset from the full list', () => {
    expect(index.byHabitat.get('ocean')).toEqual({
      all: ['the_western_ruins', 'the_beach'],
      divable: ['the_beach'],
    })
  })

  it('gives each location the habitats the page proves it has', () => {
    expect(index.habitatsByLocation.get('mistria')).toEqual(['pond'])
  })

  it('matches a biome by its floor order, not its array position', () => {
    expect(index.fishableFloors.get('upper_mines')).toEqual([{ min: 2, max: 19 }])
  })

  it("falls back to the biome's own floors when the page narrows nothing", () => {
    expect(index.fishableFloors.get('tide_caverns')).toEqual([{ min: 21, max: 39 }])
  })

  it('notices the page has not been touched since 1.0', () => {
    expect(index.stale).toBe(true)
  })
})

describe('expandHabitats', () => {
  const index = buildWaterIndex(EXTRACT, MINES, resolve)

  it('expands a habitat into the places that hold it', () => {
    expect(expandHabitats(index, ['pond'], [], 'fishing')).toEqual({
      locations: ['mistria', 'the_deep_woods'],
      inferred: true,
    })
  })

  it('expands a diving window only into water a player can dive in', () => {
    // The Western Ruins reach the ocean but cannot be dived. Sending someone
    // there to dive is a wrong answer, not an imprecise one.
    expect(expandHabitats(index, ['ocean'], [], 'diving')).toEqual({
      locations: ['the_beach'],
      inferred: true,
    })
  })

  it('leaves a named location alone', () => {
    expect(expandHabitats(index, ['pond'], ['the_narrows'], 'fishing')).toEqual({
      locations: ['the_narrows'],
      inferred: false,
    })
  })

  it('does not expand overworld, which names nowhere in particular', () => {
    expect(expandHabitats(index, ['overworld'], [], 'bug_net')).toEqual({
      locations: [],
      inferred: false,
    })
  })
})

const WINDOW: AvailabilityWindow = {
  method: 'fishing',
  habitats: [],
  locations: ['the_upper_mines'],
  spot_ids: [],
  seasons: ['spring'],
  weather: null,
  weather_precision: 'not_applicable',
  time: null,
  time_blocks: null,
  time_precision: 'not_applicable',
  days: null,
  dates: null,
  depth: null,
  biome_id: 'upper_mines',
  min_year: null,
  rarity: null,
  chance: null,
  quantity: null,
  requires: [],
  confidence: 'wiki',
  prov: 'wiki_cargo',
}

describe('splitByFishableFloors', () => {
  const index = buildWaterIndex(EXTRACT, MINES, resolve)

  it('narrows a mine window to the floors that hold water', () => {
    expect(splitByFishableFloors(index, WINDOW).map((w) => w.depth)).toEqual([{ min: 2, max: 19 }])
  })

  it("leaves the item's own floor range alone", () => {
    // A range stated on the item is a fact about that item and outranks the
    // page's general answer for the biome.
    const stated = { ...WINDOW, depth: { min: 5, max: 5 } }
    expect(splitByFishableFloors(index, stated)).toEqual([stated])
  })

  it('does not touch a window that is not in a biome', () => {
    const surface = { ...WINDOW, biome_id: null, locations: ['the_beach'] }
    expect(splitByFishableFloors(index, surface)).toEqual([surface])
  })
})
