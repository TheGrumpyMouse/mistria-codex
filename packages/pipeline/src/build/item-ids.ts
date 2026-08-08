/**
 * The item id index: the game's real internal names where we have them.
 *
 * Hard rule 3 says the internal snake_case name is the key, always. Until the
 * game files land, an id has been `toSnakeId(displayName)` — a guess. This
 * index replaces the guess wherever a datamining snapshot of v0.15.0 names one,
 * and **192 of 999 matched items turn out to have had the wrong id**: Copper
 * Ore is `ore_copper`, a Chicken Egg is `egg`, a Cave Mushroom is
 * `wild_mushroom`.
 *
 * Nothing about that divergence is detectable from the wiki. It is the error
 * class the plan flagged as the project's highest risk, because the ids are
 * what user progress is keyed by: adopting them after release orphans
 * somebody's museum tracker, and adopting them now costs nothing.
 *
 * Every id that changes keeps its old value in `former_ids`, which is what
 * makes the eventual game-file pass a migration rather than a data loss.
 */
import type { ItemNamesExtract } from '../enrich/item-names.js'

export interface ItemIdIndex {
  /** Display name -> the game's internal name, where it is unambiguous. */
  internalByDisplay: Map<string, string>
  /** Display name -> numeric id. Provenance only; nothing may reference it. */
  numericByDisplay: Map<string, number>
  /**
   * Display names the snapshot uses more than once. Useless for matching — the
   * wiki and the snapshot share no other column — so they keep a slug, and the
   * ambiguity is reported rather than resolved by picking one.
   */
  ambiguous: string[]
  gameVersion: string
}

export const EMPTY_ITEM_ID_INDEX: ItemIdIndex = {
  internalByDisplay: new Map(),
  numericByDisplay: new Map(),
  ambiguous: [],
  gameVersion: 'unknown',
}

export function buildItemIdIndex(extract: ItemNamesExtract): ItemIdIndex {
  const internalByDisplay = new Map<string, string>()
  const numericByDisplay = new Map<string, number>()
  const ambiguous = new Set<string>()

  for (const row of extract.names) {
    // A row the mod marks DISABLED or GLITCHED is content the player can never
    // hold. Taking its name would be naming one of our items after a crash.
    if (row.displayName === null || row.markers.length > 0) continue

    if (internalByDisplay.has(row.displayName)) {
      ambiguous.add(row.displayName)
      continue
    }
    internalByDisplay.set(row.displayName, row.internalName)
    numericByDisplay.set(row.displayName, row.numericId)
  }

  for (const name of ambiguous) {
    internalByDisplay.delete(name)
    numericByDisplay.delete(name)
  }

  return {
    internalByDisplay,
    numericByDisplay,
    ambiguous: [...ambiguous].sort(),
    gameVersion: extract.gameVersion,
  }
}

export interface Divergence {
  displayName: string
  /** What `toSnakeId` produced, and what the id used to be. */
  slug: string
  /** What the game actually calls it. */
  internalName: string
}

/** Every item whose naive slug is not what the game calls it. */
export function divergences(
  index: ItemIdIndex,
  displayNames: string[],
  slugOf: (displayName: string) => string,
): Divergence[] {
  const found: Divergence[] = []
  for (const displayName of displayNames) {
    const internalName = index.internalByDisplay.get(displayName)
    if (internalName === undefined) continue
    const slug = slugOf(displayName)
    if (slug !== internalName) found.push({ displayName, slug, internalName })
  }
  return found.sort((a, b) => a.displayName.localeCompare(b.displayName))
}
