/**
 * Store stock, from the game's own `stores.toml`.
 *
 * Every store in the game is a section here — the year-round shops the wiki
 * already documents, the festival stalls, and the six Saturday Market vendors
 * the wiki's store pages never cover. A category's stock arrives three ways
 * and all three are kept apart, because they answer "can I buy it today?"
 * differently:
 *
 * - `constant_stock` — always on the shelf.
 * - `random_stock` + `target_selections` — a rotating draw of N from the pool.
 * - `[categories.seasonal]` — one list per season.
 *
 * An entry is a bare item id or a table naming exactly one of `item`,
 * `cosmetic` or a scroll, optionally with `requirements` and `include_recipe`.
 * All three kinds are extracted; what the build consumes is its decision
 * (cosmetics are deferred wholesale, and the extract must not pre-empt that by
 * dropping them).
 *
 * **A scroll has two spellings.** `recipe_scroll` is the cooking one (35 lines)
 * and `crafting_scroll` the furniture one (12); they mean the same thing and
 * appear in the same lists. Reading only the first left the Carpenter's
 * furniture recipes out entirely — see `extract/unlocks.ts`, which reads the
 * same pair everywhere else in the game.
 *
 * **No prices.** The game prices items on the item (`value.store`), not on
 * the stock line — a price here would be invented. The wiki remains the only
 * per-line price source.
 */

import { type GameQuestRequirement, readRequirements } from './quests.js'
import { entries, num, readToml, resolveIn, str, table } from './toml.js'

export interface GameStockEntry {
  /** Exactly one of these three is non-null. */
  item: string | null
  cosmetic: string | null
  /** The recipe this line teaches, from either `recipe_scroll` or `crafting_scroll`. */
  recipe_scroll: string | null
  /** Buying it also teaches the recipe. */
  include_recipe: boolean
  /** `constant`, `random`, or the season of a seasonal table. */
  pool: string
  requirements: GameQuestRequirement[]
  unread_requirement_keys: string[]
}

export interface GameStoreCategory {
  /** How many of the random pool are drawn at once, or null for none. */
  target_selections: number | null
  entries: GameStockEntry[]
}

export interface GameStore {
  /** The section key — `darcy`, `general` — the vendor's own id where one runs it. */
  id: string
  name: string | null
  categories: GameStoreCategory[]
}

export interface GameStoresExtract {
  gameVersion: string
  stores: GameStore[]
}

function readEntry(raw: unknown, pool: string): GameStockEntry | null {
  const bare = str(raw)
  if (bare !== null) {
    return {
      item: bare,
      cosmetic: null,
      recipe_scroll: null,
      include_recipe: false,
      pool,
      requirements: [],
      unread_requirement_keys: [],
    }
  }

  const entry = table(raw)
  if (entry === null) return null
  const item = str(entry.item)
  const cosmetic = str(entry.cosmetic)
  const recipeScroll = str(entry.recipe_scroll) ?? str(entry.crafting_scroll)
  if (item === null && cosmetic === null && recipeScroll === null) return null

  const { requirements, unread } = readRequirements(entry.requirements)
  return {
    item,
    cosmetic,
    recipe_scroll: recipeScroll,
    include_recipe: entry.include_recipe === true,
    pool,
    requirements,
    unread_requirement_keys: unread,
  }
}

export async function extractStores(root: string, gameVersion: string): Promise<GameStoresExtract> {
  const doc = await readToml(resolveIn(root, 'fiddle', 'stores.toml'))

  const stores: GameStore[] = []
  for (const [id, section] of entries(doc)) {
    const rawCategories = Array.isArray(section.categories) ? section.categories : []
    const categories: GameStoreCategory[] = []

    for (const rawCategory of rawCategories) {
      const category = table(rawCategory)
      if (category === null) continue

      const entriesOut: GameStockEntry[] = []
      const readList = (value: unknown, pool: string): void => {
        if (!Array.isArray(value)) return
        for (const raw of value) {
          const entry = readEntry(raw, pool)
          if (entry !== null) entriesOut.push(entry)
        }
      }

      readList(category.constant_stock, 'constant')
      readList(category.random_stock, 'random')
      for (const [season, list] of Object.entries(table(category.seasonal) ?? {}).sort()) {
        readList(list, season)
      }

      if (entriesOut.length === 0) continue
      categories.push({ target_selections: num(category.target_selections), entries: entriesOut })
    }

    if (categories.length === 0) continue
    stores.push({ id, name: str(section.name), categories })
  }

  if (stores.length === 0) throw new Error('stores.toml parsed to zero stores.')
  return { gameVersion, stores: stores.sort((a, b) => (a.id < b.id ? -1 : 1)) }
}
