/**
 * The guide's gate and its rendering.
 *
 * Two things are worth testing here and they are not the same thing:
 *
 * 1. **The gate excludes what it claims to.** A spoiler reaching a public URL
 *    is the one failure with a cost outside the repository, and the gate that
 *    prevents it is four lines that a refactor could plausibly drop.
 * 2. **The guards can actually fail.** `pnpm validate` reporting nothing is
 *    only reassuring if the checks are capable of reporting something, so each
 *    one is tripped deliberately below.
 */
import { describe, expect, it } from 'vitest'
import { seoFindings } from '../../validate/seo.js'
import {
  buildPages,
  type CharacterRecord,
  type Dataset,
  hasSubstance,
  type ItemRecord,
  slugFor,
} from './pages.js'
import { escapeHtml, renderPage } from './render.js'

const CTX = { siteUrl: 'https://example.invalid/base/', ogImage: null }

/** `noUncheckedIndexedAccess` is on, and a test that reads `pages[0]` should say so. */
function only<T>(items: T[]): T {
  const first = items[0]
  if (first === undefined) throw new Error(`expected at least one, got ${items.length}`)
  return first
}

const item = (over: Partial<ItemRecord> & { id: string; name: string }): ItemRecord => ({
  category: 'fish',
  subcategory: null,
  sell_value: 10,
  buy_value: null,
  availability: [],
  used_in_recipe_ids: [],
  museum: null,
  is_craftable: false,
  tags: [],
  wiki_page: null,
  former_ids: [],
  data_gaps: [],
  ...over,
})

const dataset = (over: Partial<Dataset> = {}): Dataset => ({
  items: [],
  characters: [],
  monsters: [],
  animals: [],
  places: [],
  mines: [],
  quests: [],
  recipes: [],
  shops: [],
  festivals: [],
  ...over,
})

describe('slugFor', () => {
  it('is the id with underscores swapped for hyphens', () => {
    expect(slugFor('ore_copper')).toBe('ore-copper')
    expect(slugFor('the_tide_caverns')).toBe('the-tide-caverns')
  })

  it('leaves an id that needs nothing alone', () => {
    expect(slugFor('egg')).toBe('egg')
  })
})

describe('hasSubstance', () => {
  it('accepts a record with any one of the four facts', () => {
    expect(hasSubstance(item({ id: 'a', name: 'A', sell_value: 5 }))).toBe(true)
    expect(
      hasSubstance(item({ id: 'b', name: 'B', sell_value: null, used_in_recipe_ids: ['x'] })),
    ).toBe(true)
    expect(
      hasSubstance(
        item({
          id: 'c',
          name: 'C',
          sell_value: null,
          museum: { donatable: true, wing: 'fish', set_id: null },
        }),
      ),
    ).toBe(true)
  })

  it('rejects a record that is only a name', () => {
    // The ~139 animal-cosmetic `misc` rows look exactly like this.
    expect(hasSubstance(item({ id: 'alpaca_beret', name: 'Alpaca Beret', sell_value: null }))).toBe(
      false,
    )
  })
})

describe('the publication gate', () => {
  it('drops spoilers, unreleased records, excluded categories and thin rows', () => {
    const { pages, skipped } = buildPages(
      dataset({
        items: [
          item({ id: 'keep', name: 'Keep' }),
          item({ id: 'secret', name: 'Secret', spoiler: true }),
          item({ id: 'soon', name: 'Soon', unreleased: true }),
          item({ id: 'chest', name: 'Basic Wood Chest', category: 'furniture' }),
          item({ id: 'beret', name: 'Beret', category: 'misc', sell_value: null }),
        ],
      }),
      CTX,
    )

    expect(pages.map((p) => p.source.id)).toEqual(['keep'])
    expect(skipped).toEqual({ excludedCategory: 1, thin: 1, spoiler: 1, unreleased: 1 })
  })

  it('withholds a spoiler mine from its location page, which is not itself veiled', () => {
    // `curated/vocab/spoilers.json` veils `mines: ["ancient_ruins"]` and not
    // the location it sits in, so the location page must still exist — with
    // none of the mine's contents on it. The subtlety is that `mineByLocation`
    // is built from the *gated* mine list; building it from the raw one would
    // publish the floor range, the ore table and the monster roster of a
    // record the app deliberately hides, and every page would still render.
    const { pages } = buildPages(
      dataset({
        places: [
          {
            id: 'the_ancient_ruins',
            name: 'The Ancient Ruins',
            kind: 'mine',
            parent_id: null,
            habitats: [],
          },
        ],
        mines: [
          {
            id: 'ancient_ruins',
            name: 'The Ancient Ruins',
            spoiler: true,
            location_id: 'the_ancient_ruins',
            floors: { min: 81, max: 99 },
            monster_ids: ['a_late_game_horror'],
            ore_item_ids: ['ore_secret'],
            fish_item_ids: [],
          },
        ],
      }),
      CTX,
    )

    expect(pages).toHaveLength(1)
    const html = renderPage(only(pages).input)
    expect(only(pages).input.kind).toBe('Location')
    expect(html).not.toMatch(/floors \d/)
    expect(html).not.toContain('Ore found here')
    expect(html).not.toContain('a_late_game_horror')
  })

  it('never lets a spoiler character through', () => {
    const person = (id: string, over: Partial<CharacterRecord> = {}): CharacterRecord => ({
      id,
      name: id,
      birthday: null,
      occupation: null,
      affiliation: null,
      romanceable: null,
      is_vendor: false,
      family: [],
      ...over,
    })

    const { pages } = buildPages(
      dataset({ characters: [person('adeline'), person('mystery', { spoiler: true })] }),
      CTX,
    )
    expect(pages.map((p) => p.source.id)).toEqual(['adeline'])
  })
})

describe('a recipe is two blocks on the item’s page, not a page of its own', () => {
  const built = buildPages(
    dataset({
      items: [item({ id: 'lemon_pie', name: 'Lemon Pie', category: 'cooked', sell_value: 650 })],
      shops: [{ id: 'inn', name: 'Sleeping Dragon Inn' }],
      recipes: [
        {
          id: 'lemon_pie',
          name: 'Lemon Pie',
          kind: 'cooking',
          output: { item_id: 'lemon_pie', quantity: 1 },
          ingredients: [{ item_id: 'lemon', tag: null, quantity: 2 }],
          station: 'Food',
          station_level: 2,
          skill: { id: 'cooking', level: 20 },
          craft_minutes: 100,
          sources: [
            {
              method: 'shop',
              source_id: 'inn',
              character_id: null,
              price: 400,
              currency: 'tesserae',
              confidence: 'verified',
            },
          ],
        },
      ],
    }),
    CTX,
  )
  const html = renderPage(only(built.pages).input)

  it('publishes exactly one page for the dish and its recipe', () => {
    // The recipe's id *is* the item's id, so a page of its own would be a
    // second URL about one subject — the duplicate-content pattern the whole
    // inclusion gate exists to avoid.
    expect(built.pages).toHaveLength(1)
    expect(only(built.pages).segments).toEqual(['guide', 'cooked', 'lemon-pie'])
  })

  it('separates how it is made from where the recipe is learned', () => {
    expect(html).toContain('How it’s made')
    expect(html).toContain('Where to learn the recipe')
    expect(html).toContain('Sold at Sleeping Dragon Inn for 400 tesserae')
  })

  it('states the crafting level, which no page had ever shown', () => {
    expect(html).toContain('Cooking level 20')
  })

  it('does not claim to be a schema.org Recipe', () => {
    // That type is for food a person can cook. Marking up a game dish with it
    // would publish structured data asserting something untrue about the page.
    const block = /<script type="application\/ld\+json">(.*?)<\/script>/s.exec(html)?.[1] ?? ''
    expect(block).not.toContain('"Recipe"')
    expect(JSON.parse(block)).toBeTruthy()
  })

  it('hedges the inferred source in words, since the guide has no styling', () => {
    const inferred = buildPages(
      dataset({
        items: [item({ id: 'oak_chair', name: 'Oak Chair', category: 'misc', sell_value: 40 })],
        recipes: [
          {
            id: 'oak_chair',
            name: 'Oak Chair',
            kind: 'woodcrafting',
            output: { item_id: 'oak_chair', quantity: 1 },
            ingredients: [],
            station: null,
            station_level: null,
            skill: { id: 'woodcrafting', level: 4 },
            craft_minutes: null,
            sources: [
              {
                method: 'skill_level',
                source_id: null,
                character_id: null,
                price: null,
                currency: 'tesserae',
                confidence: 'inferred',
              },
            ],
          },
        ],
      }),
      CTX,
    )
    expect(renderPage(only(inferred.pages).input)).toContain('inferred')
  })
})

describe('renderPage', () => {
  const page = only(
    buildPages(
      dataset({
        items: [
          item({
            id: 'cave_eel',
            name: 'Cave Eel',
            sell_value: 50,
            wiki_page: 'Cave_Eel',
            data_gaps: ['weather'],
          }),
        ],
      }),
      CTX,
    ).pages,
  )

  const html = renderPage(page.input)

  it('puts the canonical at an absolute URL', () => {
    expect(html).toContain(
      '<link rel="canonical" href="https://example.invalid/base/guide/fish/cave-eel/">',
    )
  })

  it('carries no script but the structured data', () => {
    // The entire premise is that a crawler which never runs JavaScript reads
    // the whole page. A stray <script> would not break that, but it would mean
    // something on the page had started depending on the runtime.
    const scripts = [...html.matchAll(/<script([^>]*)>/g)].map((m) => m[1])
    expect(scripts).toEqual([' type="application/ld+json"'])
  })

  it('emits JSON-LD that parses, with only absolute URLs', () => {
    const block = /<script type="application\/ld\+json">(.*?)<\/script>/s.exec(html)?.[1] ?? ''
    const parsed = JSON.parse(block) as { '@graph': Record<string, unknown>[] }
    const node = parsed['@graph'][0] as Record<string, string>
    expect(node['@id']).toBe('https://example.invalid/base/guide/fish/cave-eel/')
    // The bug this catches: JSON-LD built from the page's *relative* hrefs, so
    // `isPartOf.url` reads `../../../` and parsers discard the node.
    for (const url of JSON.stringify(parsed).matchAll(/"(?:url|item|@id)":"([^"]+)"/g)) {
      expect(url[1]).toMatch(/^https:\/\//)
    }
  })

  it('states the gaps rather than staying silent about them', () => {
    // Silence reads as "there is no weather constraint", which is a claim.
    expect(html).toContain('No source has been read for: weather.')
  })

  it('credits the wiki article the facts came from', () => {
    expect(html).toContain('https://fieldsofmistria.wiki.gg/wiki/Cave_Eel')
    expect(html).toContain('CC BY-SA 4.0')
  })

  it('links back into the app', () => {
    expect(html).toContain('href="../../../#/item/cave_eel"')
  })
})

describe('escapeHtml', () => {
  it('escapes the ampersand first, or the escapes escape each other', () => {
    expect(escapeHtml('a & <b>')).toBe('a &amp; &lt;b&gt;')
  })

  it('handles a real name with an apostrophe', () => {
    expect(escapeHtml("Beekeeper's Hat")).toBe('Beekeeper&#39;s Hat')
  })
})

describe('the validate guards can fail', () => {
  it('reports a slug collision', () => {
    // Two ids differing only by a character that slugifies away. Nothing in the
    // real data does this today, which is exactly why it needs a test.
    const findings = seoFindings(
      dataset({
        items: [item({ id: 'ore_copper', name: 'A' }), item({ id: 'ore-copper', name: 'B' })],
      }),
    )
    expect(findings.map((f) => f.check)).toContain('seo:slug-collision')
  })

  it('is quiet when nothing collides', () => {
    const findings = seoFindings(
      dataset({
        items: [item({ id: 'ore_copper', name: 'A' }), item({ id: 'ore_tin', name: 'B' })],
      }),
    )
    expect(findings).toEqual([])
  })
})
