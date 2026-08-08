import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { DATA_DIR } from '../../lib/paths.js'

interface SetRecord {
  id: string
  name: string
  wing: string
  item_ids: string[]
  required_count: number
  game_version: string | null
}
interface ItemRecord {
  id: string
  name: string
  category: string
  museum: { donatable: boolean; set_id: string | null; wing: string | null } | null
}

let sets: SetRecord[]
let items: ItemRecord[]

const read = async <T>(file: string): Promise<T> =>
  JSON.parse(await readFile(join(DATA_DIR, file), 'utf8')) as T

beforeAll(async () => {
  sets = await read<SetRecord[]>('museum_sets.json')
  items = await read<ItemRecord[]>('items.json')
})

/**
 * The museum's structural invariants, asserted against the real built dataset.
 * Every one of these caught an actual bug the first time it ran.
 */
describe('museum sets', () => {
  it('covers all four wings', () => {
    expect(new Set(sets.map((s) => s.wing))).toEqual(
      new Set(['archaeology', 'fish', 'flora', 'insects']),
    )
  })

  it('no item belongs to two sets', () => {
    // Regression: Artifacts and Bugs both have sets named "Upper Mines",
    // "Deep Earth", "Lava Caves" and "Deep Woods". Keying the Cargo roster
    // lookup by set name alone put 21 mine bugs into the archaeology wing.
    const claimed = new Map<string, string>()
    const clashes: string[] = []
    for (const set of sets) {
      for (const id of set.item_ids) {
        const prior = claimed.get(id)
        if (prior !== undefined) clashes.push(`${id}: ${prior} + ${set.id}`)
        claimed.set(id, set.id)
      }
    }
    expect(clashes).toEqual([])
  })

  it('required_count is per-set, and the Legendary Fish set needs four', () => {
    // Hardcoding five would make the museum permanently un-completable.
    const legendary = sets.find((s) => s.id === 'fish_legendary')
    expect(legendary?.required_count).toBe(4)
    expect(legendary?.item_ids).toHaveLength(4)

    for (const set of sets) expect(set.item_ids).toHaveLength(set.required_count)
  })

  it('every set member is a real item', () => {
    const ids = new Set(items.map((i) => i.id))
    const missing = sets.flatMap((s) => s.item_ids.filter((id) => !ids.has(id)))
    expect(missing).toEqual([])
  })

  it('every donatable item belongs to a set', () => {
    // Regression: nine item names carried an undecoded `&#039;`
    // ("Mermaid&#039;s Comb"), slugified to garbage, and matched no roster.
    const unassigned = items
      .filter((i) => i.museum?.donatable === true && i.museum.set_id === null)
      .map((i) => i.name)
    expect(unassigned).toEqual([])
  })

  it("an item's wing matches the wing of its set", () => {
    const wingOf = new Map(sets.map((s) => [s.id, s.wing]))
    for (const item of items) {
      if (item.museum?.set_id == null) continue
      expect(item.museum.wing).toBe(wingOf.get(item.museum.set_id))
    }
  })

  it('records the wiki version each wing list came from', () => {
    // All four wing pages are pre-1.0 snapshots (fish v0.14.0, the rest v0.15).
    // The app must be able to say so rather than implying the list is current.
    for (const set of sets) expect(set.game_version).toBeTruthy()
  })
})

describe('display names', () => {
  it('has no undecoded HTML entities', () => {
    // The bug that broke museum assignment. Worth asserting across every name,
    // not just the nine that had apostrophes.
    const bad = items.filter((i) => /&#?\w+;/.test(i.name)).map((i) => i.name)
    expect(bad).toEqual([])
  })

  it('keeps apostrophes intact', () => {
    expect(items.map((i) => i.name)).toContain("Mermaid's Comb")
    expect(items.map((i) => i.name)).toContain("Miner's Pickaxe")
  })
})
