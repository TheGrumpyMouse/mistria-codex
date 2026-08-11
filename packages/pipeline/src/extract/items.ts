/**
 * Every item the game declares, read from `fiddle/items/`.
 *
 * This is the point of milestone G1. Each TOML table is keyed by the internal
 * snake_case name — the key hard rule 3 says this dataset must use — and until
 * now those names came from a community snapshot of v0.15.0 for the 999 items
 * it happened to cover, and from `toSnakeId(displayName)` for the rest.
 *
 * **The `description` field is never read.** Every item table has one and it is
 * verbatim in-game writing. What comes out of here is an allowlist, built field
 * by field, so a new game field cannot arrive in the extract by default. That is
 * the control; `writeJson()`'s denylist is the backstop for when it fails.
 *
 * Display names are taken, on the same footing as the AnnaNomoly id table
 * already in `sources/community/`: a name is how the wiki's rows and the game's
 * tables are joined to each other, and the dataset already publishes all of them
 * from the wiki. See docs/DATA-POLICY.md.
 */
import { join } from 'node:path'
import {
  bool,
  defaults,
  entries,
  field,
  num,
  readToml,
  resolveIn,
  str,
  strList,
  type Table,
  table,
  tomlFiles,
} from './toml.js'

export interface GameRecipeComponent {
  item: string
  count: number
}

export interface GameItem {
  /** The game's internal name, and the id everything else keys on. */
  id: string
  /** English display name. Null for the handful of items that declare none. */
  name: string | null
  /** Declaring file, relative to `fiddle/items/`. The game's own categorisation. */
  file: string
  tags: string[]
  /**
   * `value.bin` when it is a literal number.
   *
   * Half the items price themselves with a formula (`self.recipe * 1.1`), which
   * we do not evaluate — an evaluated guess would be indistinguishable from a
   * fact in the shipped data. Those read null and keep whatever the wiki says.
   */
  sell_value: number | null
  buy_value: number | null
  renown_value: number | null
  edible: boolean | null
  /** `tier1`..`tier6` on the six-tier equipment lines. */
  quality: string | null
  stars: number | null
  defense: number | null
  damage: number | null
  tool_type: string | null
  /** The ObjectId this item places, for items that place something. */
  object: string | null
  /**
   * The crop prototype a seed sows, and the tree prototype a sapling plants.
   *
   * Two fields rather than one because the game keeps them apart, and they are
   * the only stated direction of the join: a crop names what it *harvests*, not
   * what sows it, so without these a seed and its crop are matched by hoping
   * their names line up. `sapling_lemon` → `tree_lemon` is the link that lets a
   * fruit tree carry a real `seed_item_id`.
   */
  crop_object: string | null
  sapling: string | null
  recipe_key: string | null
  /**
   * `recipe_is_default` — the recipe is known from the first day.
   *
   * The counterpart to a `recipe_scroll` grant: 206 items say this, and for
   * every one of them the answer to "where do I learn it" is "you already have
   * it". Absent is distinct from false, so this is nullable — an item with no
   * recipe at all says nothing rather than "not default".
   */
  recipe_is_default: boolean | null
  crafting_level: number | null
  kitchen_tier: number | null
  recipe: GameRecipeComponent[]
  /** Crafting duration, where the recipe states one. */
  craft_minutes: number | null
  /** `forever`, or null. The conditional forms are gates, not a soulbind class. */
  soulbind: string | null
  /**
   * The item's own icon sprite name (`spr_ui_item_furniture_basic_chest_v01`).
   * An identifier, not an image — it is what lets the asset step name the
   * exact PNG for art the wiki does not host. See docs/DATA-POLICY.md.
   */
  icon_sprite: string | null
  /**
   * The monster family this pet skin unlocks, on the 14 pet-skin items.
   * Its presence is what gates the drop: `MonsterUtils.gml` hands one out only
   * with the Friend-Shaped perk active, so a monster's pet-skin drop line is
   * perk-gated by *this* marker, not by anything in the monster's own table.
   */
  pet_skin_unlock: string | null
}

export interface GameItemsExtract {
  gameVersion: string
  /** Files read, so a category that vanishes from the game is visible in the diff. */
  files: string[]
  items: GameItem[]
}

/**
 * A recipe is a mixed list: `{count, item}` components, one optional
 * `{hours, minutes}` duration, and an occasional `{essence}` cost. Reading it
 * positionally would silently turn the duration into a component with a
 * `NaN` count, so each entry is dispatched on the keys it actually has.
 */
function readRecipe(value: unknown): {
  components: GameRecipeComponent[]
  minutes: number | null
} {
  const components: GameRecipeComponent[] = []
  let minutes: number | null = null

  if (!Array.isArray(value)) return { components, minutes }

  for (const raw of value) {
    const entry = table(raw)
    if (entry === null) continue

    const item = str(entry.item)
    const count = num(entry.count)
    if (item !== null && count !== null) {
      components.push({ item, count })
      continue
    }

    const hours = num(entry.hours)
    const mins = num(entry.minutes)
    if (hours !== null || mins !== null) minutes = (hours ?? 0) * 60 + (mins ?? 0)
  }

  return { components, minutes }
}

function readItem(id: string, entry: Table, base: Table, file: string): GameItem {
  const get = (key: string): unknown => field(entry, base, key)
  const value = table(get('value')) ?? {}
  const { components, minutes } = readRecipe(get('recipe'))

  return {
    id,
    name: str(get('name')),
    file,
    tags: strList(get('tags')) ?? [],
    sell_value: num(value.bin),
    buy_value: num(value.store),
    renown_value: num(value.renown),
    edible: bool(get('edible')),
    quality: str(get('quality')),
    stars: num(get('stars')),
    defense: num(get('defense')),
    damage: num(get('damage')),
    tool_type: str(get('tool_type')),
    object: str(get('object')),
    crop_object: str(get('crop_object')),
    sapling: str(get('sapling')),
    recipe_key: str(get('recipe_key')),
    recipe_is_default: bool(get('recipe_is_default')),
    crafting_level: num(get('crafting_level_requirement')),
    kitchen_tier: num(get('kitchen_tier_requirement')),
    recipe: components,
    craft_minutes: minutes,
    // Only the string form. The object forms are unlock conditions expressed in
    // the same field, and flattening them to "soulbound" would be a wrong fact.
    soulbind: str(get('soulbind')),
    icon_sprite: str(get('icon_sprite')),
    pet_skin_unlock: str(get('pet_skin_unlock')),
  }
}

export async function extractItems(root: string, gameVersion: string): Promise<GameItemsExtract> {
  const files = await tomlFiles(root, join('fiddle', 'items'))
  if (files.length === 0) {
    throw new Error(
      'fiddle/items/ holds no TOML files. Refusing to write an empty item extract over ' +
        'a good one — check MISTRIA_GAME_DIR points at the unpacked assets folder.',
    )
  }

  const items: GameItem[] = []
  const seen = new Map<string, string>()

  for (const file of files) {
    const doc = await readToml(resolveIn(root, 'fiddle', 'items', file))
    const base = defaults(doc)
    for (const [id, entry] of entries(doc)) {
      const first = seen.get(id)
      if (first !== undefined) {
        // Item ids are the game's ItemId enum members, so a duplicate cannot
        // compile. If one appears here, the reader is wrong, not the game.
        throw new Error(
          `Item "${id}" is declared in both ${first} and ${file}. Item ids are enum ` +
            'members and cannot collide — the extractor is misreading the files.',
        )
      }
      seen.set(id, file)
      items.push(readItem(id, entry, base, file))
    }
  }

  items.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return { gameVersion, files, items }
}
