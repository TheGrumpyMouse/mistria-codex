import type { Item } from '@mistria/schema'
import { consola } from 'consola'
import type { GameItem } from '../../extract/items.js'
import type { BuildContext } from '../context.js'

/**
 * Furniture, from the game files, collapsed to one record per product.
 *
 * The game declares 1,441 furniture items, but a third of them are colourways:
 * fifteen "Basic Wood Chest" entries differ only in palette and share a
 * `recipe_key` — the game's own statement that one recipe covers the group
 * (you pick the colour at the bench). Shipping every colourway would put
 * fifteen identical rows in Browse and double the precached index for no
 * reader benefit, so the group ships as one record:
 *
 * - **Grouped by `(recipe_key ?? id, name)`.** The name is part of the key
 *   because three recipe_keys span two real products (`emerald_bed` is both
 *   the single and the double bed) — key alone would merge them.
 * - **The record id is the `recipe_key`** where a group has more than one
 *   member — it is the game's own stable identifier for the product — and
 *   the game item id otherwise. A collision with any other record id throws.
 * - **Members live in `variant_ids`**, so nothing is lost: shop stock and
 *   recipes resolve any member id to the record that carries it.
 * - **39 groups craft from different ingredients per colour** (each paving
 *   stone wants its own dye). The record carries the base variant's recipe
 *   and `variant_recipes_differ: true`, which the UI turns into words.
 *
 * The subcategory is the declaring file's stem (`basic_chest_set`) — the
 * game's own shelving, and what Browse groups by.
 */

export interface FurnitureCollapse {
  /** Every furniture game item id -> the record id that carries it. */
  shippedIdByGameId: Map<string, string>
  /** Record id -> the canonical member, whose recipe the group ships. */
  canonicalById: Map<string, GameItem>
  /** Record id -> true when members' recipes differ. */
  recipesDifferById: Set<string>
  records: Item[]
}

const EMPTY: FurnitureCollapse = {
  shippedIdByGameId: new Map(),
  canonicalById: new Map(),
  recipesDifferById: new Set(),
  records: [],
}

/**
 * The tiles a piece occupies, keyed off the prototype it places.
 *
 * An item's `object` is the prototype id, and that is where `size` lives — the
 * item table has no footprint of its own. Spread rather than returned so an
 * absent size adds no key at all, which is what keeps `size` optional on the
 * schema rather than a nullable field on 925 records.
 */
function sizeOf(
  sizes: Record<string, [number, number]>,
  item: GameItem,
): { size?: { width: number; height: number } } {
  const stated = item.object === null ? undefined : sizes[item.object]
  if (stated === undefined) return {}
  return { size: { width: stated[0], height: stated[1] } }
}

export function collapseFurniture(ctx: BuildContext): FurnitureCollapse {
  const game = ctx.game
  if (game === null) return EMPTY

  // Group the raw furniture items.
  const groups = new Map<string, GameItem[]>()
  let unnamed = 0
  for (const item of game.itemById.values()) {
    // The declaring directory is the usual signal, but 83 pieces — every wall
    // ribbon, trophy and plushie — are declared under `other/` with a
    // `furniture` tag. Filtering on the path alone is why the Animal
    // Festival's prizes shipped no record at all. The apiary and terrarium
    // carry the tag too and are already records of their own (machines), so
    // their file stays out.
    const tagged =
      item.tags.includes('furniture') && item.file !== 'other/apiaries_and_terrariums.toml'
    if (!item.file.startsWith('furniture/') && !tagged) continue
    if (item.name === null) {
      unnamed += 1
      continue
    }
    // A furniture name the wiki's Items table already carries builds through
    // the wiki path (today: seven recipe-scroll bundles). Two records for one
    // thing is worse than either alone.
    if (ctx.itemByName.has(item.name)) continue

    const key = JSON.stringify([item.recipe_key ?? item.id, item.name])
    groups.set(key, [...(groups.get(key) ?? []), item])
  }
  if (unnamed > 0) consola.info(`furniture: ${unnamed} unnamed game items skipped`)

  // A recipe_key may only become a record id when it identifies exactly one
  // product. `emerald_bed` covers both the single and the double bed, each
  // with its own colourways — those two groups fall back to their canonical
  // member's game id, which is unique by construction.
  const groupsPerKey = new Map<string, number>()
  for (const members of groups.values()) {
    const recipeKey = members[0]?.recipe_key
    if (recipeKey != null) groupsPerKey.set(recipeKey, (groupsPerKey.get(recipeKey) ?? 0) + 1)
  }

  const shippedIdByGameId = new Map<string, string>()
  const canonicalById = new Map<string, GameItem>()
  const recipesDifferById = new Set<string>()
  const records: Item[] = []

  for (const members of groups.values()) {
    members.sort((a, b) => (a.id < b.id ? -1 : 1))
    const canonical = members[0]
    if (canonical === undefined) continue

    const keyIsUnique =
      canonical.recipe_key !== null && groupsPerKey.get(canonical.recipe_key) === 1
    const id =
      members.length > 1 && keyIsUnique && canonical.recipe_key !== null
        ? canonical.recipe_key
        : canonical.id
    if (canonicalById.has(id)) {
      throw new Error(
        `furniture: record id "${id}" produced twice — the (recipe_key, name) grouping ` +
          'no longer identifies a product. Look at the colliding groups before shipping.',
      )
    }

    const recipeOf = (item: GameItem): string => JSON.stringify(item.recipe)
    const differs = members.some((member) => recipeOf(member) !== recipeOf(canonical))
    if (differs) recipesDifferById.add(id)

    for (const member of members) shippedIdByGameId.set(member.id, id)
    canonicalById.set(id, canonical)

    const gaps: string[] = ['obtain_method']
    if (canonical.sell_value === null) gaps.push('sell_value')

    records.push({
      id,
      name: canonical.name ?? id,
      category: 'furniture',
      numeric_id: null,
      numeric_id_game_version: null,
      // The single-member id is the game's own ItemId; a group id is the
      // game's recipe_key — stable, but not an ItemId, so not "confirmed".
      id_status: members.length > 1 ? 'provisional' : 'confirmed',
      former_ids: [],
      also_known_as: [],
      game_version: game.version,
      version_added: null,
      confidence: 'verified',
      prov: { '*': 'game_files' },
      data_gaps: gaps,
      icon_key: `furniture/${id}`,
      wiki_page: null,
      blurb: null,

      // The declaring file's stem — the game's own shelving, and the token
      // Browse groups the category by (labels translate it; it never renders
      // raw). For the tag-matched files this yields `festivals` and `misc`,
      // which the labels map carries like any other stem.
      subcategory: canonical.file.replace(/^(furniture|other)\//, '').replace(/\.toml$/, ''),
      base_item_id: null,
      quality: null,

      sell_value: canonical.sell_value,
      buy_value: canonical.buy_value,
      stamina: null,
      health: null,
      mana: null,

      is_consumable: null,
      is_craftable: canonical.recipe.length > 0 ? true : null,
      is_buyable: canonical.buy_value !== null ? true : null,
      is_giftable: null,

      // Game tag tokens are internal vocabulary; the subcategory carries the
      // one grouping fact the app needs.
      tags: [],
      museum: null,

      availability: [],
      used_in_recipe_ids: [],
      sold_by: [],

      ...(members.length > 1 ? { variant_ids: members.map((m) => m.id) } : {}),
      ...(differs ? { variant_recipes_differ: true as const } : {}),
      // The footprint, from the object prototype the item places. Absent where
      // the prototype states none — the file's `[default]` declares `[2, 2]`
      // and inheriting it would hand a size to every rug and wall hanging on
      // the strength of a fallback nobody has checked applies.
      ...sizeOf(game.objectSizes, canonical),
    })
  }

  records.sort((a, b) => (a.id < b.id ? -1 : 1))
  consola.info(
    `furniture: ${records.length} records from ${shippedIdByGameId.size} game items ` +
      `(${recipesDifferById.size} groups with per-colour recipes)`,
  )
  return { shippedIdByGameId, canonicalById, recipesDifferById, records }
}
