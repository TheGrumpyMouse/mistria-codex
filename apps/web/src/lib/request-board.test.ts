import { describe, expect, it } from 'vitest'
import type { BoardRequest } from './request-board'
import { itemsWanted } from './request-board'

const request = (over: Partial<BoardRequest> = {}): BoardRequest => ({
  id: 'r',
  name: 'Request',
  giver_id: 'adeline',
  giver_name: 'Adeline',
  items: [
    {
      id: 'heather',
      name: 'Heather',
      icon_key: 'forageable/heather',
      category: 'forageable',
      quantity: 3,
    },
  ],
  seasons: null,
  gates: [],
  rewards: null,
  ...over,
})

describe('itemsWanted', () => {
  it('keeps the largest single ask, not the total', () => {
    // Requests arrive and are satisfied one at a time, so the biggest single
    // request is what you need on hand. Summing would tell someone to hoard
    // nine when three was always enough.
    const wanted = itemsWanted([
      request({ id: 'a', items: [{ id: 'x', name: 'X', icon_key: null, quantity: 3 }] }),
      request({ id: 'b', items: [{ id: 'x', name: 'X', icon_key: null, quantity: 6 }] }),
    ])
    expect(wanted[0]?.keep).toBe(6)
    expect(wanted[0]?.requests).toBe(2)
  })

  it('treats a missing quantity as one', () => {
    const wanted = itemsWanted([
      request({ items: [{ id: 'x', name: 'X', icon_key: null, quantity: 1 }] }),
    ])
    expect(wanted[0]?.keep).toBe(1)
  })

  it('collects every villager who can ask, deduplicated, ids attached', () => {
    const wanted = itemsWanted([
      request({ id: 'a', giver_name: 'Adeline' }),
      request({ id: 'b', giver_id: 'balor', giver_name: 'Balor' }),
      request({ id: 'c', giver_name: 'Adeline' }),
    ])
    expect(wanted[0]?.askers).toEqual([
      { id: 'adeline', name: 'Adeline' },
      { id: 'balor', name: 'Balor' },
    ])
  })

  it('is ungated when any one route is open', () => {
    // `gated` is the negation of an OR. If one request for an item is available
    // now, the item can be asked for now — saying otherwise would hide
    // something genuinely needed today.
    const wanted = itemsWanted([
      request({ id: 'a', gates: [{ type: 'year', label: 'Year 2' }] }),
      request({ id: 'b', gates: [] }),
    ])
    expect(wanted[0]?.gated).toBe(false)
  })

  it('is gated only when every route is', () => {
    const wanted = itemsWanted([
      request({ id: 'a', gates: [{ type: 'year', label: 'Year 2' }] }),
      request({ id: 'b', gates: [{ type: 'location', label: 'The Mines unlocked' }] }),
    ])
    expect(wanted[0]?.gated).toBe(true)
  })

  it('leaves seasons empty when a request has no restriction', () => {
    // No restriction means any time of year. An empty set renders as no badges;
    // filling in all four would claim a restriction that does not exist.
    const wanted = itemsWanted([request({ seasons: null })])
    expect(wanted[0]?.seasons).toEqual([])
  })

  it('unions seasons across requests, in calendar order', () => {
    const wanted = itemsWanted([
      request({ id: 'a', seasons: ['fall'] }),
      request({ id: 'b', seasons: ['spring'] }),
    ])
    expect(wanted[0]?.seasons).toEqual(['spring', 'fall'])
  })

  it('carries the category through the inversion', () => {
    const wanted = itemsWanted([request()])
    expect(wanted[0]?.category).toBe('forageable')
  })

  it('shelves an item with no category under misc, never drops it', () => {
    // A bundle from before the field shipped has no `category` at all. The
    // item still belongs to a group — "Other" — because a fold that loses
    // rows would read as missing data.
    const wanted = itemsWanted([
      request({ items: [{ id: 'x', name: 'X', icon_key: null, quantity: 1 }] }),
    ])
    expect(wanted[0]?.category).toBe('misc')
  })

  it('remembers which requests each row was inverted from', () => {
    // The row's checkbox writes `request:<request_id>/<item_id>` — the same
    // keys the item page writes — so the inversion must not lose the request
    // identity behind the aggregate.
    const wanted = itemsWanted([
      request({ id: 'a', items: [{ id: 'x', name: 'X', icon_key: null, quantity: 3 }] }),
      request({ id: 'b', items: [{ id: 'x', name: 'X', icon_key: null, quantity: 6 }] }),
    ])
    expect(wanted[0]?.request_ids).toEqual(['a', 'b'])
  })

  it('carries a spoiler giver as a flag, never as a dropped asker', () => {
    // The veil withholds the name at render; the row and its link stay.
    const wanted = itemsWanted([
      request({ id: 'a', giver_id: 'caldarus', giver_name: 'Caldarus', giver_spoiler: true }),
      request({ id: 'b', giver_id: 'balor', giver_name: 'Balor' }),
    ])
    expect(wanted[0]?.askers).toEqual([
      { id: 'balor', name: 'Balor' },
      { id: 'caldarus', name: 'Caldarus', spoiler: true },
    ])
  })

  it('sorts the most-asked-for first', () => {
    const wanted = itemsWanted([
      request({ id: 'a', items: [{ id: 'rare', name: 'Rare', icon_key: null, quantity: 1 }] }),
      request({ id: 'b', items: [{ id: 'common', name: 'Common', icon_key: null, quantity: 1 }] }),
      request({ id: 'c', items: [{ id: 'common', name: 'Common', icon_key: null, quantity: 1 }] }),
    ])
    expect(wanted.map((w) => w.id)).toEqual(['common', 'rare'])
  })
})
