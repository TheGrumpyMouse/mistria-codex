import type { Crop, FishFacet, Location, MuseumWing, Rarity, SpawnMethod } from '@mistria/schema'
import { toSnakeId } from '@mistria/schema'
import { toInteger, toTokens } from '../../normalise/wikitext.js'
import { type BuildContext, name as itemName, text } from '../context.js'
import { hoursToRange, rarityFor, seasonsFor, statedWeather } from '../game-facts.js'
import type { GameWindowFacts, ItemBuildInput } from './items.js'

const RARITIES: Record<string, Rarity> = {
  common: 'common',
  uncommon: 'uncommon',
  rare: 'rare',
  legendary: 'legendary',
}

const SHADOW_SIZES = new Set(['small', 'medium', 'large', 'giant'])

/**
 * The game's window for one bug, or null when the extract does not have it.
 *
 * Every one of the game's 93 bugs matches an item and none disagrees with the
 * wiki about seasons, which is the reassuring half. The half that matters is
 * that the game has hours for all 93 and rooms for all of them, and the wiki
 * has usable time for 28 and a location for 38.
 */
function gameBugWindow(ctx: BuildContext, displayName: string): GameWindowFacts | null {
  const bug = ctx.game?.bugById.get(ctx.idFor(displayName))
  if (bug === undefined || ctx.game === null) return null

  const seasons = seasonsFor(bug.seasons)
  return {
    seasons,
    weather: statedWeather(bug.weather, seasons, ctx.weatherClasses),
    time: hoursToRange(bug.hours),
    locations: [
      ...new Set(bug.tags.flatMap((tag) => ctx.game?.locationsByBugTag.get(tag) ?? [])),
    ].sort(),
  }
}

/** The game's rarity for a bug. It grades six of them `very_rare`; the wiki drops those. */
const gameRarity = (ctx: BuildContext, displayName: string): Rarity | null =>
  rarityFor(ctx.game?.bugById.get(ctx.idFor(displayName))?.rarity ?? null)

/**
 * The game's seasons and weather for one fish, across all of its spawn rules.
 *
 * A fish is one item with several rules — angled in the river, dived for in the
 * ocean — and the season and weather fields on our record describe the item, so
 * the union is the honest reading of them. It is also what the wiki's own
 * per-item `season` column already is, so this narrows nothing that was previously
 * split. Five mine fish had no season at all and now have four.
 *
 * Time and place are deliberately not taken. The game states no hours for any
 * fish, which the method rules already model as not-applicable, and where a fish
 * lives comes from the waters index rather than from a `water_type` word.
 */
function gameFishWindow(ctx: BuildContext, displayName: string): GameWindowFacts | null {
  const rules = ctx.game?.fishByItem.get(ctx.idFor(displayName))
  if (rules === undefined || rules.length === 0) return null

  const seasons = [...new Set(rules.flatMap((rule) => seasonsFor(rule.seasons)))]
  const weather = [
    ...new Set(
      rules.flatMap(
        (rule) => statedWeather(rule.weather, seasonsFor(rule.seasons), ctx.weatherClasses) ?? [],
      ),
    ),
  ]

  return {
    seasons: seasons.sort(),
    weather: weather.length > 0 ? weather.sort() : null,
    time: null,
    locations: [],
  }
}

/**
 * The wiki display name for a game item id, or null if the wiki has no such row.
 *
 * The game's own name is the lookup key, and the guard is the point: everything
 * downstream is keyed by display name against the wiki's tables, so an item the
 * game names and the wiki does not must drop out here rather than create an
 * input whose row will never resolve.
 */
function gameDisplayName(ctx: BuildContext, itemId: string): string | null {
  const name = ctx.game?.itemById.get(itemId)?.name ?? null
  return name !== null && ctx.itemByName.has(name) ? name : null
}

/**
 * Which items D1 ingests, and how each is obtained.
 *
 * Seed items are included because a crop's `seed_item_id` points at one, and a
 * dangling reference fails validation — correctly, since the app would render a
 * broken link.
 */
export function itemInputs(
  ctx: BuildContext,
  museumByItem: Map<string, { setId: string; wing: MuseumWing }>,
): ItemBuildInput[] {
  const inputs = new Map<string, ItemBuildInput>()

  // Every item in the wiki's table. Category is decided by tags; the loops
  // below then refine the ones we know more about.
  //
  // A tag can imply the method outright: "Forageable" means you pick it up off
  // the ground, which is the whole meaning of the word. Anything without a
  // method gets no availability window and so cannot appear on the "what can I
  // find" screen at all — so where a tag settles it, say so.
  for (const row of ctx.items) {
    const name = itemName(row.itemName)
    if (name === '') continue

    const tags = toTokens(row.tags).map((t) => t.toLowerCase())
    const methods: SpawnMethod[] = []
    if (tags.some((t) => t.endsWith('forageable'))) methods.push('foraging')

    inputs.set(name, { displayName: name, methods })
  }

  for (const row of ctx.bugs) {
    const name = itemName(row.name)
    if (name === '') continue

    // The game states every bug's hours, seasons, weather and rooms as data;
    // the wiki states seasons in a column, weather in another, and time as
    // prose that 65 of 93 bugs leave unusable. Where the extract has the bug,
    // it supplies the whole window and the wiki's tokens go unread.
    const game = gameBugWindow(ctx, name)

    inputs.set(name, {
      displayName: name,
      methods: ['bug_net'],
      rarity: gameRarity(ctx, name) ?? RARITIES[text(row.rarity).toLowerCase()] ?? null,
      weatherTokens: toTokens(row.weather),
      seasonTokens: toTokens(row.season),
      timeToken: text(row.time),
      categoryOverride: 'bug',
      ...(game === null ? {} : { game }),
    })
  }

  for (const row of ctx.artifacts) {
    const name = itemName(row.name)
    if (name === '') continue
    inputs.set(name, {
      displayName: name,
      methods: [],
      rarity: RARITIES[text(row.rarity).toLowerCase()] ?? null,
      categoryOverride: 'artifact',
    })
  }

  for (const row of ctx.fish) {
    const name = itemName(row.fishName)
    if (name === '') continue

    // `fishing` and `diving` are 1, 0, or null. Null means the wiki never
    // recorded it — so an unmarked fish gets no method rather than a guessed
    // one, and shows up in the coverage report as a gap.
    const methods: SpawnMethod[] = []
    if (row.fishing === 1) methods.push('fishing')
    if (row.diving === 1) methods.push('diving')

    const game = gameFishWindow(ctx, name)

    inputs.set(name, {
      displayName: name,
      methods,
      rarity: RARITIES[text(row.rarity).toLowerCase()] ?? null,
      weatherTokens: toTokens(row.weather),
      categoryOverride: 'fish',
      ...(game === null ? {} : { game }),
    })
  }

  for (const row of ctx.crops) {
    // Enrich rather than insert-if-absent. The all-items loop above already put
    // every crop in the map with no method, so a `!inputs.has()` guard here
    // would silently drop `crop_harvest` from all 58 crops — and an item with no
    // method gets no availability window at all, so it vanishes from the
    // "what can I find" screen entirely.
    const name = itemName(row.name)
    if (name !== '') {
      const existing = inputs.get(name)
      inputs.set(name, {
        ...existing,
        displayName: name,
        methods: [...new Set([...(existing?.methods ?? []), 'crop_harvest' as const])],
      })
    }

    const seed = text(row.seed)
    if (seed !== '') {
      const existing = inputs.get(seed)
      inputs.set(seed, {
        ...existing,
        displayName: seed,
        methods: [...new Set([...(existing?.methods ?? []), 'shop' as const])],
        categoryOverride: 'seed',
      })
    }
  }

  // Fruit trees. The wiki's Crops table has four of the seven you can plant, and
  // Lemon, Peach and Pear shipped as items with an empty availability and an
  // `obtain_method` gap — the app could not say where a lemon comes from at all.
  //
  // They are missing because they are not crops in the game's sense either:
  // `crop.toml` does not contain them, `tree.toml` does, and the wiki files the
  // four it has under Crops by editorial choice rather than because a table said
  // so. Chasing "104 game crops vs 58 wiki crops" finds only forageables; the
  // actual gap was in the file nobody had read.
  for (const [harvest, plantable] of ctx.game?.fruitTreeByHarvest ?? []) {
    const fruit = gameDisplayName(ctx, harvest)
    if (fruit === null) continue

    const existing = inputs.get(fruit)
    inputs.set(fruit, {
      ...existing,
      displayName: fruit,
      methods: [...new Set([...(existing?.methods ?? []), 'crop_harvest' as const])],
      // Weather and time are stated as unrestricted rather than unknown: the
      // tree carries fruit until it is picked, and `crop_harvest` is already on
      // both not-applicable lists for exactly that reason. Place is left empty
      // so the method rule supplies `the_farm` — a tree is where you planted it,
      // and the game does not say otherwise.
      game: {
        seasons: seasonsFor(plantable.tree.seasons),
        weather: null,
        time: null,
        locations: [],
      },
    })

    const sapling = gameDisplayName(ctx, plantable.saplingItemId)
    if (sapling === null) continue
    const prior = inputs.get(sapling)
    inputs.set(sapling, {
      ...prior,
      displayName: sapling,
      methods: [...new Set([...(prior?.methods ?? []), 'shop' as const])],
      categoryOverride: 'seed',
    })
  }

  // Stamp museum membership on whichever input ended up representing each item.
  for (const [name, input] of inputs) {
    const museum = museumByItem.get(ctx.idFor(name))
    if (museum !== undefined) input.museum = museum
  }

  return [...inputs.values()]
}

export function buildFishFacets(ctx: BuildContext): FishFacet[] {
  return ctx.fish.map((row) => {
    const size = text(row.size).toLowerCase()
    const methods: SpawnMethod[] = []
    if (row.fishing === 1) methods.push('fishing')
    if (row.diving === 1) methods.push('diving')

    return {
      item_id: ctx.idFor(itemName(row.fishName)),
      // 9 of 143 fish have no size on the wiki. Null, not a guessed "medium".
      shadow_size: SHADOW_SIZES.has(size) ? (size as FishFacet['shadow_size']) : null,
      catch_methods: methods,
      is_legendary: text(row.rarity).toLowerCase() === 'legendary',
      school_size: null,
      rarity: RARITIES[text(row.rarity).toLowerCase()] ?? null,
    }
  })
}

/**
 * Crop records for fruit trees the wiki's Crops table leaves out.
 *
 * Seven trees have a sapling item and four of them are in `ctx.crops` already;
 * the other three are built here from `tree.toml` and nothing else. Every field
 * is read, not assumed: seasons and regrow from `fruit_data`, growth from the
 * stage table, and `yield` from the count of fruit positions the tree declares.
 *
 * Emitted as crops rather than as a new dataset because that is where the wiki
 * already puts Apple and Cherry. A parallel `fruit_trees.json` holding three
 * records would split one concept across two files and leave every consumer to
 * remember to read both.
 */
/**
 * A tree's fruit count as a yield range.
 *
 * `min === max` because the count is not a roll: the tree declares three sprite
 * positions and fills all three. A `{min: 1, max: 3}` would be a hedge the files
 * do not support.
 */
const treeYield = (count: number | null): Crop['yield'] =>
  count === null ? null : { min: count, max: count }

function fruitTreeCrops(ctx: BuildContext, wikiCrops: Set<string>): Crop[] {
  const rows: Crop[] = []

  for (const [harvest, plantable] of ctx.game?.fruitTreeByHarvest ?? []) {
    const name = gameDisplayName(ctx, harvest)
    if (name === null) continue

    const id = ctx.idFor(name)
    if (wikiCrops.has(id)) continue

    rows.push({
      id,
      name,
      numeric_id: null,
      numeric_id_game_version: null,
      id_status: 'confirmed',
      former_ids: [],
      also_known_as: [],
      game_version: ctx.game?.version ?? null,
      version_added: null,
      confidence: 'verified',
      prov: { '*': 'game_files' },
      data_gaps: [],
      icon_key: `crop/${id}`,
      wiki_page: name.replace(/ /g, '_'),
      blurb: null,

      seed_item_id: ctx.game?.itemIds.has(plantable.saplingItemId) ? plantable.saplingItemId : null,
      produce_item_id: id,
      growth_days: plantable.growthDays,
      regrow_days: plantable.tree.regrow_days,
      seasons: seasonsFor(plantable.tree.seasons),
      // A fruit tree is not a trellis crop and does not go in a greenhouse — but
      // neither is stated anywhere, and "obviously not" is how invented data gets
      // in. They stay null, exactly as they are on the four the wiki supplies.
      is_trellis: null,
      yield: treeYield(plantable.tree.yield),
      quality_enabled: null,
      greenhouse_ok: null,
      seed_sources: [],
    })
  }

  return rows.sort((a, b) => (a.id < b.id ? -1 : 1))
}

export function buildCrops(ctx: BuildContext): Crop[] {
  const wiki = ctx.crops.map((row): Crop => {
    const name = itemName(row.name)
    const id = ctx.idFor(name)
    const seedName = text(row.seed)
    const itemRow = ctx.itemByName.get(name)

    const { seasons } = ctx.resolver.resolveSeasons(text(itemRow?.season), id)
    const growth = toInteger(row.growthTime)

    // The wiki names a seed for every crop, but not every one of those seeds has
    // an Items row — Burdock Root Seed is named and absent. Emitting the id
    // anyway would assert an item that does not exist and break every consumer
    // that follows the link, so it becomes a gap instead.
    const seedExists = seedName !== '' && ctx.itemByName.has(seedName)

    const gaps: string[] = []
    if (growth === null) gaps.push('growth_days')
    if (!seedExists) gaps.push('seed_item_id')

    return {
      id,
      name,
      numeric_id: null,
      numeric_id_game_version: null,
      id_status: 'provisional',
      former_ids: [],
      also_known_as: [],
      game_version: null,
      version_added: null,
      confidence: 'wiki',
      prov: { '*': 'wiki_cargo' },
      data_gaps: gaps,
      icon_key: `crop/${id}`,
      wiki_page: name.replace(/ /g, '_'),
      blurb: null,

      seed_item_id: seedExists ? ctx.idFor(seedName) : null,
      produce_item_id: id,
      growth_days: growth,
      // Null means "does not regrow" — a single harvest. The wiki leaves the
      // cell empty for those, which is the same thing.
      regrow_days: toInteger(row.regrowTime),
      seasons,
      is_trellis: null,
      // The four fruit trees the wiki does file under Crops carry three fruit
      // apiece, which the game states as three sprite positions on the tree and
      // the wiki states in prose. Every other crop's yield is still unsourced.
      yield: treeYield(ctx.game?.fruitTreeByHarvest.get(id)?.tree.yield ?? null),
      quality_enabled: null,
      greenhouse_ok: null,
      seed_sources: [],
    }
  })

  return [...wiki, ...fruitTreeCrops(ctx, new Set(wiki.map((crop) => crop.id)))]
}

/**
 * Locations come straight from `curated/`, since the wiki has no location table.
 *
 * Every record ships with `anchor: null` and an `anchor` data gap: the maps are
 * hand-drawn and haven't been drawn yet, and a placeholder coordinate would be
 * indistinguishable from a real one while putting pins in the wrong place.
 */
export function buildLocations(ctx: BuildContext): Location[] {
  return ctx.resolver.locations.map((record) => {
    // The curated habitat list describes the terrain; the Fishing page names
    // which regions hold water. Merging them fixed three records that had a
    // pond or a river the vocabulary had never mentioned.
    const fromWater = ctx.waters.habitatsByLocation.get(record.id) ?? []
    const habitats = [...new Set([...record.habitats, ...fromWater])].sort()
    const gaps = ['anchor', 'map_id']
    if (fromWater.length > 0 && ctx.waters.stale) gaps.push('predates_1_0')

    // Six of the thirteen buildings are rubble until a story quest is done.
    // Listing them without that sends a new player to a building that is not
    // there yet — and the app shows a locked result rather than hiding it.
    const unlock =
      record.unlock_quest == null
        ? []
        : [
            {
              type: 'quest' as const,
              key: toSnakeId(record.unlock_quest),
              op: 'done' as const,
              value: null,
            },
          ]

    return {
      id: record.id,
      name: record.name,
      numeric_id: null,
      numeric_id_game_version: null,
      id_status: 'confirmed' as const,
      former_ids: [],
      also_known_as: [],
      game_version: null,
      version_added: null,
      confidence: 'wiki' as const,
      prov: { '*': 'manual' as const },
      data_gaps: gaps,
      icon_key: null,
      wiki_page: (record.wiki_page ?? record.name).replace(/ /g, '_'),
      blurb: null,

      kind: record.kind as Location['kind'],
      map_id: null,
      parent_id: record.parent_id ?? null,
      habitats,
      anchor: null,
      shape: null,
      connections: [],
      unlock_requires: unlock,
      aliases: record.aliases,
    }
  })
}
