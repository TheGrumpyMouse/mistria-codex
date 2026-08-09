import { describe, expect, it } from 'vitest'
import { floorRange, placeLabel, placeLabels } from './labels'

const LOCATIONS = [
  { id: 'the_mines', name: 'The Mines' },
  { id: 'the_upper_mines', name: 'The Upper Mines' },
  { id: 'the_tide_caverns', name: 'The Tide Caverns' },
  { id: 'the_narrows', name: 'The Narrows' },
]

const MINES = [
  { location_id: 'the_upper_mines', floors: { min: 1, max: 19 } },
  { location_id: 'the_tide_caverns', floors: { min: 21, max: 39 } },
  // A biome that names no place — there is nothing for it to label.
  { location_id: null, floors: { min: 41, max: 59 } },
]

describe('placeLabels', () => {
  it('gives a mine biome its floor range and everywhere else none', () => {
    const places = placeLabels(LOCATIONS, MINES)
    expect(places.get('the_tide_caverns')).toEqual({
      name: 'The Tide Caverns',
      floors: { min: 21, max: 39 },
    })
    // Not applicable rather than unknown: the surface has no depth to state.
    expect(places.get('the_narrows')?.floors).toBeNull()
  })

  it('leaves the parent mine unranged', () => {
    // Deriving 1–99 from the children would be an inference dressed as a
    // reading, and a wrong one — the shipped ranges skip floors 20, 40 and 60.
    expect(placeLabels(LOCATIONS, MINES).get('the_mines')?.floors).toBeNull()
  })

  it('skips a biome that names no location', () => {
    const places = placeLabels(LOCATIONS, MINES)
    expect([...places.values()].filter((p) => p.floors !== null)).toHaveLength(2)
  })

  it('works with no mines loaded, so a screen that omits them still renders', () => {
    expect(placeLabels(LOCATIONS).get('the_tide_caverns')?.floors).toBeNull()
  })
})

describe('placeLabel', () => {
  it('falls back to a readable id rather than printing snake_case', () => {
    expect(placeLabel(new Map(), 'the_tide_caverns')).toEqual({
      name: 'the tide caverns',
      floors: null,
    })
  })
})

describe('floorRange', () => {
  it('is lowercase with an en-dash, matching the Mines screen', () => {
    expect(floorRange({ min: 21, max: 39 })).toBe('floors 21–39')
  })
})
