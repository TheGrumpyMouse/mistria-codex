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
  type Item,
  type Location,
  type Monster,
  type Shop,
  type Spot,
  toSnakeId,
} from '@mistria/schema'
import { consola } from 'consola'
import { BUILD_DIR, DATA_DIR } from '../lib/paths.js'
import { writeJson } from '../lib/write-json.js'
import { buildSeals } from './builders/artifacts.js'
import { buildCharacters, buildGiftPrefs } from './builders/characters.js'
import { buildAnimals, buildBuildings } from './builders/farm.js'
import { buildFestivals } from './builders/festivals.js'
import { buildCrops, buildFishFacets, buildLocations, itemInputs } from './builders/fish-crops.js'
import { buildItems } from './builders/items.js'
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
import { buildQuests } from './builders/quests.js'
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
  recipes: buildRecipes,
  characters: buildCharacters,
  gift_prefs: buildGiftPrefs,
  schedules: buildSchedules,
  locations: (ctx) =>
    withShapes(withAnchors(ctx, buildLocations(ctx)), ctx.mapShapes, ctx.mapAliases),
  maps: (ctx) => (ctx.maps === null ? [] : [buildMapRegion(ctx.maps)]),
  museum_sets: (_ctx, derived) => derived.museum.sets,
  spots: (ctx) => mapSpots(ctx),
  festivals: buildFestivals,
  quests: buildQuests,
  shops: (_ctx, derived) => derived.shops,
  skills: buildSkills,
  animals: buildAnimals,
  buildings: buildBuildings,
  mines: (ctx, derived) => buildMines(ctx, derived.items, monstersByBiome(derived.monsters)),
  seals: buildSeals,
  monsters: (_ctx, derived) => derived.monsters,
}

export async function buildData(): Promise<Record<DatasetName, number>> {
  const ctx = await loadContext()
  const museum = buildMuseum(ctx)
  const shops = buildShops(ctx)
  const soldBy = soldByIndex(shops)
  const shopLocation = new Map(shops.map((shop) => [shop.id, shop.location_id] as const))
  const items = buildItems(ctx, itemInputs(ctx, museum.byItem)).map((item) => {
    const sellers = soldBy.get(item.id) ?? []
    return {
      ...item,
      // A "buy it" window knows where to send you: the shops that stock it.
      // That comes from the same list as `sold_by` rather than being resolved
      // twice, and it is a fact, not an inference — the shop is a building at a
      // named place. Fifty-seven items said "location unknown" for want of a
      // join that was already sitting here.
      availability: item.availability.map((window) =>
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
      sold_by: sellers,
      // The Items table's own `isBuyable` is true for exactly one of 1,154 rows,
      // so it is a field nobody filled in rather than a claim that nothing is
      // for sale. A shop listing an item at a price is better evidence, and
      // leaving the flag false while `sold_by` names two shops is a
      // contradiction the app would eventually trip over. The reverse is not
      // inferred: no shop selling it does not mean it cannot be bought, because
      // the Saturday Market's eight vendors are not ingested yet.
      is_buyable: sellers.length > 0 ? true : item.is_buyable,
    }
  })
  const derived: Derived = { museum, shops, items, monsters: buildMonsters(ctx) }
  const counts = {} as Record<DatasetName, number>

  for (const name of Object.keys(BUILDERS) as DatasetName[]) {
    const records = BUILDERS[name](ctx, derived)
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
