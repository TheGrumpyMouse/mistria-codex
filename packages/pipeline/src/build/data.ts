/**
 * Build `data/` from `sources/` + `curated/`.
 *
 * The invariant this file must preserve: **`data/` is a pure deterministic
 * function of its inputs.** CI regenerates and runs `git diff --exit-code`, so
 * anything non-deterministic here (timestamps, iteration order, `Math.random`)
 * breaks the build for everyone. Nothing in `data/` may be hand-edited.
 *
 * At D0 every builder returns an empty dataset — sources and curated inputs
 * don't exist yet. Each stage replaces one builder at a time, which is why the
 * registry drives the loop rather than a hand-written list of calls.
 */
import { join } from 'node:path'
import { argv } from 'node:process'
import { pathToFileURL } from 'node:url'
import {
  DATASETS,
  type DatasetName,
  type Festival,
  type Item,
  type Location,
  type MineBiome,
  type Monster,
  type Quest,
  type Recipe,
  type Shop,
  type Spot,
  toSnakeId,
} from '@mistria/schema'
import { consola } from 'consola'
import { BUILD_DIR, DATA_DIR } from '../lib/paths.js'
import { readSpoilerRules, stampSpoilers } from '../lib/spoilers.js'
import { writeJson } from '../lib/write-json.js'
import { buildSeals } from './builders/artifacts.js'
import { buildCharacters, buildGiftPrefs, withVendorFlags } from './builders/characters.js'
import { buildCosmetics } from './builders/cosmetics.js'
import { buildAnimals, buildBuildings, buildPets, buildRanching } from './builders/farm.js'
import { buildFestivals } from './builders/festivals.js'
import { buildCrops, buildFishFacets, buildLocations, itemInputs } from './builders/fish-crops.js'
import { collapseFurniture } from './builders/furniture.js'
import { buildGrantIndex, foldPlaceName } from './builders/grants.js'
import { buildGameOnlyItems, buildItems } from './builders/items.js'
import { buildMachines } from './builders/machines.js'
import {
  anchoredMarkerNames,
  buildMapRegion,
  resolveAnchors,
  resolveSpots,
  WORLD_MAP_ID,
  withShapes,
} from './builders/maps.js'
import { buildMines } from './builders/mines.js'
import { buildMonsters, monstersByBiome } from './builders/monsters.js'
import { buildMuseum, type MuseumIndex } from './builders/museum.js'
import { buildQuests, withQuestUnlocks } from './builders/quests.js'
import {
  buildArtifactFacets,
  buildBugFacets,
  buildForageableFacets,
  buildRecipes,
} from './builders/recipes.js'
import { buildSchedules } from './builders/schedules.js'
import { buildShops, soldByIndex } from './builders/shops.js'
import { buildSkills } from './builders/skills.js'
import { type BuildContext, loadContext } from './context.js'

/**
 * Datasets that other datasets are built from.
 *
 * The order is a real dependency chain, not a convenience. Museum sets come
 * first so each item can carry its set id. Shops come next so each item can
 * carry the shops that sell it — derived from the stock list rather than
 * authored twice. Items come third, and mine biomes last, because a biome reads
 * the fish already located in it rather than keeping a second copy of that list.
 * Computing each once and passing it down keeps the chain explicit instead of
 * hiding it in which builder happens to call which.
 */
interface Derived {
  museum: MuseumIndex
  shops: Shop[]
  items: Item[]
  monsters: Monster[]
  recipes: Recipe[]
  festivals: Festival[]
  /**
   * Built before the recipes, because a recipe learned from a quest reward has
   * to name the quest record, and the join from the game's own quest keys to
   * our wiki-derived ids is not the identity. Same for the mines: a treasure
   * chest names the biome it sits in.
   */
  quests: Quest[]
  mines: MineBiome[]
}

/** A builder turns sources + curated inputs into records for one dataset. */
type Builder = (ctx: BuildContext, derived: Derived) => unknown[]

/**
 * Give each location its pin, where the wiki published one.
 *
 * A location with no marker keeps `anchor: null` and its `data_gaps` entry —
 * the five mine biomes never get one and should not, because a range of floors
 * has no position on an overworld map. That is *not applicable*, and conflating
 * it with *unknown* is the distinction this whole dataset is built around.
 */
function withAnchors(ctx: BuildContext, locations: Location[]): Location[] {
  if (ctx.maps === null) return locations

  const { anchors, unmatched } = resolveAnchors(ctx.maps.markers, locations, ctx.mapAliases)
  if (unmatched.length > 0) {
    consola.info(
      `maps: ${unmatched.length} markers name no location of ours — ` +
        unmatched.map((m) => m.name).join(', '),
    )
  }

  return locations.map((location) => {
    const anchor = anchors.get(location.id)

    // A mine biome is a range of floors, not a place on an overworld map, so it
    // has no anchor and never will. That is *not applicable*, not *unknown*, and
    // the difference is the whole honesty model: it drops the gap rather than
    // carrying one nobody can ever close.
    if (anchor === undefined) {
      if (location.kind !== 'mine' || location.parent_id === null) return location
      return { ...location, data_gaps: location.data_gaps.filter((gap) => gap !== 'anchor') }
    }

    return {
      ...location,
      anchor,
      map_id: WORLD_MAP_ID,
      data_gaps: location.data_gaps.filter((gap) => gap !== 'anchor'),
    }
  })
}

/** Landmarks the wiki places inside a named region. */
function mapSpots(ctx: BuildContext): Spot[] {
  if (ctx.maps === null) return []

  // Shapes first: the geometric fallback needs the footprints, and they come
  // from the same pass that gives the locations their anchors.
  const locations = withShapes(withAnchors(ctx, buildLocations(ctx)), ctx.mapShapes, ctx.mapAliases)
  const footprints = locations.flatMap((location) =>
    location.shape?.type === 'cells'
      ? [{ id: location.id, shape: { cell: location.shape.cell, runs: location.shape.runs } }]
      : [],
  )

  const { spots, unplaced } = resolveSpots(
    ctx.maps.markers,
    locations,
    (name) => toSnakeId(name.replace(/^The\s+/i, '')),
    anchoredMarkerNames(ctx.mapAliases),
    footprints,
  )

  if (unplaced.length > 0) {
    // Named, not silently dropped: each of these is a real landmark whose
    // containing region no source states. The seven quest markers link nowhere
    // at all, and the statues link to their own pages. Their `|location=`
    // infobox field would settle it — that is the next pass, not a guess now.
    consola.info(
      `maps: ${unplaced.length} landmarks have no stated region — ` +
        unplaced.map((m) => m.name).join(', '),
    )
  }
  return spots
}

/**
 * One entry per dataset. Replacing `notYetIngested` with a real builder is how a
 * category comes online, and the coverage report makes the remaining ones
 * visible rather than silently absent.
 */
const BUILDERS: Record<DatasetName, Builder> = {
  items: (_ctx, derived) => derived.items,
  fish: buildFishFacets,
  bugs: buildBugFacets,
  forageables: buildForageableFacets,
  artifacts: buildArtifactFacets,
  crops: buildCrops,
  recipes: (_ctx, derived) => derived.recipes,
  characters: (ctx, derived) => {
    // The schedule gap closes from the schedules actually built, the same
    // derive-once pattern as `is_vendor` — a character record must not keep
    // claiming "no schedule" beside a dataset that ships one.
    const routined = new Set(
      buildSchedules(ctx, new Set(derived.quests.map((quest) => quest.id)))
        .filter((s) => s.entries.length > 0)
        .map((s) => s.character_id),
    )

    // Heart scenes, from the letter that starts each one: `letters.toml` gates
    // the letter on `reached_heart_level = { ryis = 4 }`, which is the only
    // place the game states which scene fires at which level. Only quests that
    // actually ship become triggers — a scene naming no record stays out.
    const questIds = new Set(derived.quests.map((quest) => quest.id))
    const heartEventsByCharacter = new Map<
      string,
      { hearts: number; trigger: string | null; requires: [] }[]
    >()
    for (const chain of ctx.game?.unlocks?.letterQuests ?? []) {
      const heart = chain.reached_heart_level
      if (heart === null) continue
      if (!questIds.has(chain.quest_to_start)) continue
      const list = heartEventsByCharacter.get(heart.npc) ?? []
      // Two letters can start one scene (a re-send after a decline); the scene
      // is still one event.
      if (list.some((event) => event.trigger === chain.quest_to_start)) continue
      list.push({ hearts: heart.level, trigger: chain.quest_to_start, requires: [] })
      heartEventsByCharacter.set(heart.npc, list)
    }
    for (const list of heartEventsByCharacter.values()) {
      list.sort((a, b) => a.hearts - b.hearts || (a.trigger ?? '').localeCompare(b.trigger ?? ''))
    }

    return withVendorFlags(buildCharacters(ctx), derived.shops).map((person) => {
      const heartEvents = heartEventsByCharacter.get(person.id) ?? []
      const dropGaps = new Set<string>()
      if (routined.has(person.id)) dropGaps.add('schedule')
      if (heartEvents.length > 0) dropGaps.add('heart_events')
      // Only romance candidates have heart scenes — for everyone else an empty
      // list is not-applicable, not unknown, and must not wear a gap badge.
      if (person.romanceable === false) dropGaps.add('heart_events')
      if (dropGaps.size === 0) return person
      return {
        ...person,
        heart_events: heartEvents,
        ...(heartEvents.length > 0 ? { prov: { ...person.prov, heart_events: 'game_files' } } : {}),
        data_gaps: person.data_gaps.filter((gap) => !dropGaps.has(gap)),
      }
    })
  },
  gift_prefs: buildGiftPrefs,
  schedules: (ctx, derived) => buildSchedules(ctx, new Set(derived.quests.map((q) => q.id))),
  locations: (ctx) =>
    withShapes(withAnchors(ctx, buildLocations(ctx)), ctx.mapShapes, ctx.mapAliases),
  maps: (ctx) => (ctx.maps === null ? [] : [buildMapRegion(ctx.maps)]),
  museum_sets: (_ctx, derived) => derived.museum.sets,
  spots: (ctx) => mapSpots(ctx),
  festivals: (_ctx, derived) => derived.festivals,
  quests: (_ctx, derived) => derived.quests,
  shops: (_ctx, derived) => derived.shops,
  skills: buildSkills,
  animals: (ctx, derived) =>
    buildAnimals(
      ctx,
      new Set(derived.items.map((i) => i.id)),
      new Set(derived.quests.map((q) => q.id)),
    ),
  buildings: buildBuildings,
  pets: buildPets,
  ranching: (ctx, derived) => buildRanching(ctx, new Set(derived.items.map((i) => i.id))),
  machines: (ctx, derived) => buildMachines(ctx, new Set(derived.items.map((i) => i.id))),
  mines: (_ctx, derived) => derived.mines,
  seals: buildSeals,
  monsters: (_ctx, derived) => derived.monsters,
}

export async function buildData(): Promise<Record<DatasetName, number>> {
  const ctx = await loadContext()
  const museum = buildMuseum(ctx)
  // Furniture collapses first: the market stalls' stock and the recipe
  // outputs both resolve variant ids through its map.
  const furniture = collapseFurniture(ctx)
  const shops = buildShops(ctx, furniture.shippedIdByGameId)
  const soldBy = soldByIndex(shops)
  const shopLocation = new Map(shops.map((shop) => [shop.id, shop.location_id] as const))
  const wikiItems = buildItems(ctx, itemInputs(ctx, museum.byItem))
  // 1.0 outran the wiki: allowlisted game items get records of their own
  // until the wiki documents them, at which point the wiki row wins and the
  // game-only constructor skips the id.
  const nonFurniture = [
    ...wikiItems,
    ...buildGameOnlyItems(ctx, new Set(wikiItems.map((i) => i.id))),
  ]
  const nonFurnitureIds = new Set(nonFurniture.map((i) => i.id))
  for (const record of furniture.records) {
    if (nonFurnitureIds.has(record.id)) {
      throw new Error(
        `furniture record "${record.id}" collides with an existing item id. ` +
          'A recipe_key that doubles as another item id must be resolved by hand.',
      )
    }
  }
  // The wardrobe, last: it reads the built shops to learn who sells what, and
  // asserts its ids against everything already claimed.
  const withFurniture = [...nonFurniture, ...furniture.records]
  const allItems = [
    ...withFurniture,
    ...buildCosmetics(ctx, shops, new Set(withFurniture.map((i) => i.id))),
  ]
  // ── The grant index ───────────────────────────────────────────────────────
  //
  // Every stated way the game hands you a recipe or an item, resolved against
  // the records this build ships. It needs three things that already exist by
  // now — the furniture collapse to turn a colour variant into its record, the
  // quests to resolve a reward's `source_id`, and the mines to name the biome a
  // treasure chest sits in — so it is computed once here and passed down, the
  // same way `museum` and `shops` are.
  const allItemIds = new Set(allItems.map((i) => i.id))
  const monsters = buildMonsters(ctx, allItemIds)
  const quests = buildQuests(ctx, allItemIds)
  const mines = buildMines(ctx, allItems, monstersByBiome(monsters))

  // Game store key -> our shop id, from both directions the two sources meet:
  // the curated `gameStoreId` for the eight wiki shops, and the market vendor
  // table for the six stalls that only exist in the game files.
  const shopIdByStore = new Map<string, string>()
  for (const shop of ctx.shops.shops) {
    if (shop.gameStoreId !== null) shopIdByStore.set(shop.gameStoreId, shop.id)
  }
  for (const vendor of ctx.shops.market?.vendors ?? []) {
    shopIdByStore.set(vendor.storeId, vendor.shopId)
  }

  const festivals = buildFestivals(ctx, allItemIds)
  const grants = buildGrantIndex(
    ctx,
    (gameKey) =>
      furniture.shippedIdByGameId.get(gameKey) ?? (allItemIds.has(gameKey) ? gameKey : null),
    {
      quests,
      mineIdByBiome: new Map(
        mines.map(
          (mine) =>
            [foldPlaceName(mine.name), { id: mine.id, locationId: mine.location_id }] as const,
        ),
      ),
      shopIdByStore,
      festivalIds: new Set(festivals.map((f) => f.id)),
    },
  )

  // What a new game hands you before you take a step — the worn sword and the
  // cloth set. `misc.toml [ari_stats]` states it; the flag is what lets the
  // page say "yours from the start" instead of "no source recorded".
  const startingItems = new Set(ctx.game?.unlocks?.startingItems ?? [])

  const items = allItems.map((item) => {
    const sellers = soldBy.get(item.id) ?? []
    // Windows the game states outright — a museum reward tier, a treasure
    // chest, the post. Appended rather than replacing: an item can be both
    // forageable and posted to you, and the array is an OR of windows.
    const granted = grants.itemWindows.get(item.id) ?? []
    const startsWithIt = startingItems.has(item.id)
    return {
      ...item,
      ...(startsWithIt ? { default_unlocked: true as const } : {}),
      // A "buy it" window knows where to send you: the shops that stock it.
      // That comes from the same list as `sold_by` rather than being resolved
      // twice, and it is a fact, not an inference — the shop is a building at a
      // named place. Fifty-seven items said "location unknown" for want of a
      // join that was already sitting here.
      availability: [
        ...item.availability.map((window) =>
          window.method === 'shop' && window.locations.length === 0
            ? {
                ...window,
                locations: [
                  ...new Set(
                    sellers
                      .map((id) => shopLocation.get(id))
                      .filter((id): id is string => typeof id === 'string'),
                  ),
                ].sort(),
              }
            : window,
        ),
        // A window the item already states wins: the wiki's forage rule knows
        // the season and the place, and a grant window knows neither. Only
        // methods the record has no window for are appended.
        ...granted.filter((g) => !item.availability.some((w) => w.method === g.method)),
      ],
      sold_by: sellers,
      // The Items table's own `isBuyable` is true for exactly one of 1,154 rows,
      // so it is a field nobody filled in rather than a claim that nothing is
      // for sale. A shop listing an item at a price is better evidence, and
      // leaving the flag false while `sold_by` names two shops is a
      // contradiction the app would eventually trip over. The reverse is still
      // not inferred: no shop selling it does not mean it cannot be bought —
      // cosmetic stock and festival stalls remain outside the shops dataset.
      is_buyable: sellers.length > 0 ? true : item.is_buyable,
      // `obtain_method` was every furniture record's standing gap, because the
      // wiki's furniture table says nothing about where anything comes from.
      // Three things now answer it — a stated grant window, a shop that stocks
      // it, or a recipe that makes it — and leaving the gap on a record naming
      // a mine biome and a museum reward tier would badge a fact as unknown.
      data_gaps:
        granted.length > 0 || sellers.length > 0 || item.is_craftable === true || startsWithIt
          ? item.data_gaps.filter((gap) => gap !== 'obtain_method')
          : item.data_gaps,
    }
  })

  // Recipes come after items because both their outputs and their ingredients
  // are gated on the item records actually shipping — a recipe may never point
  // at a record that does not exist. The reverse link is then stamped the same
  // way `sold_by` was above: derived once, written onto the item.
  const builtRecipes = buildRecipes(ctx, new Set(items.map((i) => i.id)), furniture, grants)

  // What the scroll costs, from the shelf that sells it.
  //
  // The grant index knows *that* the Inn teaches the Lemon Pie, because the
  // game's store table says so; it cannot know the price, because the game
  // prices items and not stock lines. The wiki page prices the line. Joining
  // them here is the only place both are in scope, and it is why the source
  // reads "Sold at the Sleeping Dragon Inn — 400t" rather than trailing off.
  const scrollPrice = new Map<string, { price: number; currency: string }>()
  for (const shop of shops) {
    for (const line of shop.stock) {
      if (line.teaches_recipe_id === null || line.price === null) continue
      scrollPrice.set(`${shop.id}|${line.teaches_recipe_id}`, {
        price: line.price,
        currency: line.currency,
      })
    }
  }
  const recipes = builtRecipes.map((recipe) => ({
    ...recipe,
    sources: recipe.sources.map((source) => {
      if (source.method !== 'shop' || source.source_id === null || source.price !== null) {
        return source
      }
      const priced = scrollPrice.get(`${source.source_id}|${recipe.id}`)
      return priced === undefined ? source : { ...source, ...priced }
    }),
  })) as typeof builtRecipes

  const usedIn = new Map<string, string[]>()
  for (const recipe of recipes) {
    for (const ingredient of recipe.ingredients) {
      if (ingredient.item_id === null) continue
      const list = usedIn.get(ingredient.item_id) ?? []
      if (!list.includes(recipe.id)) list.push(recipe.id)
      usedIn.set(ingredient.item_id, list)
    }
  }
  const itemsWithRecipes = items.map((item) => {
    const recipeIds = usedIn.get(item.id)
    return recipeIds === undefined ? item : { ...item, used_in_recipe_ids: recipeIds.sort() }
  })

  // A stock line claiming to teach a recipe has to point at one that shipped.
  // Shops are built before recipes — they gate items, which gate recipes — so
  // the check happens here rather than inside the builder, the same
  // stamp-afterwards shape as `sold_by` above. An unmatched claim is dropped
  // and counted: a dangling id would fail refint, and a silent one would put a
  // recipe line on a shelf for a recipe nobody can look up.
  const recipeIds = new Set(recipes.map((r) => r.id))
  let droppedTeaches = 0
  const shopsWithRecipes = shops.map((shop) => ({
    ...shop,
    stock: shop.stock.map((line) => {
      if (line.teaches_recipe_id === null || recipeIds.has(line.teaches_recipe_id)) return line
      droppedTeaches += 1
      return { ...line, teaches_recipe_id: null }
    }),
  }))
  if (droppedTeaches > 0) {
    consola.info(
      `shops: ${droppedTeaches} stock line(s) named a recipe that did not ship — ` +
        'the line stays, the claim does not.',
    )
  }

  // The quests' own stamp-afterwards pass, last of all: what a quest costs,
  // unlocks and teaches is a reverse index over the *final* shops and recipes,
  // so it cannot run inside `buildQuests` — the same reasoning as
  // `itemsWithRecipes` above.
  const questsWithUnlocks = withQuestUnlocks(ctx, quests, {
    shops: shopsWithRecipes,
    recipes,
    grants,
    builtItemIds: allItemIds,
  })

  const derived: Derived = {
    museum,
    shops: shopsWithRecipes,
    items: itemsWithRecipes,
    monsters,
    recipes,
    quests: questsWithUnlocks,
    mines,
    festivals,
  }
  const counts = {} as Record<DatasetName, number>

  // The spoiler stamp is the one thing applied after a builder runs: "is this
  // a story spoiler" is a curated judgement about presentation, not a fact any
  // builder derives, so it lives in one pass here rather than in 23 builders.
  const spoilers = await readSpoilerRules()

  for (const name of Object.keys(BUILDERS) as DatasetName[]) {
    const records = BUILDERS[name](ctx, derived)
    stampSpoilers(name, records, spoilers)
    await writeJson(join(DATA_DIR, DATASETS[name].file), records, { pretty: true })
    counts[name] = records.length
  }

  // The curation to-do list. Written every build, sorted, and deduplicated so
  // one bad alias doesn't produce a thousand identical lines nobody reads.
  const byToken = new Map<
    string,
    { token: string; field: string; owners: string[]; suggestions: string[] }
  >()
  for (const u of ctx.resolver.unresolved) {
    const key = `${u.field}:${u.token}`
    const existing = byToken.get(key)
    if (existing) existing.owners.push(u.owner)
    else
      byToken.set(key, {
        token: u.token,
        field: u.field,
        owners: [u.owner],
        suggestions: u.suggestions,
      })
  }
  const unresolved = [...byToken.values()]
    .map((u) => ({ ...u, count: u.owners.length, owners: u.owners.slice(0, 5).sort() }))
    .sort((a, b) => b.count - a.count || a.token.localeCompare(b.token))

  await writeJson(join(BUILD_DIR, 'unresolved.json'), unresolved, { pretty: true })

  if (unresolved.length > 0) {
    consola.warn(`${unresolved.length} unresolved tokens — run \`pnpm data:unresolved\``)
  }

  return counts
}

async function main(): Promise<void> {
  const counts = await buildData()
  const total = Object.values(counts).reduce((a, b) => a + b, 0)
  const ingested = Object.entries(counts).filter(([, n]) => n > 0)

  consola.success(`Wrote ${Object.keys(counts).length} datasets to data/ (${total} records)`)
  consola.info(ingested.map(([name, n]) => `${name} ${n}`).join(' · '))
}

const entry = argv[1]
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  main().catch((err: unknown) => {
    consola.error(err)
    process.exitCode = 1
  })
}
