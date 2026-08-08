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
import type { IdStatus } from '@mistria/schema'
import type { ItemNamesExtract } from '../enrich/item-names.js'
import type { GameFacts } from './game-facts.js'

export interface ItemIdIndex {
  /** Display name -> the game's internal name, where it is unambiguous. */
  internalByDisplay: Map<string, string>
  /**
   * Which source settled each name — the game's own files, or the v0.15.0
   * snapshot. Absent means neither, and the id is still a slug.
   */
  statusByDisplay: Map<string, Exclude<IdStatus, 'provisional'>>
  /** Display name -> numeric id. Provenance only; nothing may reference it. */
  numericByDisplay: Map<string, number>
  /**
   * Every internal name the game declares.
   *
   * This confirms an id we already hold when the display names differ: the wiki
   * writes "Bluegill", the game writes "Blue Gill", and both mean the table the
   * game calls `bluegill`. The id does not change — only our confidence in it.
   */
  gameIds: Set<string>
  /**
   * Display names the snapshot uses more than once. Useless for matching — the
   * wiki and the snapshot share no other column — so they keep a slug, and the
   * ambiguity is reported rather than resolved by picking one.
   */
  ambiguous: string[]
  /** The v0.15.0 snapshot the numeric ids were read at. */
  gameVersion: string
  /** The build the confirmed names were read at, or null with no extract. */
  confirmedAt: string | null
}

export const EMPTY_ITEM_ID_INDEX: ItemIdIndex = {
  internalByDisplay: new Map(),
  statusByDisplay: new Map(),
  numericByDisplay: new Map(),
  gameIds: new Set(),
  ambiguous: [],
  gameVersion: 'unknown',
  confirmedAt: null,
}

/**
 * Build the id index, preferring the game's own names over the archive's.
 *
 * The two agree everywhere they overlap — all 999 of them, which is the useful
 * result of running this for the first time. The game still wins on principle:
 * v0.15.0 predates 1.0, so a name it settles is `confirmed_stale`, and only a
 * name read from the installed build is `confirmed`.
 */
export function buildItemIdIndex(extract: ItemNamesExtract, game?: GameFacts | null): ItemIdIndex {
  const internalByDisplay = new Map<string, string>()
  const statusByDisplay = new Map<string, Exclude<IdStatus, 'provisional'>>()
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
    statusByDisplay.set(row.displayName, 'confirmed_stale')
    numericByDisplay.set(row.displayName, row.numericId)
  }

  for (const name of ambiguous) {
    internalByDisplay.delete(name)
    statusByDisplay.delete(name)
    numericByDisplay.delete(name)
  }

  // The numeric ids stay at v0.15.0 even once the names are confirmed: they are
  // enum ordinals assigned at compile time, the game files do not publish them,
  // and re-deriving them from declaration order would be a guess wearing a
  // number. Hard rule 3 is why nothing references one.
  for (const [displayName, id] of game?.idByDisplay ?? []) {
    internalByDisplay.set(displayName, id)
    statusByDisplay.set(displayName, 'confirmed')
  }

  return {
    internalByDisplay,
    statusByDisplay,
    numericByDisplay,
    gameIds: game?.itemIds ?? new Set(),
    ambiguous: [...ambiguous].sort(),
    gameVersion: extract.gameVersion,
    confirmedAt: game?.version ?? null,
  }
}

/**
 * How sure we are of an id, given the display name it was resolved from.
 *
 * The fallback matters: where the game and the wiki spell a name differently,
 * the display-name join finds nothing but the id we already hold *is* one the
 * game declares. That confirms the id without changing it.
 */
export function idStatusFor(index: ItemIdIndex, displayName: string, id: string): IdStatus {
  const direct = index.statusByDisplay.get(displayName)
  if (direct !== undefined) return direct
  return index.gameIds.has(id) ? 'confirmed' : 'provisional'
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
