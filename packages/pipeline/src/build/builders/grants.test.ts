/**
 * Where recipes are learned, and what the game hands you.
 *
 * These assert **counts against the built `data/`**, not shapes against a
 * fixture, because the failure this feature is prone to is a join that quietly
 * stops matching. Every number here was a bug at some point in the build:
 *
 * - Reading only `recipe_scroll` and not `crafting_scroll` found 88 grants and
 *   concluded furniture recipes had no source at all.
 * - Reading only `item`/`item_id` and not `item_name` dropped 94 letter grants.
 * - Not mapping a grant key through the furniture collapse matched almost
 *   nothing, because grants name colour variants.
 *
 * A count that moves is either a real data change or a join that broke, and
 * both are worth stopping on. The bounds are deliberately tight; loosening one
 * is a decision, and it should come with a reason.
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { DATA_DIR } from '../../lib/paths.js'
import { foldName } from './grants.js'

interface RecipeRecord {
  id: string
  kind: string
  skill: { id: string; level: number } | null
  data_gaps: string[]
  output: { item_id: string | null }
  sources: {
    method: string
    source_id: string | null
    character_id: string | null
    price: number | null
    requires: { type: string; key: string }[]
    confidence: string
  }[]
}

interface ShopRecord {
  id: string
  data_gaps: string[]
  stock: { item_id: string; price: number | null; teaches_recipe_id: string | null }[]
}

interface ItemRecord {
  id: string
  category: string
  data_gaps: string[]
  availability: { method: string; locations: string[]; biome_id: string | null }[]
}

const read = async <T>(file: string): Promise<T[]> =>
  JSON.parse(await readFile(join(DATA_DIR, file), 'utf8')) as T[]

let recipes: RecipeRecord[]
let shops: ShopRecord[]
let items: ItemRecord[]

beforeAll(async () => {
  recipes = await read<RecipeRecord>('recipes.json')
  shops = await read<ShopRecord>('shops.json')
  items = await read<ItemRecord>('items.json')
})

const bySource = (method: string): RecipeRecord[] =>
  recipes.filter((r) => r.sources.some((s) => s.method === method))

describe('foldName', () => {
  it('folds the differences that actually appear between the two sources', () => {
    // The wiki writes a curly apostrophe and the game writes a straight one;
    // "Well Armed" and "Well-Armed" are the same perk.
    expect(foldName('Beekeeper’s Hat')).toBe(foldName("Beekeeper's Hat"))
    expect(foldName('Well-Armed')).toBe(foldName('Well Armed'))
    expect(foldName('The Tide Caverns')).toBe('thetidecaverns')
  })

  it('does not fold two genuinely different names together', () => {
    expect(foldName('Request for Berries')).not.toBe(foldName('Request for a Strawberry'))
  })
})

describe('every recipe answers "where do I learn this"', () => {
  it('leaves at most a handful with nothing to say', () => {
    const silent = recipes.filter((r) => r.sources.length === 0)
    // The engagement ring and the giant essence stone: each handed over by a
    // story beat nothing models, and neither states a crafting level to fall
    // back on. They say so rather than inventing a third answer.
    expect(silent.map((r) => r.id).sort()).toEqual(['engagement_ring', 'essence_stone_giant'])
    for (const recipe of silent) expect(recipe.data_gaps).toContain('sources')
  })

  it('states a source the game names for well over half of them', () => {
    const stated = recipes.filter((r) => r.sources.some((s) => s.confidence !== 'inferred'))
    expect(stated.length).toBeGreaterThan(500)
  })

  it('finds every kind of grant site, not just the easy ones', () => {
    // Each of these is a separate file in the game, and each was found by a
    // structural sweep rather than by a name list. A zero here means a whole
    // file stopped being read.
    expect(bySource('shop').length).toBeGreaterThan(150)
    expect(bySource('default').length).toBeGreaterThan(150)
    expect(bySource('quest').length).toBeGreaterThan(100)
    expect(bySource('mail').length).toBeGreaterThan(35)
    expect(bySource('mines_chest').length).toBeGreaterThan(15)
    expect(bySource('festival').length).toBeGreaterThan(0)
    expect(bySource('wishing_well').length).toBeGreaterThan(0)
    expect(bySource('chicken_statue').length).toBeGreaterThan(0)
  })

  it('reaches furniture, whose grants all name a colour variant', () => {
    // `crafting_scroll` is the furniture spelling of the token and the museum
    // reward tiers are full of them. Reading only `recipe_scroll` found none of
    // this and made every furniture recipe look level-gated.
    const furniture = recipes.filter((r) => r.kind === 'woodcrafting')
    const stated = furniture.filter((r) => r.sources.some((s) => s.confidence !== 'inferred'))
    expect(stated.length).toBeGreaterThan(200)
  })

  it('keeps every source when a recipe is taught in more than one place', () => {
    // The Spicy Cheddar Biscuit is sold at Darcy's stall *and* rolls out of the
    // Wishing Well. Collapsing those to one would pick a winner arbitrarily.
    const biscuit = recipes.find((r) => r.id === 'spicy_cheddar_biscuit')
    expect(biscuit?.sources.map((s) => s.method).sort()).toEqual(['shop', 'wishing_well'])
    expect(recipes.filter((r) => r.sources.length > 1).length).toBeGreaterThan(1)
  })
})

describe('an inference never looks like a fact', () => {
  it('marks every level-derived source inferred, and nothing else', () => {
    for (const recipe of recipes) {
      for (const source of recipe.sources) {
        expect(source.confidence === 'inferred').toBe(source.method === 'skill_level')
      }
    }
  })

  it('only infers a level where the game states one', () => {
    for (const recipe of recipes) {
      if (!recipe.sources.some((s) => s.method === 'skill_level')) continue
      expect(recipe.skill).not.toBeNull()
      const gate = recipe.sources.find((s) => s.method === 'skill_level')?.requires[0]
      expect(gate).toEqual({
        type: 'skill',
        key: recipe.skill?.id,
        op: '>=',
        value: recipe.skill?.level,
      })
    }
  })

  it('never infers a level for a recipe a source already names', () => {
    for (const recipe of recipes) {
      if (recipe.sources.length <= 1) continue
      expect(recipe.sources.some((s) => s.method === 'skill_level')).toBe(false)
    }
  })
})

describe('a source points at something real', () => {
  it('names the shop that sells the scroll', () => {
    const lemonPie = recipes.find((r) => r.id === 'lemon_pie')
    expect(lemonPie?.sources).toEqual([
      expect.objectContaining({ method: 'shop', source_id: 'inn', price: 400 }),
    ])
  })

  it('prices a scroll from the shelf, never from the dish', () => {
    // `value.store` is what the *product* costs. The Inn sells the Lemon Pie at
    // 650 and its recipe at 400, and filling the scroll from the global figure
    // would produce a wrong number that looks entirely reasonable.
    const inn = shops.find((s) => s.id === 'inn')
    const dish = inn?.stock.find((l) => l.item_id === 'lemon_pie' && l.teaches_recipe_id === null)
    const scroll = inn?.stock.find((l) => l.teaches_recipe_id === 'lemon_pie')
    expect(dish?.price).toBe(650)
    expect(scroll?.price).toBe(400)
  })

  it('names the mine a treasure-chest recipe comes out of, behind the perk', () => {
    const chest = recipes.flatMap((r) => r.sources.filter((s) => s.method === 'mines_chest'))
    expect(chest.length).toBeGreaterThan(15)
    for (const source of chest) {
      expect(source.source_id).not.toBeNull()
      expect(source.requires).toContainEqual({
        type: 'perk',
        key: 'taste_maker',
        op: 'has',
        value: null,
      })
    }
  })

  it('carries the letter’s sender and its condition', () => {
    // The post is this game's milestone reward system: 35 recipes arrive for
    // shipping something and three for donating one to the museum.
    const mail = recipes.flatMap((r) => r.sources.filter((s) => s.method === 'mail'))
    const shipped = mail.filter((s) => s.requires.some((g) => g.type === 'shipped_item'))
    const donated = mail.filter((s) => s.requires.some((g) => g.type === 'donated_item'))
    expect(shipped.length).toBeGreaterThan(30)
    expect(donated.length).toBe(3)
    for (const source of mail) expect(source.character_id).not.toBeNull()
  })
})

describe('the shop shelves', () => {
  it('no longer lists the same product twice with nothing to tell them apart', () => {
    // 23 lines at the Inn were the dish and its recipe scroll under one id,
    // kept apart only by price. A duplicate is fine *if* one of the pair is the
    // recipe; two plain product lines are the bug.
    for (const shop of shops) {
      const plain = shop.stock.filter((l) => l.teaches_recipe_id === null)
      const ids = plain.map((l) => l.item_id)
      expect(new Set(ids).size).toBe(ids.length)
    }
  })

  it('stocks the recipes the shops actually sell, and only those', () => {
    // 32: the Inn's Recipes shelf and the Tackle Shop's, both of which shipped
    // empty before. Deliberately **not** the ~150 you get by also counting
    // `include_recipe` lines — Merri sells the Haunted Attic Bed *and* teaches
    // it, so that line is a product with a price and a seller, and marking it a
    // scroll nulled the price and emptied the bed's `sold_by`. The recipe half
    // of an `include_recipe` line lives on the recipe's own sources.
    const lines = shops.flatMap((s) => s.stock.filter((l) => l.teaches_recipe_id !== null))
    expect(lines.length).toBe(32)

    // A scroll is priced by the page that prices it, or not at all. One Inn row
    // (the Veggie Sub Sandwich) has no price on the wiki, and the honest answer
    // is null plus the shop's own `stock_price` gap — **not** the dish's global
    // `value.store`, which would put the sandwich's price on its recipe and
    // look entirely plausible.
    expect(lines.filter((l) => l.price === null)).toHaveLength(1)
    expect(shops.find((s) => s.id === 'inn')?.data_gaps).toContain('stock_price')

    // Every claim resolves — a dangling id would fail refint, and a silent one
    // would put a recipe on a shelf that nothing can look up.
    const recipeIds = new Set(recipes.map((r) => r.id))
    for (const line of lines) expect(recipeIds.has(line.teaches_recipe_id ?? '')).toBe(true)
  })

  it('keeps a line that sells the product and teaches it as a product line', () => {
    const merri = shops.find((s) => s.id === 'merris_stall')
    const bed = merri?.stock.filter((l) => l.item_id === 'haunted_attic_bed') ?? []
    expect(bed).toHaveLength(1)
    expect(bed[0]?.teaches_recipe_id).toBeNull()
    expect(bed[0]?.price).not.toBeNull()
    // …and the recipe still knows where it is taught.
    const recipe = recipes.find((r) => r.id === 'haunted_attic_bed')
    expect(recipe?.sources).toContainEqual(
      expect.objectContaining({ method: 'shop', source_id: 'merris_stall' }),
    )
  })
})

describe('item grants', () => {
  it('gives furniture somewhere to come from', () => {
    // 925 records shipped `availability: []` because the wiki's furniture table
    // says nothing about sources. The game says plenty.
    const furniture = items.filter((i) => i.category === 'furniture')
    const placed = furniture.filter((i) => i.availability.length > 0)
    expect(placed.length).toBeGreaterThan(150)
  })

  it('puts a chest drop in a mine without claiming the mine is a place', () => {
    // The location goes in `locations` and the biome in `biome_id`. A mine id
    // in `locations` fails refint: a band of floors is not a spot on the map.
    const chests = items.flatMap((i) => i.availability.filter((w) => w.method === 'chest'))
    expect(chests.length).toBeGreaterThan(50)
    for (const window of chests) expect(window.biome_id).not.toBeNull()
  })

  it('drops the obtain_method gap once something answers it', () => {
    for (const item of items) {
      if (item.availability.length === 0) continue
      expect(item.data_gaps).not.toContain('obtain_method')
    }
  })
})
