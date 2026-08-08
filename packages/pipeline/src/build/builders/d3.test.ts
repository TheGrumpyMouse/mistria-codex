import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { parseFestivalTable } from '../../enrich/calendar.js'
import { parseConditions, questFromSourceIcon } from '../../enrich/quests.js'
import { parseStockTable } from '../../enrich/shops.js'
import { parseSkillSection } from '../../enrich/skills.js'
import { DATA_DIR } from '../../lib/paths.js'
import { expandVariables, rowCells } from '../../lib/wiki.js'
import { parseRequirement } from './shops.js'

interface SkillRecord {
  id: string
  max_level: number
  xp_curve: number[] | null
  data_gaps: string[]
  perks: {
    id: string
    name: string
    tier: number
    level: number
    essence_cost: number | null
    statue: string
  }[]
}
interface FestivalRecord {
  id: string
  name: string
  date: { season: string; day: number }
  implemented: boolean
  location_id: string | null
  currency_item_id: string | null
  activities: string[]
  data_gaps: string[]
}
interface MineRecord {
  id: string
  floors: { min: number; max: number }
  ore_item_ids: string[]
  fish_item_ids: string[]
  artifact_set_ids: string[]
  gate: { type: string; key: string; op: string }[]
  location_id: string | null
}
interface ItemRecord {
  id: string
  category: string
  availability: { depth: { min: number; max: number } | null; biome_id: string | null }[]
}
interface QuestRecord {
  id: string
  name: string
  kind: string
  objectives: { type: string; target_id: string | null; quantity: number | null }[]
  season_restriction: string[] | null
  data_gaps: string[]
}
interface AnimalRecord {
  id: string
  building: 'coop' | 'barn'
  matures_days: number | null
  data_gaps: string[]
  products: { item_id: string; hearts_required: number | null; quality: string | null }[]
  breeding: { treat_item_id: string | null; gestation_days: number | null } | null
  feed_item_ids: string[]
}
interface BuildingRecord {
  id: string
  kind: string
  data_gaps: string[]
  tiers: {
    level: number
    capacity: number | null
    cost: { tesserae: number | null; materials: { item_id: string; quantity: number }[] }
    requires: { type: string; key: string; op: string; value: number | string | null }[]
  }[]
}
interface ShopRecord {
  id: string
  name: string
  location_id: string | null
  owner_character_id: string | null
  staff_character_ids: string[]
  hours: unknown[]
  unlock_requires: { type: string; key: string }[]
  data_gaps: string[]
  stock: {
    item_id: string
    price: number | null
    currency: string
    requires: { type: string; key: string; op: string; value: number | string | null }[]
    seasons: string[] | null
    rotation: boolean
  }[]
}

let skills: SkillRecord[]
let festivals: FestivalRecord[]
let mines: MineRecord[]
let items: ItemRecord[]
let shops: ShopRecord[]
let quests: QuestRecord[]
let itemIds: string[]
let animals: AnimalRecord[]
let buildings: BuildingRecord[]

const read = async <T>(file: string): Promise<T> =>
  JSON.parse(await readFile(join(DATA_DIR, file), 'utf8')) as T

beforeAll(async () => {
  skills = await read<SkillRecord[]>('skills.json')
  festivals = await read<FestivalRecord[]>('festivals.json')
  mines = await read<MineRecord[]>('mines.json')
  items = await read<ItemRecord[]>('items.json')
  shops = await read<ShopRecord[]>('shops.json')
  quests = await read<QuestRecord[]>('quests.json')
  itemIds = items.map((i) => i.id)
  animals = await read<AnimalRecord[]>('animals.json')
  buildings = await read<BuildingRecord[]>('buildings.json')
})

describe('skills', () => {
  it('has all nine skills, each with perks', () => {
    expect(skills.map((s) => s.id).sort()).toEqual([
      'archaeology',
      'blacksmithing',
      'combat',
      'cooking',
      'farming',
      'fishing',
      'mining',
      'ranching',
      'woodcrafting',
    ])
    for (const skill of skills) expect(skill.perks.length).toBeGreaterThan(0)
  })

  it('every perk has a cost', () => {
    // Regression: the perk tables mix inline cells (`|| '''Name''' || cost`)
    // with one-cell-per-line rows. A line-based reader dropped the cost of
    // every perk written the second way, and the nulls looked exactly like a
    // wiki omission.
    const missing = skills.flatMap((s) =>
      s.perks.filter((p) => p.essence_cost === null).map((p) => `${s.id}/${p.name}`),
    )
    expect(missing).toEqual([])
  })

  it('tiers unlock at the same levels across every skill', () => {
    const byTier = new Map<number, Set<number>>()
    for (const skill of skills) {
      for (const perk of skill.perks) {
        // Game-appended perks (the 1.0 additions the wiki has not written up)
        // carry a null level with a `perk_levels` gap; the invariant is about
        // the levels the wiki actually states.
        if (perk.level === null) continue
        byTier.set(perk.tier, (byTier.get(perk.tier) ?? new Set()).add(perk.level))
      }
    }
    // One level per tier, everywhere: 1, 15, 30, 45, 60.
    expect([...byTier.entries()].sort().map(([t, levels]) => [t, [...levels]])).toEqual([
      [1, [1]],
      [2, [15]],
      [3, [30]],
      [4, [45]],
      [5, [60]],
    ])
  })

  it('no tree stops short of tier five any more', () => {
    // Ranching's fifth tier was a hole in the wiki until 1.0's skill-menu
    // union filled it from the game files. If this regresses, the tier_5 gap
    // machinery in the builder is what flags it.
    for (const skill of skills) {
      expect(skill.data_gaps).not.toContain('tier_5')
      expect(new Set(skill.perks.map((p) => p.tier)).size).toBe(5)
    }
  })

  it('leaves the XP curve null and says so', () => {
    // 60 plausible numbers are indistinguishable from 60 real ones.
    for (const skill of skills) {
      expect(skill.xp_curve).toBeNull()
      expect(skill.data_gaps).toContain('xp_curve')
      expect(skill.max_level).toBe(60)
    }
  })

  it('perk ids are unique within a skill', () => {
    for (const skill of skills) {
      const ids = skill.perks.map((p) => p.id)
      expect(new Set(ids).size).toBe(ids.length)
    }
  })
})

describe('festivals', () => {
  it('has the four implemented festivals on their real dates', () => {
    const live = festivals
      .filter((f) => f.implemented)
      .map((f) => `${f.date.season} ${f.date.day} ${f.name}`)
      .sort()
    expect(live).toEqual([
      'fall 10 Harvest Festival',
      'spring 17 Spring Festival',
      'summer 28 Shooting Star Festival',
      'winter 10 Animal Festival',
    ])
  })

  it('keeps the unimplemented ones, flagged', () => {
    // Six exist in the game files and never fire. Dropping them would look like
    // nobody checked; treating them as real would promise a festival that never
    // arrives.
    const dead = festivals.filter((f) => !f.implemented)
    expect(dead).toHaveLength(6)
    expect(dead.map((f) => f.name)).toContain('Halloween Festival')
  })

  it('never copies the wiki description of what happens', () => {
    for (const festival of festivals) {
      expect(festival.activities).toEqual([])
      expect(festival.data_gaps).toContain('activities')
    }
  })

  it('resolves festival currencies to real items', () => {
    const byId = new Map(festivals.map((f) => [f.id, f]))
    expect(byId.get('spring_festival')?.currency_item_id).toBe('breath_of_spring')
    expect(byId.get('harvest_festival')?.currency_item_id).toBe('queen_berry')
    // The other two have no currency, which is different from an unknown one.
    expect(byId.get('animal_festival')?.currency_item_id).toBeNull()
  })

  it('has no festival with an invented time', () => {
    for (const festival of festivals) expect(festival.data_gaps).toContain('time')
  })
})

describe('mine biomes', () => {
  it('covers the five biomes and their floor ranges', () => {
    expect(mines.map((m) => `${m.id} ${m.floors.min}-${m.floors.max}`)).toEqual([
      'upper_mines 1-19',
      'tide_caverns 21-39',
      'deep_earth 41-59',
      'lava_caves 61-79',
      'ancient_ruins 81-99',
    ])
  })

  it('leaves the seal floors out of every biome', () => {
    // Floors 20, 40, 60, 80 and 100 are story gates, not part of a biome.
    for (const seal of [20, 40, 60, 80, 100]) {
      const claiming = mines.filter((m) => seal >= m.floors.min && seal <= m.floors.max)
      expect(claiming).toEqual([])
    }
  })

  it('gates each biome on a quest', () => {
    for (const biome of mines) {
      expect(biome.gate.every((g) => g.type === 'quest' && g.op === 'done')).toBe(true)
    }
    expect(mines.find((m) => m.id === 'lava_caves')?.gate[0]?.key).toBe('breaking_the_fire_seal')
  })

  it('derives fish from the items already located in the biome', () => {
    const tide = mines.find((m) => m.id === 'tide_caverns')
    expect(tide?.fish_item_ids).toContain('archerfish')
    for (const biome of mines) expect(biome.fish_item_ids.length).toBeGreaterThan(0)
  })

  it('gives every biome its own ore, under the game own id', () => {
    // `ore_copper`, not `copper_ore`. The id is the game's internal name, and
    // the slug had it backwards for 192 of 999 items — see
    // build/reports/id-divergence.md.
    const upper = mines.find((m) => m.id === 'upper_mines')
    expect(upper?.ore_item_ids).toContain('ore_copper')
    expect(upper?.ore_item_ids).toContain('perfect_ruby')
    // The common drops every biome shares are included once, not repeated.
    for (const biome of mines) {
      expect(biome.ore_item_ids).toContain('ore_stone')
      expect(new Set(biome.ore_item_ids).size).toBe(biome.ore_item_ids.length)
    }
  })
})

describe('biome_id on availability windows', () => {
  it('agrees with the floor range it was derived from', () => {
    const floorsOf = new Map(mines.map((m) => [m.id, m.floors]))
    for (const item of items) {
      for (const window of item.availability) {
        if (window.biome_id === null || window.depth === null) continue
        const floors = floorsOf.get(window.biome_id)
        expect(floors).toBeDefined()
        expect(window.depth.min).toBeGreaterThanOrEqual(floors?.min ?? 0)
        expect(window.depth.max).toBeLessThanOrEqual(floors?.max ?? 0)
      }
    }
  })

  it('is set whenever the floor range fits inside one biome', () => {
    const missed = items.flatMap((item) =>
      item.availability
        .filter((w) => {
          if (w.depth === null || w.biome_id !== null) return false
          const depth = w.depth
          return mines.some((m) => depth.min >= m.floors.min && depth.max <= m.floors.max)
        })
        .map(() => item.id),
    )
    expect(missed).toEqual([])
  })

  it('stays null for a range spanning more than one biome', () => {
    // Void Herb is on floors 1-99 — every non-seal floor in the mines. Naming
    // one biome there would be wrong, and naming all five is what `depth`
    // already says.
    const voidHerb = items.find((i) => i.id === 'void_herb')
    const spanning = voidHerb?.availability.find((w) => w.depth?.min === 1 && w.depth.max === 99)
    expect(spanning?.biome_id).toBeNull()
  })
})

describe('shops', () => {
  it('has the eight stores and six market stalls, each with a location', () => {
    expect(shops.map((s) => s.id).sort()).toEqual([
      'balors_wagon',
      'blacksmith',
      'carpenter',
      'clinic',
      'darcys_stall',
      'general_store',
      'haydens_shop',
      'inn',
      'louis_stall',
      'merris_stall',
      'tackle_shop',
      'veras_stall',
      'wheedles_stall',
      'zorels_stall',
    ])
    for (const shop of shops) {
      expect(shop.location_id).not.toBeNull()
      // A stall whose whole inventory is deferred cosmetics ships empty and
      // says so; every other shop has stock.
      if (shop.stock.length === 0) expect(shop.data_gaps).toContain('stock')
    }
  })

  it('records no opening hours except the market stalls, and never calls hours a gap', () => {
    // Shops in this game never close within a day — you can buy until 2am,
    // which is the end of the day. Empty means "no restriction". The Saturday
    // Market stalls are the one *day-of-week* gate, stated as a full-Saturday
    // window.
    for (const shop of shops) {
      if (shop.id.endsWith('_stall')) {
        expect(shop.hours).toEqual([{ days: ['sat'], from: '00:00', to: '00:00' }])
        expect(shop.unlock_requires.map((r) => r.key)).toEqual(['repair_the_bridge'])
      } else {
        expect(shop.hours).toEqual([])
      }
      expect(shop.data_gaps).not.toContain('hours')
    }
  })

  it('names who is behind the counter, including joint owners', () => {
    const byId = new Map(shops.map((s) => [s.id, s]))
    // Nora and Holt run the General Store between them, so neither is "the"
    // owner — but a player still wants to know who they will be talking to.
    expect(byId.get('general_store')?.owner_character_id).toBeNull()
    expect(byId.get('general_store')?.staff_character_ids).toEqual(['nora', 'holt'])
    expect(byId.get('tackle_shop')?.owner_character_id).toBe('terithia')
  })

  it('prices stock in a real currency, never in a stat', () => {
    // The armour rows price a defence stat with the same {{Price}} template as
    // the cost. Reading the first one put "2 defense" in five price columns.
    for (const shop of shops) {
      for (const line of shop.stock) {
        expect(['tesserae', 'renown', 'essence']).toContain(line.currency)
      }
    }
    const armour = shops
      .find((s) => s.id === 'blacksmith')
      ?.stock.find((l) => l.item_id === 'copper_helmet')
    expect(armour?.price).toBe(1000)
  })

  it('reads prices held in a page variable', () => {
    // The Blacksmith defines each tier's price once and refers to it from every
    // row. Unexpanded, forty-four tools and armour pieces come out unpriced.
    const blacksmith = shops.find((s) => s.id === 'blacksmith')
    const unpriced = blacksmith?.stock.filter((l) => l.price === null) ?? []
    expect(unpriced).toEqual([])
    expect(blacksmith?.stock.find((l) => l.item_id === 'pick_axe_copper')?.price).toBe(1000)
  })

  it('sells a whole tool tier, not just the first of the row', () => {
    // `[[Copper Pickaxe]] / [[Copper Axe|Axe]] / …` is six items on one line.
    const blacksmith = shops.find((s) => s.id === 'blacksmith')
    for (const id of ['pick_axe_copper', 'axe_copper', 'hoe_copper', 'watering_can_copper']) {
      expect(blacksmith?.stock.map((l) => l.item_id)).toContain(id)
    }
  })

  it('keeps the requirement a rowspan holds open for later rows', () => {
    // Thirteen Inn recipes share one "Upgrade The Inn" cell. Dropping it tells
    // a player they can buy things they cannot.
    const gated = shops
      .find((s) => s.id === 'inn')
      ?.stock.filter((l) => l.requires.some((r) => r.key === 'upgrade_the_inn'))
    expect(gated?.length ?? 0).toBeGreaterThan(5)
  })

  it('season-gates the seed tables and the seasonal wardrobe, and nothing else', () => {
    const seasonal = shops.flatMap((s) => s.stock.filter((l) => l.seasons !== null))
    expect(seasonal.length).toBeGreaterThan(0)
    // Two sources of a season, and only two: the General Store's seed tables,
    // which the wiki heads by season, and Louis's seasonal rack, which the
    // game gates with `is_season` (bunny ears in spring, swimwear in summer).
    const shopsWithSeasonal = shops.filter((s) => s.stock.some((l) => l.seasons !== null))
    expect(shopsWithSeasonal.map((s) => s.id).sort()).toEqual(['general_store', 'louis_stall'])
  })

  it("marks Balor's and the market stalls' stock as rotating and nobody else's", () => {
    // Balor's whole wagon rotates; a stall line rotates when its category
    // declares a draw size (`target_selections`).
    const rotating = shops.filter((s) => s.stock.some((l) => l.rotation))
    for (const shop of rotating) {
      expect(shop.id === 'balors_wagon' || shop.id.endsWith('_stall')).toBe(true)
    }
    expect(rotating.map((s) => s.id)).toContain('balors_wagon')
  })
})

describe('quests', () => {
  it('resolves every gate the rest of the dataset already relies on', () => {
    // This is the reason quests exist as a dataset. Mine biomes and shop stock
    // were carrying `{type: "quest", key: "breaking_the_fire_seal"}` against
    // nothing.
    const ids = new Set(quests.map((q) => q.id))
    for (const key of [
      'unlocking_the_mines',
      'the_water_tablet',
      'the_earth_tablet',
      'breaking_the_fire_seal',
      'breaking_the_ruins_seal',
      'breaking_the_final_seal',
      'upgrade_the_inn',
      'upgrade_haydens_barn',
      'repair_the_general_store',
    ]) {
      expect(ids).toContain(key)
    }
  })

  it('has unique ids despite repeated names', () => {
    // Three different villagers each want "Request for Berries", so the name
    // alone is not a key. Only the duplicates get the giver appended, so the
    // common case keeps a clean id that a gate can be written against by hand.
    expect(new Set(quests.map((q) => q.id)).size).toBe(quests.length)
    const berries = quests.filter((q) => q.name === 'Request for Berries')
    expect(berries.length).toBeGreaterThan(1)
    for (const quest of berries) expect(quest.id).not.toBe('request_for_berries')
  })

  it('never keeps a quest the wiki has commented out', () => {
    // An unreleased heart quest sits inside an HTML comment, named "?". Read as
    // real it produced a record with an empty id.
    for (const quest of quests) {
      expect(quest.name.length).toBeGreaterThan(2)
      expect(quest.id).toMatch(/^[a-z0-9]+(?:_[a-z0-9]+)*$/)
    }
  })

  it('only records objectives the wiki wrote as structured items', () => {
    // 212 requests name a deliverable as `{{ItemIcon|Heather}} (3)`. The rest
    // describe what to do in a sentence, which is prose we do not copy and
    // could not turn into an objective without inventing one.
    const withObjectives = quests.filter((q) => q.objectives.length > 0)
    expect(withObjectives.length).toBeGreaterThan(150)
    for (const quest of quests) {
      if (quest.objectives.length === 0) expect(quest.data_gaps).toContain('objectives')
      for (const objective of quest.objectives) {
        expect(objective.type).toBe('deliver')
        expect(itemIds).toContain(objective.target_id)
      }
    }
  })

  it('restricts a seasonal request to its season', () => {
    const heather = quests.find((q) => q.name === 'Request for Heather')
    expect(heather?.season_restriction).toEqual(['fall'])
    // A request with no season condition is available all year, and null says
    // so — an empty array would read as "no season works".
    const yearRound = quests.filter((q) => q.season_restriction === null)
    expect(yearRound.length).toBeGreaterThan(0)
  })

  it('covers every kind the page has a section for', () => {
    expect(new Set(quests.map((q) => q.kind))).toEqual(
      new Set([
        'story',
        'festival',
        'important',
        'heart',
        'request',
        'crown',
        'cooking_challenge',
        'mission',
      ]),
    )
  })
})

describe('animals and buildings', () => {
  it('has the eight animals, four to a building', () => {
    expect(animals.map((a) => a.id).sort()).toEqual([
      'alpaca',
      'capybara',
      'chicken',
      'cow',
      'duck',
      'horse',
      'rabbit',
      'sheep',
    ])
    expect(animals.filter((a) => a.building === 'coop')).toHaveLength(4)
    expect(animals.filter((a) => a.building === 'barn')).toHaveLength(4)
  })

  it('matures coop animals faster than barn animals', () => {
    for (const animal of animals) {
      expect(animal.matures_days).toBe(animal.building === 'coop' ? 3 : 5)
      expect(animal.breeding?.gestation_days).toBe(4)
    }
  })

  it('resolves every product, feed and treat to a real item', () => {
    // The whole risk of a hand-authored file is a display name that doesn't
    // exist. Nothing here is allowed to reference one.
    for (const animal of animals) {
      expect(animal.products.length).toBeGreaterThan(0)
      for (const product of animal.products) expect(itemIds).toContain(product.item_id)
      for (const feed of animal.feed_item_ids) expect(itemIds).toContain(feed)
      expect(itemIds).toContain(animal.breeding?.treat_item_id)
      expect(animal.data_gaps).toEqual([])
    }
  })

  it('gates golden products on hearts and marks their quality', () => {
    const cow = animals.find((a) => a.id === 'cow')
    const golden = cow?.products.filter((p) => p.quality === 'golden') ?? []
    expect(golden.map((p) => p.item_id).sort()).toEqual(['golden_bull_horn', 'golden_cow_milk'])
    for (const product of golden) expect(product.hearts_required).toBe(8)
    // The ordinary product has no heart requirement, which is different from
    // requiring zero hearts.
    const plain = cow?.products.find((p) => p.item_id === 'cow_milk')
    expect(plain?.hearts_required).toBeNull()
  })

  it('gives each animal a species-specific breeding treat', () => {
    // The wiki prose says "Heart Shaped Treats"; the item list has ten of them.
    // A player has to buy the right one.
    expect(animals.find((a) => a.id === 'duck')?.breeding?.treat_item_id).toBe(
      'heart_shaped_duck_treat',
    )
    const treats = new Set(animals.map((a) => a.breeding?.treat_item_id))
    expect(treats.size).toBe(animals.length)
  })

  it('costs a barn more than a coop at every tier', () => {
    const coop = buildings.find((b) => b.id === 'coop')
    const barn = buildings.find((b) => b.id === 'barn')
    expect(coop?.tiers).toHaveLength(3)
    expect(barn?.tiers).toHaveLength(3)
    for (const [i, tier] of (coop?.tiers ?? []).entries()) {
      expect(barn?.tiers[i]?.cost.tesserae ?? 0).toBeGreaterThan(tier.cost.tesserae ?? 0)
      expect(barn?.tiers[i]?.capacity).toBe(tier.capacity)
    }
  })

  it('gates the bigger animal buildings on Ranching', () => {
    for (const id of ['coop', 'barn']) {
      const tiers = buildings.find((b) => b.id === id)?.tiers ?? []
      expect(tiers[0]?.requires).toEqual([])
      expect(tiers[1]?.requires).toEqual([{ type: 'skill', key: 'ranching', op: '>=', value: 20 }])
      expect(tiers[2]?.requires[0]?.value).toBe(40)
    }
  })

  it('keeps buildings whose cost table we have not read, flagged', () => {
    // A player looking for the Mill should learn that it exists and that we do
    // not know what it costs — not find nothing and conclude it isn't real.
    const empty = buildings.filter((b) => b.tiers.length === 0)
    expect(empty.map((b) => b.id).sort()).toEqual([
      'crafting_station',
      'farm_expansion',
      'kitchen',
      'mill',
    ])
    for (const building of empty) expect(building.data_gaps).toContain('tiers')
  })

  it('resolves every construction material to a real item', () => {
    for (const building of buildings) {
      for (const tier of building.tiers) {
        for (const material of tier.cost.materials) {
          expect(itemIds).toContain(material.item_id)
          expect(material.quantity).toBeGreaterThan(0)
        }
      }
    }
  })
})

describe('page parsers', () => {
  it('splits a row written with both cell styles', () => {
    const cells = rowCells('|style="width:2%" | icon || [[Coffee]]\n|{{Price|300}}')
    expect(cells.map((c) => c.text)).toEqual(['icon', '[[Coffee]]', '{{Price|300}}'])
  })

  it('carries a rowspanned requirement down the rows it covers', () => {
    const table = [
      '{| class="wikitable"',
      '|-',
      '|[[File:a.png]]||[[Apple Pie]]||rowspan="3"|{{SourceIcon|Story Quest Short|Upgrade The Inn}}||{{Price|100}}',
      '|-',
      '|[[File:b.png]]||[[Berry Pie]]||{{Price|200}}',
      '|-',
      '|[[File:c.png]]||[[Cherry Pie]]||{{Price|300}}',
      '|}',
    ].join('\n')

    const rows = parseStockTable(table, 'Stock', null)
    expect(rows.map((r) => r.item.target)).toEqual(['Apple Pie', 'Berry Pie', 'Cherry Pie'])
    for (const row of rows) {
      expect(row.requires).toEqual(['{{SourceIcon|Story Quest Short|Upgrade The Inn}}'])
    }
    expect(rows.map((r) => r.prices[0]?.amount)).toEqual([100, 200, 300])
  })

  it('substitutes a page variable into the row that uses it', () => {
    const page = '{{#vardefine:copperCost|{{Price|1000}}}}\n|{{#var:copperCost}}'
    expect(expandVariables(page)).toContain('|{{Price|1000}}')
  })

  it('turns requirement tokens into structured gates', () => {
    expect(parseRequirement('{{Skill|Fishing}} Level 8')).toEqual({
      type: 'skill',
      key: 'fishing',
      op: '>=',
      value: 8,
    })
    expect(parseRequirement('{{SkillPerk|Steady Supplies}}')).toEqual({
      type: 'perk',
      key: 'steady_supplies',
      op: 'has',
      value: null,
    })
    expect(parseRequirement('{{SourceIcon|Story Quest Short|Upgrade The Inn}}')).toEqual({
      type: 'quest',
      key: 'upgrade_the_inn',
      op: 'done',
      value: null,
    })
    // "Available from the start" is an absence of requirement, not an unparsed
    // one — the two must not collapse into the same answer.
    expect(parseRequirement('{{SourceIcon|Start}}')).toBeNull()
    expect(parseRequirement('{{SourceIcon|Tackle Shop}}')).toBeUndefined()
  })

  it('reads a perk row written across four lines', () => {
    const body = [
      '{| class="wikitable"',
      '!colspan="4"|<big>Tier 3 (Lvl 30)</big>',
      '|-',
      '|[[File:Silver_seeker.png]]',
      "|'''Silver Seeker'''",
      '|Breaking a Silver Node will occasionally drop an extra piece of Silver.',
      '|{{Price|85|ess}}',
      '|}',
    ].join('\n')

    expect(parseSkillSection('mining', body)).toEqual([
      { skill: 'mining', name: 'Silver Seeker', tier: 3, level: 30, cost: 85 },
    ])
  })

  it('reads the season and day out of a festival row sort value', () => {
    const table = [
      '{| class="wikitable"',
      '|-',
      '|rowspan="2" data-sort-value="3"|{{Season|3}}',
      "|data-sort-value=\"310\"|'''10'''||{{Icon|Calendar_icon_harvest|Harvest Festival|size=30}}",
      '|-',
      "|data-sort-value=\"328\"|'''28'''||{{Spoiler|{{Icon|Calendar_icon_hw|Halloween Festival|size=30}}}}*",
      '|}',
    ].join('\n')

    expect(parseFestivalTable(table, ['spring', 'summer', 'fall', 'winter'])).toEqual([
      {
        season: 'fall',
        day: 10,
        name: 'Harvest Festival',
        page: 'Harvest Festival',
        implemented: true,
        location: null,
        // The {{Icon}} call names the file without an extension; `.png` is
        // appended, and a name that turns out not to exist fails the asset
        // fetch loudly rather than becoming a missing icon nobody notices.
        icon: 'Calendar icon harvest.png',
      },
      {
        season: 'fall',
        day: 28,
        name: 'Halloween Festival',
        page: 'Halloween Festival',
        implemented: false,
        location: null,
        icon: 'Calendar icon hw.png',
      },
    ])
  })
})

describe('request board conditions', () => {
  it('reads the gate out of an expanded condition cell', () => {
    expect(parseConditions('\n*Reached Year 2')).toEqual([{ kind: 'year', value: '2' }])
    expect(parseConditions('\n*Obtained: {{ItemIcon|Worn Pickaxe}}')).toEqual([
      { kind: 'item', value: 'Worn Pickaxe' },
    ])
    expect(parseConditions('\n*Reached {{BiomesQuick|3|icon}}')).toEqual([
      { kind: 'biome', value: '3' },
    ])
    expect(parseConditions('\n*{{Skill|Cooking}} Lv.20')).toEqual([
      { kind: 'skill', value: 'Cooking', level: 20 },
    ])
  })

  it('takes the quest from the last argument of SourceIcon, not the second', () => {
    // `{{SourceIcon|Request|Maple|Common Pheromone}}` is a request *from Maple*
    // for a Common Pheromone. Reading argument two calls the quest "Maple" —
    // the same trap the schedule parser hit, solved the same way.
    expect(questFromSourceIcon('{{SourceIcon|Story Quest Short|Cop Some Ore}}')).toBe(
      'Cop Some Ore',
    )
    expect(questFromSourceIcon('{{SourceIcon|Request|Maple|Common Pheromone}}')).toBe(
      'Common Pheromone',
    )
  })

  it('refuses a Cooking Challenge count as a quest name', () => {
    // Its argument is "complete twelve of them", not a title, and turning "12"
    // into a quest id makes a reference to a quest that cannot exist.
    expect(questFromSourceIcon('{{SourceIcon|Cooking Challenge|12}}')).toBeNull()
  })

  it('skips a value that still carries a display filename', () => {
    // Expansion flattens `{{ItemIcon|Worn Fishing Rod||Worn Fishing Rod.png}}`
    // into one string. Stripping the trailing filename would give "Worn Fishing
    // Rod Worn Fishing" — a different wrong answer that looks more like a right
    // one — so the condition is skipped instead.
    expect(
      parseConditions('\n*Obtained: {{ItemIcon|Worn Fishing Rod Worn Fishing Rod.png}}'),
    ).toEqual([])
  })
})
