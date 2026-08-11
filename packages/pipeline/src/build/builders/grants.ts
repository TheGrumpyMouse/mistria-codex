import type { AvailabilityWindow, Quest, RecipeSource, Requirement, Season } from '@mistria/schema'
import { SEASONS } from '@mistria/schema'
import { consola } from 'consola'
import type { BuildContext } from '../context.js'
import { wordKey } from '../game-facts.js'

/**
 * `sources/game/unlocks.json`, resolved against the records this build ships.
 *
 * Two products from one pass, because the game states them in one place: how a
 * **recipe** is learned, and how an **item** is obtained. A letter's `items`
 * array holds both; so does a museum reward tier and a quest's `rewards`.
 *
 * Three things make this harder than a lookup, and each is a bug that was
 * already sitting in the data:
 *
 * **A grant names a colour variant, not a record.** 419 recipe grants and most
 * furniture item grants point at `explorer_bed_beige`, which the furniture
 * collapse folded into a group. Every key goes through `shipsAs` before it is
 * used; a plain `Map.get` matches almost none of them.
 *
 * **A quest key is not our quest id.** Ours are wiki-derived: only 96 of the
 * game's 226 fetch quests match by id. The rest join by folded name, and six
 * requests share a name with another request — disambiguated by the icon NPC
 * against the quest's giver. Two Eiland strawberry requests are genuinely
 * indistinguishable and ship without a `source_id`, which is counted rather
 * than hidden.
 *
 * **A store's own price is not the scroll's price.** Nothing here reads
 * `value.store` — that prices the dish. A scroll's price comes from the wiki
 * line that states one, or stays null.
 */

/** Where the record for a game key lives this build, or null if it ships nothing. */
export type ShipsAs = (gameKey: string) => string | null

export interface GrantIndex {
  /** Shipped recipe id -> every stated way of learning it. */
  recipeSources: Map<string, RecipeSource[]>
  /** Shipped item id -> every stated way of obtaining it, as availability windows. */
  itemWindows: Map<string, AvailabilityWindow[]>
  /**
   * Resolved quest id -> the shipped item ids its grants hand over. The same
   * facts as the `quest_reward` windows above, indexed the other way so a
   * quest record can state its own rewards — built here because this loop is
   * the one place the game-key → quest join exists.
   */
  itemsByQuest: Map<string, string[]>
}

/** Names differ in case, punctuation and curly apostrophes. Fold before joining. */
export const foldName = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[^a-z0-9]/g, '')

/**
 * The same fold, minus a leading article.
 *
 * Only for the mine biomes, where the game is inconsistent with itself: three
 * of the five are `Upper Mines`, `Deep Earth`, `Ancient Ruins` and the other
 * two are `The Tide Caverns`, `The Lava Caves`. We write "The" on all five, so
 * a plain fold joins two of them and silently drops the rest — the recipes and
 * furniture from three whole biomes, with no error anywhere.
 *
 * Deliberately *not* folded into `foldName`: an article can be load-bearing in
 * a quest title, and stripping it everywhere would trade this bug for a
 * quieter one.
 */
export const foldPlaceName = (name: string): string => foldName(name.replace(/^the\s+/i, ''))

const ALL_SEASONS: Season[] = [...SEASONS]

/**
 * A window for something obtained by being handed it rather than by being
 * somewhere at a time.
 *
 * Seasons are the full four because none of these is seasonal — the post, a
 * museum tier and a treasure chest do not care what month it is, and the
 * festival stalls are pinned by their festival rather than by a season the
 * window could state. Weather is `not_applicable` for the same reason it is on
 * a mine: there is no weather in the answer, which is a different fact from not
 * knowing it.
 */
function grantWindow(
  method: AvailabilityWindow['method'],
  over: Partial<AvailabilityWindow> = {},
): AvailabilityWindow {
  return {
    method,
    habitats: [],
    locations: [],
    spot_ids: [],
    seasons: ALL_SEASONS,
    weather: null,
    weather_precision: 'not_applicable',
    time: null,
    time_blocks: null,
    time_precision: 'not_applicable',
    days: null,
    dates: null,
    depth: null,
    biome_id: null,
    min_year: null,
    rarity: null,
    chance: null,
    quantity: null,
    requires: [],
    confidence: 'verified',
    prov: 'game_files',
    ...over,
  }
}

/**
 * The game's letter requirements, as our gates.
 *
 * `shipped_item` and `donated_item` exist as requirement types precisely for
 * this: the post office is the game's milestone reward system, and "you have
 * shipped a potato" is not "you are holding a potato". A key nobody models is
 * dropped from the gate list and counted by the caller — a gate we cannot state
 * is better absent than approximated.
 */
function letterGate(key: string, value: string | number | boolean): Requirement | null {
  if (key === 'shipped_item' && typeof value === 'string') {
    return { type: 'shipped_item', key: value, op: 'has', value: null }
  }
  if (key === 'donated_item' && typeof value === 'string') {
    return { type: 'donated_item', key: value, op: 'has', value: null }
  }
  return null
}

export interface GrantTargets {
  quests: Quest[]
  /**
   * Folded biome name (see `foldPlaceName`) -> the mine record and its place.
   *
   * Both halves are needed and they are different fields: `biome_id` takes the
   * mine record, `locations` takes the location. A window that puts the mine id
   * in `locations` fails refint, because a biome is not a place on the map —
   * the same distinction `withAnchors` draws when it refuses a mine an anchor.
   */
  mineIdByBiome: Map<string, { id: string; locationId: string | null }>
  /** `stores.toml` section key -> our shop id. */
  shopIdByStore: Map<string, string>
  /** Our festival ids, for resolving the game's shorter section keys. */
  festivalIds: Set<string>
}

export function buildGrantIndex(
  ctx: BuildContext,
  shipsAs: ShipsAs,
  targets: GrantTargets,
): GrantIndex {
  const { quests, mineIdByBiome, shopIdByStore, festivalIds } = targets
  const recipeSources = new Map<string, RecipeSource[]>()
  const itemWindows = new Map<string, AvailabilityWindow[]>()
  const itemsByQuest = new Map<string, string[]>()
  const game = ctx.game
  const unlocks = game?.unlocks ?? null

  const addRecipe = (key: string | null, source: RecipeSource): void => {
    if (key === null) return
    const id = shipsAs(key)
    if (id === null) return
    const list = recipeSources.get(id) ?? []
    // A pool that lists the same scroll twice is one way of getting it — but
    // two different stalls at one festival are genuinely two sources.
    if (
      !list.some(
        (s) =>
          s.method === source.method &&
          s.source_id === source.source_id &&
          s.stall_key === source.stall_key,
      )
    ) {
      list.push(source)
    }
    recipeSources.set(id, list)
  }

  const addItem = (key: string | null, window: AvailabilityWindow): void => {
    if (key === null) return
    const id = shipsAs(key)
    if (id === null) return
    const list = itemWindows.get(id) ?? []
    const same = (a: AvailabilityWindow, b: AvailabilityWindow): boolean =>
      a.method === b.method && a.locations.join() === b.locations.join()
    if (!list.some((w) => same(w, window))) list.push(window)
    itemWindows.set(id, list)
  }

  /**
   * What a grant hands over, as a record key: the item id it names, or the
   * accessory its `(animal, animal_cosmetic)` pair resolves to through the
   * accessory's own display name. Reading only `item` was why the Chicken
   * Statue's accessory rolls granted nothing anyone could see.
   */
  // Wiki names by word set, unambiguous only — the game says "Alpaca Blue
  // Ribbon" where the wiki says "Blue Alpaca Ribbon", the exact word-order
  // trap CLAUDE.md documents. A key two names share resolves to neither.
  const wikiNameByWordKey = new Map<string, string | null>()
  for (const name of ctx.itemByName.keys()) {
    const key = wordKey(name)
    wikiNameByWordKey.set(key, wikiNameByWordKey.has(key) ? null : name)
  }
  const resolveByName = (name: string): string | null => {
    if (ctx.itemByName.has(name)) return ctx.idFor(name)
    const folded = wikiNameByWordKey.get(wordKey(name)) ?? null
    return folded !== null ? ctx.idFor(folded) : null
  }

  const grantKey = (grant: {
    item: string | null
    animal: string | null
    animal_cosmetic: string | null
    cosmetic: string | null
  }): string | null => {
    if (grant.item !== null) return grant.item
    // A wardrobe key is the id its record ships under — no resolution to get wrong.
    if (grant.cosmetic !== null) return grant.cosmetic
    if (grant.animal === null || grant.animal_cosmetic === null) return null
    const name =
      game?.animalCosmeticNameByPair.get(`${grant.animal}|${grant.animal_cosmetic}`) ?? null
    return name === null ? null : resolveByName(name)
  }

  if (unlocks === null) return { recipeSources, itemWindows, itemsByQuest }

  // ── The post ──────────────────────────────────────────────────────────────
  let unreadLetterGates = 0
  for (const letter of unlocks.letters) {
    const requires: Requirement[] = []
    for (const requirement of letter.requirements) {
      const gate = letterGate(requirement.key, requirement.value)
      if (gate === null) unreadLetterGates += 1
      else requires.push(gate)
    }
    addRecipe(letter.recipe, {
      method: 'mail',
      source_id: null,
      stall_key: null,
      character_id: letter.npc,
      price: null,
      currency: 'tesserae',
      requires,
      confidence: 'verified',
    })
    addItem(grantKey(letter), grantWindow('mail', { requires }))
  }

  // ── Quest rewards ─────────────────────────────────────────────────────────
  const questById = new Map(quests.map((q) => [q.id, q] as const))
  const questsByName = new Map<string, Quest[]>()
  for (const quest of quests) {
    const key = foldName(quest.name)
    questsByName.set(key, [...(questsByName.get(key) ?? []), quest])
  }

  /** Our quest id for a game quest key, or null when the join is genuinely ambiguous. */
  const resolveQuest = (key: string, name: string | null, npc: string | null): string | null => {
    if (questById.has(key)) return key
    if (name === null) return null
    const byName = questsByName.get(foldName(name)) ?? []
    if (byName.length === 1) return byName[0]?.id ?? null
    const byNpc = byName.filter((q) => q.giver_character_id === npc)
    return byNpc.length === 1 ? (byNpc[0]?.id ?? null) : null
  }

  let unresolvedQuests = 0
  for (const grant of unlocks.quests) {
    const questId = resolveQuest(grant.quest, grant.quest_name, grant.npc)
    if (questId === null && (grant.recipe !== null || grant.item !== null)) unresolvedQuests += 1
    addRecipe(grant.recipe, {
      method: 'quest',
      source_id: questId,
      stall_key: null,
      character_id: grant.npc,
      price: null,
      currency: 'tesserae',
      requires: [],
      confidence: 'verified',
    })
    addItem(
      grant.item,
      grantWindow('quest_reward', {
        requires:
          questId === null ? [] : [{ type: 'quest', key: questId, op: 'done', value: null }],
      }),
    )
    // The reverse product: the quest knows what it hands over. Only where both
    // halves of the join resolved — an unresolved half is already counted.
    if (questId !== null && grant.item !== null) {
      const itemId = shipsAs(grant.item)
      if (itemId !== null) {
        const list = itemsByQuest.get(questId) ?? []
        if (!list.includes(itemId)) list.push(itemId)
        itemsByQuest.set(questId, list)
      }
    }
  }

  // ── Festival stalls ───────────────────────────────────────────────────────
  //
  // The game names a festival `harvest` where we name it `harvest_festival`, so
  // both spellings are tried against the ids that actually shipped rather than
  // one being constructed and trusted. Anything neither form matches keeps the
  // method and drops the id — the stalls are not modelled as shops, so there is
  // nowhere else for the stall name to live.
  const festivalId = (key: string): string | null => {
    if (festivalIds.has(key)) return key
    return festivalIds.has(`${key}_festival`) ? `${key}_festival` : null
  }

  for (const grant of unlocks.festivals) {
    addRecipe(grant.recipe, {
      method: 'festival',
      source_id: festivalId(grant.festival),
      // The stall is the half of the answer a player walks to, and the game
      // states it — `[<festival>.stocks.<stall>]` — so it ships.
      stall_key: grant.stall,
      character_id: null,
      price: null,
      currency: 'tesserae',
      requires: [],
      confidence: 'verified',
    })
    addItem(grantKey(grant), grantWindow('festival'))
  }

  // ── Museum reward tiers ───────────────────────────────────────────────────
  // The largest scroll surface in the game, and the answer to "where do
  // furniture recipes come from". The tier is not carried: a reward band is a
  // count of donations, and nothing models museum progress well enough to state
  // "fill the fifth band" as a gate a player could check.
  for (const grant of unlocks.museumRewards) {
    addRecipe(grant.recipe, {
      method: 'quest',
      source_id: null,
      stall_key: null,
      character_id: null,
      price: null,
      currency: 'tesserae',
      requires: [],
      confidence: 'verified',
    })
    addItem(grantKey(grant), grantWindow('quest_reward'))
  }

  // ── The Wishing Well and the Chicken Statue ───────────────────────────────
  for (const [rows, method, spawn] of [
    [unlocks.wishingWell, 'wishing_well', 'wishing_well'],
    [unlocks.chickenStatue, 'chicken_statue', 'chicken_statue'],
  ] as const) {
    for (const grant of rows) {
      addRecipe(grant.recipe, {
        method,
        source_id: null,
        stall_key: null,
        character_id: null,
        price: null,
        currency: 'tesserae',
        requires: [],
        confidence: 'verified',
      })
      addItem(grantKey(grant), grantWindow(spawn))
    }
  }

  // ── Shop shelves ──────────────────────────────────────────────────────────
  // `recipe_scroll` sells the scroll; `include_recipe` sells a dish that
  // teaches it. Both are the same answer to "where do I learn this", and both
  // were being dropped: the first outright, the second not looked at.
  for (const store of game?.storeById.values() ?? []) {
    const shopId = shopIdByStore.get(store.id) ?? null
    for (const category of store.categories) {
      for (const entry of category.entries) {
        const taught = entry.recipe_scroll ?? (entry.include_recipe ? entry.item : null)
        addRecipe(taught, {
          method: 'shop',
          source_id: shopId,
          stall_key: null,
          character_id: null,
          price: null,
          currency: 'tesserae',
          requires: [],
          confidence: 'verified',
        })
      }
    }
  }

  // ── Mine treasure chests ──────────────────────────────────────────────────
  // `taste_maker` is recipes and `furniture` is furniture, and the two lists sit
  // side by side in the same biome. The perk gate is stated on the recipe list
  // only — the perk's own description says the drop is what the perk *adds*.
  for (const biome of game?.mineBiomes ?? []) {
    const mine = biome.name === null ? undefined : mineIdByBiome.get(foldPlaceName(biome.name))
    const mineId = mine?.id ?? null
    for (const recipe of biome.taste_maker) {
      addRecipe(recipe, {
        method: 'mines_chest',
        source_id: mineId,
        stall_key: null,
        character_id: null,
        price: null,
        currency: 'tesserae',
        requires: [{ type: 'perk', key: 'taste_maker', op: 'has', value: null }],
        confidence: 'verified',
      })
    }
    // Furniture and armor are two chest pools with one shape — the crystal
    // set at Deep Earth and the corrupted mistril set in the Ancient Ruins
    // have no other stated source anywhere.
    for (const item of [...biome.furniture, ...biome.armor]) {
      addItem(
        item,
        grantWindow('chest', {
          // The place goes in `locations` and the biome in `biome_id`. Putting
          // the mine id in `locations` fails refint: a mine is a band of floors,
          // not a spot on the overworld map.
          locations: mine?.locationId == null ? [] : [mine.locationId],
          biome_id: mineId,
        }),
      )
    }
  }

  // ── Animal Festival placement prizes ─────────────────────────────────────
  // misc.toml states them twice over: templated placeable ids
  // (`white_{AnimalKind}_wall_ribbon`) and the animal-cosmetic key the placing
  // animal wears (`ribbon_white`). Both expand only against things that
  // actually exist — the item list for placeables, the per-species cosmetic
  // roster for wearables — never by minting a name.
  if (game !== null) {
    const templates = [
      ...game.animalRewardTemplates.small.placeables,
      ...game.animalRewardTemplates.large.placeables,
    ]
    for (const template of templates) {
      const pattern = new RegExp(`^${template.replace('{AnimalKind}', '[a-z_]+')}$`)
      for (const id of game.itemIds) {
        if (pattern.test(id)) addItem(id, grantWindow('festival'))
      }
    }
    const cosmeticKeys = new Set([
      ...game.animalRewardTemplates.small.cosmetics,
      ...game.animalRewardTemplates.large.cosmetics,
    ])
    for (const [pair, name] of game.animalCosmeticNameByPair) {
      const key = pair.split('|')[1] ?? ''
      if (!cosmeticKeys.has(key)) continue
      addItem(resolveByName(name), grantWindow('festival'))
    }
  }

  // ── The museum's replicator ───────────────────────────────────────────────
  // Donate an artifact and the replicator will print its furniture replica —
  // `obj_artifact_replicator.gml` formats `artifact_replica_{ItemId}`, so the
  // naming convention *is* the mechanism, checked against declared ids rather
  // than assumed. The only stated source for the whole replica set.
  for (const item of game?.itemById.values() ?? []) {
    if (!item.id.startsWith('artifact_replica_')) continue
    const artifactId = item.id.replace(/^artifact_replica_/, '')
    if (!(game?.itemIds.has(artifactId) ?? false)) continue
    addItem(
      item.id,
      grantWindow('museum', {
        requires: [{ type: 'donated_item', key: artifactId, op: 'done', value: null }],
      }),
    )
  }

  // ── Cutscene grants ───────────────────────────────────────────────────────
  // `given_items`, "directly stuffed into Ari's inventory" per the file's own
  // comment — the worn axe, the star brooch, the story cloaks. The scene's
  // trigger conditions are prose-adjacent structures nobody models, so the
  // window states the method and nothing it cannot back.
  for (const grant of unlocks.cutscenes) {
    addItem(grantKey(grant), grantWindow('cutscene'))
  }

  // ── Known from the start ──────────────────────────────────────────────────
  for (const item of game?.itemById.values() ?? []) {
    if (item.recipe_is_default !== true) continue
    addRecipe(item.recipe_key ?? item.id, {
      method: 'default',
      source_id: null,
      stall_key: null,
      character_id: null,
      price: null,
      currency: 'tesserae',
      requires: [],
      confidence: 'verified',
    })
  }

  const taught = recipeSources.size
  consola.info(
    `grants: ${taught} recipes with a stated source · ${itemWindows.size} items with a ` +
      'stated grant window',
  )
  if (unresolvedQuests > 0) {
    consola.info(
      `grants: ${unresolvedQuests} quest grant(s) could not be joined to a quest record — ` +
        'the method still ships, the source_id does not.',
    )
  }
  if (unreadLetterGates > 0) {
    consola.info(`grants: ${unreadLetterGates} letter gate(s) use a condition nobody models yet.`)
  }

  // Deterministic output: the extract's iteration order must not decide the
  // order a quest lists its rewards in.
  for (const [questId, items] of itemsByQuest) itemsByQuest.set(questId, [...items].sort())

  return { recipeSources, itemWindows, itemsByQuest }
}
