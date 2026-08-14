import { describe, expect, it } from 'vitest'
import { type GameBoardRequest, readWantedItems } from '../../extract/quests.js'
import { pairBoardRequests, questIds } from './quests.js'

/**
 * The board-request pairing. Every case here shipped wrong at least once in
 * some form: the id-first join let Landen's game row claim the wiki's record
 * whose stated giver was Merri, and a Map overwrite silently dropped one of
 * two same-named pool entries.
 */

const row = (over: Partial<GameBoardRequest> & { id: string }): GameBoardRequest => ({
  name: null,
  npc: null,
  items: [],
  reward_gold: null,
  reward_renown: null,
  reward_item_ids: [],
  reward_recipe_ids: [],
  unread_stage_keys: [],
  ...over,
})

const giverFor = (npc: string | null): string | null => npc

describe('pairBoardRequests', () => {
  it('pairs a lone row with a lone record whatever their ids', () => {
    const { gameByQuest, unmatched, ambiguous } = pairBoardRequests(
      [{ id: 'request_for_eggs', name: 'Request for Eggs', giver_character_id: null }],
      [row({ id: 'request_for_egg', name: 'Request for Eggs', npc: 'eiland' })],
      giverFor,
    )
    expect(gameByQuest.get('request_for_eggs')?.id).toBe('request_for_egg')
    expect(unmatched).toHaveLength(0)
    expect(ambiguous).toBe(0)
  })

  it('pairs duplicates by giver, and appends the row the wiki never listed', () => {
    // The game's `request_for_wood` is Landen's ask; the wiki's lone record of
    // that name states Landen too. Merri's `request_for_wood_2` matches no
    // record and must come out as unmatched — not overwrite Landen's claim.
    const { gameByQuest, unmatched } = pairBoardRequests(
      [{ id: 'request_for_wood', name: 'Request for Wood', giver_character_id: 'landen' }],
      [
        row({ id: 'request_for_wood', name: 'Request for Wood', npc: 'landen' }),
        row({ id: 'request_for_wood_2', name: 'Request for Wood', npc: 'merri' }),
      ],
      giverFor,
    )
    expect(gameByQuest.get('request_for_wood')?.npc).toBe('landen')
    expect(unmatched.map((r) => r.id)).toEqual(['request_for_wood_2'])
  })

  it('pairs a duplicate to the right record even when slugs disagree', () => {
    // The record with the plain slug states Merri — the game row of that id
    // is Landen's. Giver agreement must outrank id equality.
    const { gameByQuest } = pairBoardRequests(
      [
        { id: 'request_for_wood', name: 'Request for Wood', giver_character_id: 'merri' },
        { id: 'request_for_wood_landen', name: 'Request for Wood', giver_character_id: 'landen' },
      ],
      [
        row({ id: 'request_for_wood', name: 'Request for Wood', npc: 'landen' }),
        row({ id: 'request_for_wood_2', name: 'Request for Wood', npc: 'merri' }),
      ],
      giverFor,
    )
    expect(gameByQuest.get('request_for_wood')?.npc).toBe('merri')
    expect(gameByQuest.get('request_for_wood_landen')?.npc).toBe('landen')
  })

  it('leaves same-name same-giver pairs ambiguous rather than guessing', () => {
    // The two Eiland strawberry requests are genuinely indistinguishable.
    const { gameByQuest, unmatched, ambiguous } = pairBoardRequests(
      [
        {
          id: 'request_for_a_strawberry_eiland',
          name: 'Request for a Strawberry',
          giver_character_id: 'eiland',
        },
        {
          id: 'request_for_a_strawberry_eiland_2',
          name: 'Request for a Strawberry',
          giver_character_id: 'eiland',
        },
      ],
      [
        row({ id: 'request_for_a_strawberry', name: 'Request for a Strawberry', npc: 'eiland' }),
        row({ id: 'request_for_a_strawberry_2', name: 'Request for a Strawberry', npc: 'eiland' }),
      ],
      giverFor,
    )
    expect(gameByQuest.size).toBe(0)
    // Ambiguous, not unmatched: appending them would ship four records for
    // two requests.
    expect(unmatched).toHaveLength(0)
    expect(ambiguous).toBe(2)
  })

  it('returns a row with no record of its name as unmatched', () => {
    const { gameByQuest, unmatched } = pairBoardRequests(
      [],
      [row({ id: 'request_for_apple_pie', name: 'Request for Apple Pie', npc: 'louis' })],
      giverFor,
    )
    expect(gameByQuest.size).toBe(0)
    expect(unmatched.map((r) => r.id)).toEqual(['request_for_apple_pie'])
  })
})

describe('readWantedItems', () => {
  it('reads all three spellings the game uses', () => {
    expect(readWantedItems('obsidian')).toEqual([{ id: 'obsidian', quantity: 1 }])
    expect(readWantedItems({ smallmouth_bass: 2 })).toEqual([
      { id: 'smallmouth_bass', quantity: 2 },
    ])
    // The gardening request's array-of-tables form, found because its items
    // extracted to nothing and the source-agreement report said so.
    expect(readWantedItems([{ sod: 1 }, { peat: 1 }])).toEqual([
      { id: 'sod', quantity: 1 },
      { id: 'peat', quantity: 1 },
    ])
  })

  it('reads junk as nothing rather than as an item', () => {
    expect(readWantedItems(true)).toEqual([])
    expect(readWantedItems(null)).toEqual([])
    expect(readWantedItems({ sod: 'many' })).toEqual([])
  })
})

describe('questIds', () => {
  it('keeps clean ids for unique names and suffixes only the duplicates', () => {
    expect(
      questIds([
        { name: 'Request for Eggs', giver: null },
        { name: 'Request for Berries', giver: 'Celine' },
        { name: 'Request for Berries', giver: 'Reina' },
      ]),
    ).toEqual(['request_for_eggs', 'request_for_berries_celine', 'request_for_berries_reina'])
  })
})
