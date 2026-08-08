import { describe, expect, it } from 'vitest'
import type { ExtractedMarker } from '../../enrich/maps.js'
import { markerPoint, parseDataMap, splitArticle } from '../../enrich/maps.js'
import { regionContaining, resolveAnchors, resolveSpots } from './maps.js'

const marker = (over: Partial<ExtractedMarker>): ExtractedMarker => ({
  group: 'Regions',
  name: 'X',
  article: null,
  section: null,
  x: 0,
  y: 0,
  ...over,
})

const LOCATIONS = [
  { id: 'mistria', wiki_page: 'Mistria' },
  { id: 'the_beach', wiki_page: 'The_Beach' },
  { id: 'the_narrows', wiki_page: 'The_Narrows' },
  { id: 'the_farm', wiki_page: 'The_Farm' },
]

describe('markerPoint', () => {
  it('reads lat as y and lon as x', () => {
    // DataMaps borrows the names from a mapping library and does not mean them
    // literally: crs is [height, width], so lat counts down and lon counts
    // right. Reading the pair the other way puts every pin somewhere else, and
    // nothing in the JSON would say so.
    expect(markerPoint({ lat: 1851, lon: 3429 })).toEqual({ x: 3429, y: 1851 })
  })
})

describe('splitArticle', () => {
  it('splits a page from its section and undoes underscores', () => {
    expect(splitArticle("The_Narrows#Errol's_Cabin")).toEqual({
      article: 'The Narrows',
      section: "Errol's Cabin",
    })
  })

  it('is null for a marker that links nowhere', () => {
    expect(splitArticle(undefined)).toEqual({ article: null, section: null })
    expect(splitArticle('')).toEqual({ article: null, section: null })
  })
})

describe('parseDataMap', () => {
  it('reports the space as width by height', () => {
    const { size } = parseDataMap({
      crs: { topLeft: [0, 0], bottomRight: [3599, 5442] },
      markers: { Regions: [{ lat: 10, lon: 20, name: 'a' }] },
    })
    expect(size).toEqual([5442, 3599])
  })

  it('refuses a map with no declared space', () => {
    // Every pin drawn from it would be a guess at an unknown scale.
    expect(() => parseDataMap({ markers: {} })).toThrow(/no coordinate space/)
  })

  it('throws when a marker falls outside its own space', () => {
    expect(() =>
      parseDataMap({
        crs: { topLeft: [0, 0], bottomRight: [100, 100] },
        markers: { Regions: [{ lat: 10, lon: 500, name: 'off the edge' }] },
      }),
    ).toThrow(/outside the declared/)
  })
})

describe('resolveAnchors', () => {
  it('anchors a location from a marker that links at its page', () => {
    const { anchors } = resolveAnchors(
      [marker({ name: 'Town', article: 'Mistria', x: 3429, y: 1851 })],
      LOCATIONS,
      [],
    )
    expect(anchors.get('mistria')).toEqual({ x: 3429, y: 1851 })
  })

  it('never anchors a page from a marker that links *into* it', () => {
    // The lighthouse is on the beach; it is not the beach. Without this the
    // Beach would be pinned at its lighthouse and the Narrows at Errol's cabin.
    const { anchors } = resolveAnchors(
      [marker({ name: 'The Lighthouse', article: 'The Beach', section: 'The Lighthouse' })],
      LOCATIONS,
      [],
    )
    expect(anchors.has('the_beach')).toBe(false)
  })

  it('anchors from a group other than Regions or Buildings', () => {
    // The Wishing Well is filed under Statues and is still a location we hold.
    // Keying off the group rather than the article lost it.
    const locations = [...LOCATIONS, { id: 'the_wishing_well', wiki_page: 'Wishing_Well' }]
    const { anchors } = resolveAnchors(
      [marker({ group: 'Statues', name: 'The Wishing Well', article: 'Wishing Well', x: 5, y: 6 })],
      locations,
      [],
    )
    expect(anchors.get('the_wishing_well')).toEqual({ x: 5, y: 6 })
  })

  it('uses a curated alias when the two spellings differ', () => {
    const { anchors } = resolveAnchors(
      [marker({ name: "The Player's Farm", article: 'Farm', x: 3457, y: 2412 })],
      LOCATIONS,
      [{ marker: "The Player's Farm", location_id: 'the_farm', reason: 'different spelling' }],
    )
    expect(anchors.get('the_farm')).toEqual({ x: 3457, y: 2412 })
  })

  it('refuses an alias that points at no location', () => {
    expect(() =>
      resolveAnchors([], LOCATIONS, [{ marker: 'X', location_id: 'nowhere', reason: '' }]),
    ).toThrow(/not a location/)
  })

  it('reports a marker that matches nothing rather than placing it', () => {
    const { anchors, unmatched } = resolveAnchors(
      [marker({ name: 'Seridia’s House', article: "Seridia's House" })],
      LOCATIONS,
      [],
    )
    expect(anchors.size).toBe(0)
    expect(unmatched.map((m) => m.name)).toEqual(['Seridia’s House'])
  })
})

describe('regionContaining', () => {
  const footprint = (id: string, runs: [number, number, number][]) => ({
    id,
    shape: { cell: 10, runs },
  })

  it('finds the region whose cells the point lands on', () => {
    const regions = [footprint('a', [[5, 2, 3]])]
    // Row 5, columns 2..4 -> x 20..49, y 50..59.
    expect(regionContaining(25, 55, regions)).toBe('a')
    expect(regionContaining(49, 59, regions)).toBe('a')
  })

  it('is null just outside the footprint', () => {
    const regions = [footprint('a', [[5, 2, 3]])]
    expect(regionContaining(50, 55, regions)).toBeNull()
    expect(regionContaining(25, 45, regions)).toBeNull()
  })

  it('is containment, not proximity', () => {
    // The point sits far from `a`'s cells and nowhere near anything else. A
    // nearest-region rule would hand it to `a`; containment correctly refuses,
    // which is the whole reason this is allowed to place landmarks at all.
    const regions = [footprint('a', [[0, 0, 1]])]
    expect(regionContaining(900, 900, regions)).toBeNull()
  })

  it('reproduces a placement the wiki states independently', () => {
    // Cross-checked live against each landmark's own `|location=` infobox
    // field: Chicken Statue -> Sweetwater Farm, Fish Trap -> The Beach, Horse
    // Statue -> The Narrows, Caldarus' House -> The Deep Woods. Four of four
    // agreed, which is what justified placing landmarks by geometry at all.
    //
    // The Chicken Statue's published marker is (1837, 2652); at the real 42px
    // grid that is row 63, column 43 — inside Sweetwater Farm's footprint.
    const sweetwater = {
      id: 'sweetwater_farm',
      shape: { cell: 42, runs: [[63, 37, 12]] as [number, number, number][] },
    }
    expect(regionContaining(1837, 2652, [sweetwater])).toBe('sweetwater_farm')
  })
})

describe('resolveSpots', () => {
  const toId = (name: string) =>
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '')

  it('places a landmark in the region whose page it links into', () => {
    const { spots } = resolveSpots(
      [
        marker({
          group: 'Statues',
          name: 'The Lighthouse',
          article: 'The Beach',
          section: 'The Lighthouse',
          x: 2338,
          y: 3159,
        }),
      ],
      LOCATIONS,
      toId,
    )
    expect(spots).toEqual([
      {
        id: 'the_lighthouse',
        location_id: 'the_beach',
        x: 2338,
        y: 3159,
        kind: 'entrance',
        seasons: [],
        map_version: 1,
      },
    ])
  })

  it('calls a fountain water and everything else an entrance', () => {
    const { spots } = resolveSpots(
      [
        marker({
          group: 'Fountains',
          name: 'F',
          article: 'The Narrows',
          section: 'Rejuvenating Fountain',
        }),
      ],
      LOCATIONS,
      toId,
    )
    expect(spots[0]?.kind).toBe('water')
  })

  it('leaves a landmark unplaced rather than guessing its region', () => {
    // The Chicken Statue links to its own page and the quest markers link
    // nowhere. Attaching them to the nearest region marker would be an
    // inference rendered as a coordinate, which is indistinguishable from a
    // survey once it is in the data.
    const { spots, unplaced } = resolveSpots(
      [
        marker({ group: 'Statues', name: 'The Chicken Statue', article: 'Chicken Statue' }),
        marker({ group: 'Quest', name: 'Broken Bridge' }),
      ],
      LOCATIONS,
      toId,
    )
    expect(spots).toHaveLength(0)
    expect(unplaced.map((m) => m.name)).toEqual(['The Chicken Statue', 'Broken Bridge'])
  })

  it('does not also make a spot of a marker already used as an anchor', () => {
    const { spots } = resolveSpots(
      [
        marker({
          group: 'Statues',
          name: "The Manor's Gazebo",
          article: 'Manor House',
          section: 'The Gardens',
        }),
      ],
      [...LOCATIONS, { id: 'the_manor_house', wiki_page: 'Manor_House' }],
      toId,
      new Set(["The Manor's Gazebo"]),
    )
    expect(spots).toHaveLength(0)
  })
})
