import type { Crop, FishFacet, Location, MuseumWing, Rarity, SpawnMethod } from '@mistria/schema'
import { toSnakeId } from '@mistria/schema'
import { toInteger, toTokens } from '../../normalise/wikitext.js'
import { type BuildContext, name as itemName, text } from '../context.js'
import type { ItemBuildInput } from './items.js'

const RARITIES: Record<string, Rarity> = {
  common: 'common',
  uncommon: 'uncommon',
  rare: 'rare',
  legendary: 'legendary',
}

const SHADOW_SIZES = new Set(['small', 'medium', 'large', 'giant'])

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
    inputs.set(name, {
      displayName: name,
      methods: ['bug_net'],
      rarity: RARITIES[text(row.rarity).toLowerCase()] ?? null,
      weatherTokens: toTokens(row.weather),
      seasonTokens: toTokens(row.season),
      timeToken: text(row.time),
      categoryOverride: 'bug',
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

    inputs.set(name, {
      displayName: name,
      methods,
      rarity: RARITIES[text(row.rarity).toLowerCase()] ?? null,
      weatherTokens: toTokens(row.weather),
      categoryOverride: 'fish',
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

export function buildCrops(ctx: BuildContext): Crop[] {
  return ctx.crops.map((row) => {
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
      yield: null,
      quality_enabled: null,
      greenhouse_ok: null,
      seed_sources: [],
    }
  })
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
