/**
 * Player cosmetics, from `player_assets.toml`.
 *
 * Clothes, hairstyles, accessories — 384 of them, and every Saturday Market
 * clothing stall stocks nothing else, which is why Louis's and Vera's stalls
 * shipped empty until this landed.
 *
 * **A cosmetic is not an `ItemId`.** The game models these as wardrobe
 * entries, not inventory items: a store line says `{ cosmetic = "dress_maid" }`
 * rather than naming an item. So they get their own extract and their own
 * category downstream, and nothing here may be confused with `items.json`.
 *
 * **Colour variants are palette swaps, not entries.** `dress_maid` is one
 * table with one `lut` (a colour lookup sprite); the game recolours it at
 * runtime, and the wiki reports "6 colour variants" as a count. So unlike
 * furniture there is nothing to collapse — 384 tables are 384 products.
 *
 * Prices are mostly *not* here: 26 entries carry a `price_override` and the
 * rest are priced by compiled game code. The wiki's cosmetics tables are the
 * source for those, joined on display name by the builder.
 */
import { bool, entries, num, readToml, resolveIn, str } from './toml.js'

export interface GameCosmetic {
  /** The wardrobe id — `dress_maid`. What a store line names. */
  id: string
  name: string
  /** Where it is worn: `top`, `hair`, `head_gear`, `feet`, `back`… */
  slot: string | null
  /** The wardrobe menu's own grouping — `dress`, `backpacks`, `capes`. */
  sub_category: string | null
  /** True when the player starts with it (character creation), so nothing sells it. */
  default_unlocked: boolean
  /** The few the files price outright. Null means the wiki is the only source. */
  price_override: number | null
}

export interface GameCosmeticsExtract {
  gameVersion: string
  cosmetics: GameCosmetic[]
}

export async function extractCosmetics(
  root: string,
  gameVersion: string,
): Promise<GameCosmeticsExtract> {
  const doc = await readToml(resolveIn(root, 'fiddle', 'player_assets.toml'))

  const cosmetics: GameCosmetic[] = []
  for (const [id, entry] of entries(doc)) {
    const name = str(entry.name)
    // 360 of the file's 384 tables. The 24 skipped all carry `name = ""` —
    // the baby-carrier overlays, one per child and skin tone, worn
    // automatically rather than chosen. The game leaves them unnamed
    // precisely because they never appear in the wardrobe.
    if (name === null) continue
    cosmetics.push({
      id,
      name,
      slot: str(entry.ui_slot),
      sub_category: str(entry.ui_sub_category),
      default_unlocked: bool(entry.default_unlocked) ?? false,
      price_override: num(entry.price_override),
      // `lut`, `torso`, `hide_hair` and friends are rendering details — the
      // sprite pipeline resolves art through our own manifest, and a palette
      // id means nothing to this dataset.
    })
  }

  if (cosmetics.length === 0) {
    throw new Error('player_assets.toml parsed to zero cosmetics.')
  }
  return { gameVersion, cosmetics: cosmetics.sort((a, b) => (a.id < b.id ? -1 : 1)) }
}
