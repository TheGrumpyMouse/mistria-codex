/**
 * The bestiary's game join, asserted as counts against the built `data/` in
 * the same spirit as grants.test.ts: the failure mode this feature is prone to
 * is the curated alias quietly not matching, and a count that moves is either
 * a real game change or a broken join — both worth stopping on.
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { DATA_DIR } from '../../lib/paths.js'

interface MonsterRecord {
  id: string
  hp: number | null
  damage: number | null
  essence: number | null
  coins: { min: number; max: number } | null
  drops: {
    item_id: string
    chance: number | null
    quantity: { min: number; max: number } | null
    requires_perk: string | null
  }[]
  super_drops: MonsterRecord['drops']
  data_gaps: string[]
}

let monsters: MonsterRecord[]

beforeAll(async () => {
  monsters = JSON.parse(await readFile(join(DATA_DIR, 'monsters.json'), 'utf8'))
})

describe('the bestiary game join', () => {
  it('joins every monster to a variant table — the alias file covers the roster', () => {
    expect(monsters.filter((m) => m.hp !== null)).toHaveLength(monsters.length)
    expect(monsters.filter((m) => m.damage !== null)).toHaveLength(monsters.length)
    expect(monsters.filter((m) => m.essence !== null)).toHaveLength(monsters.length)
  })

  it('reads the Rock Clod exactly as its table states it', () => {
    const rockClod = monsters.find((m) => m.id === 'rock_clod')
    expect(rockClod).toMatchObject({ hp: 8, damage: 10, essence: 5, coins: { min: 1, max: 5 } })
  })

  it('ships percent chances as fractions, never as raw percent', () => {
    // 70 written as 70 instead of 0.7 would claim a 7000% drop; the schema
    // caps at 1, so any regression lands here or in zod, loudly.
    const chances = monsters.flatMap((m) => m.drops).map((d) => d.chance)
    expect(chances.some((c) => c !== null && c > 1)).toBe(false)
    expect(chances.some((c) => c !== null && c > 0.5)).toBe(true)
  })

  it('gates every pet-skin drop behind Friend-Shaped, and only those', () => {
    const gated = monsters.flatMap((m) => m.drops).filter((d) => d.requires_perk !== null)
    expect(gated.length).toBeGreaterThanOrEqual(10)
    for (const drop of gated) {
      expect(drop.item_id).toMatch(/^pet_skin_/)
      expect(drop.requires_perk).toBe('friend_shaped')
    }
  })

  it('keeps the Rock Stack’s guaranteed break loot out of the ordinary table', () => {
    const rockStack = monsters.find((m) => m.id === 'rock_stack')
    expect(rockStack?.super_drops.map((d) => d.item_id)).toEqual(['ore_diamond'])
    expect(rockStack?.drops.map((d) => d.item_id)).not.toContain('ore_diamond')
  })

  it('resolves the hat cosmetics that were unresolvable by display name', () => {
    // The 34 "Sapling Hat"-style tokens: the game names the cosmetic ids
    // directly, so the drop tables now carry them as ordinary entries.
    const hats = monsters.flatMap((m) => m.drops).filter((d) => /^head_.*hat/.test(d.item_id))
    expect(hats.length).toBeGreaterThanOrEqual(10)
  })

  it('leaves the Mimic honest — no stated drops, the gap says so', () => {
    const mimic = monsters.find((m) => m.id === 'mimic')
    expect(mimic?.data_gaps).toContain('drops')
  })
})
