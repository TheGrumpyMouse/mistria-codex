import { type MuseumSet, type MuseumWing, toSnakeId } from '@mistria/schema'
import { type BuildContext, name as itemName, text } from '../context.js'
import { predates1_0 } from '../freshness.js'

/** Maps a wiki set name to the id used everywhere else. */
export const setIdFor = (wing: string, setName: string): string => `${wing}_${toSnakeId(setName)}`

export interface MuseumIndex {
  sets: MuseumSet[]
  /** item id -> { set_id, wing }, for stamping onto item records. */
  byItem: Map<string, { setId: string; wing: MuseumWing }>
  /** Items the wiki marks donatable that no set claims. A curation to-do. */
  unassigned: string[]
}

const WINGS: Record<string, MuseumWing> = {
  archaeology: 'archaeology',
  fish: 'fish',
  flora: 'flora',
  insects: 'insects',
}

/**
 * Build the museum sets, and the item-to-set index.
 *
 * Rosters arrive two different ways and both are handled here:
 *
 * - **From the wing page** (fish, flora, insects) — the items are listed in the
 *   wikitext.
 * - **From Cargo** (archaeology) — the page generates its tables with
 *   `{{ArtifactRows|museumSet=Alda}}`, so the roster is the set of Artifacts
 *   rows carrying that museumSet value.
 *
 * `required_count` is per-set data, never a constant: most sets need five items,
 * the Legendary Fish set needs four. Hardcoding five would make the museum
 * tracker permanently un-completable for anyone who finished it.
 */
export function buildMuseum(ctx: BuildContext): MuseumIndex {
  const sets: MuseumSet[] = []
  const byItem = new Map<string, { setId: string; wing: MuseumWing }>()

  // Group the Cargo tables that carry a museumSet column, for the wings whose
  // pages generate rosters instead of listing them.
  //
  // **Keyed by table AND set name, never by set name alone.** Artifacts and Bugs
  // both have sets called "Upper Mines", "Deep Earth", "Lava Caves" and
  // "Deep Woods" — one per biome, one per wing. Keying on the name alone puts
  // sixteen mine bugs into the archaeology wing and leaves the insect sets with
  // items that belong to nobody.
  const cargoRosters = new Map<string, string[]>()
  const rosterKey = (table: string, setName: string) => `${table}::${setName}`
  const addCargo = (table: string, rows: typeof ctx.artifacts, nameField: string) => {
    for (const row of rows) {
      const setName = text(row.museumSet)
      const itemName = text(row[nameField])
      if (setName === '' || itemName === '') continue
      const key = rosterKey(table, setName)
      const list = cargoRosters.get(key) ?? []
      list.push(itemName)
      cargoRosters.set(key, list)
    }
  }
  addCargo('Artifacts', ctx.artifacts, 'name')
  addCargo('Bugs', ctx.bugs, 'name')
  addCargo('Crops', ctx.crops, 'name')

  const crossCheckByWing = new Map(ctx.museum.wings.map((w) => [w.id, w.crossCheck] as const))

  // The game's own titles for its sets, where it gives one. Its display names
  // are boilerplate — "<Roster> Insect Set", 81 of 82 end in " Set" — and the
  // wiki's shorter names are the readable form of the same thing, so those
  // are kept. A game name *outside* that pattern is a real title the wiki
  // abbreviated away: "Terrarium Treasures", which the wing page files as
  // plain "Terrarium". Exactly one exists at 1.0.0, and the pattern test is
  // what keeps this from renaming the other 81. (Game wing id `insect`,
  // ours `insects` — hence the alias below.)
  const GAME_WINGS: Record<string, string> = {
    archaeology: 'archaeology',
    fish: 'fish',
    flora: 'flora',
    insect: 'insects',
  }
  const gameSetNames = new Map<string, string>()
  for (const gameSet of ctx.game?.museumSets ?? []) {
    const wing = GAME_WINGS[gameSet.wing]
    if (wing === undefined || gameSet.name === null || / Set$/.test(gameSet.name)) continue
    gameSetNames.set(`${wing}_${gameSet.set}`, gameSet.name)
  }

  for (const [order, extracted] of ctx.museum.sets.entries()) {
    const wing = WINGS[extracted.wing]
    if (wing === undefined) continue

    const crossCheck = crossCheckByWing.get(extracted.wing) ?? null
    const itemNames =
      extracted.rosterSource === 'cargo'
        ? crossCheck === null
          ? []
          : (cargoRosters.get(rosterKey(crossCheck, extracted.set)) ?? [])
        : extracted.items

    const itemIds: string[] = []
    for (const name of itemNames) {
      const id = ctx.idFor(name)
      // Only claim items that actually exist, or the set points at nothing.
      if (!ctx.itemByName.has(name)) continue
      if (!itemIds.includes(id)) itemIds.push(id)
    }

    const setId = setIdFor(extracted.wing, extracted.set)
    const gaps: string[] = []
    if (itemIds.length === 0) gaps.push('item_ids')
    if (itemIds.length !== itemNames.length) gaps.push('unmatched_items')

    // The game reached 1.0 on 2026-08-05. A wing page not edited since then may
    // predate 1.0's museum changes, and the player deserves to be told rather
    // than shown a stale roster with full confidence.
    if (predates1_0(ctx.museum.lastEdited[extracted.wing] ?? null)) gaps.push('predates_1_0')

    for (const id of itemIds) {
      // An item in two sets is a real modelling error, not something to merge
      // quietly — the tracker would double-count it. The validator asserts this
      // separately so it fails loudly rather than being resolved here.
      if (!byItem.has(id)) byItem.set(id, { setId, wing })
    }

    sets.push({
      id: setId,
      name: gameSetNames.get(setId) ?? extracted.set,
      numeric_id: null,
      numeric_id_game_version: null,
      id_status: 'confirmed',
      former_ids: [],
      also_known_as: [],
      // The wiki's own version banner on the wing page. Three of the four are
      // pre-1.0 (fish v0.14.0, flora and archaeology v0.15), so the app can say
      // "this set list predates 1.0" instead of implying currency.
      game_version: ctx.museum.wikiVersionStamp[extracted.wing] ?? null,
      version_added: null,
      confidence: 'wiki',
      prov: { '*': 'wiki_page' },
      data_gaps: gaps,
      icon_key: `museum/${wing}`,
      wiki_page: `${extracted.wing === 'fish' ? 'Fish' : extracted.wing}_Wing`,
      blurb: null,

      wing,
      item_ids: itemIds,
      // Per-set, from the roster itself. The Legendary Fish set has four.
      required_count: Math.max(itemIds.length, 1),
      reward: null,
      unlock_requires: [],
      display_order: order,
    })
  }

  const unassigned: string[] = []
  for (const row of ctx.items) {
    if (row.museum !== 1) continue
    const id = ctx.idFor(itemName(row.itemName))
    if (!byItem.has(id)) unassigned.push(id)
  }

  return { sets, byItem, unassigned: unassigned.sort() }
}
