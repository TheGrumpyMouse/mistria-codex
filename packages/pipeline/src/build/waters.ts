/**
 * Turn the Fishing page's water enumeration into something the builders can use.
 *
 * Three things come out of it:
 *
 * 1. **Habitat expansion.** `habitats: ["pond"]` becomes three concrete ponds,
 *    so a fish that used to have nowhere to be drawn now has somewhere. The
 *    expanded window is `confidence: "inferred"` — the wiki says which ponds
 *    exist, not which one this fish is in.
 * 2. **Divability.** Two of the three ocean regions cannot be dived in. A
 *    diving window expands to The Beach alone; without that, the app would send
 *    a player to the Western Ruins to dive in water they can only fish from.
 * 3. **Fishable floors.** The Upper Mines start at floor 1 but are only
 *    fishable from 2, and the Ancient Ruins skip floor 90. Two ranges is two
 *    windows, which is exactly what an OR of ANDs is for.
 */
import type { AvailabilityWindow, Habitat, SpawnMethod } from '@mistria/schema'
import type { WatersExtract } from '../enrich/waters.js'
import type { MineInputs } from './context.js'
import { predates1_0 } from './freshness.js'

export interface WaterIndex {
  /** Habitat -> the locations that hold it, and the subset that can be dived in. */
  byHabitat: Map<Habitat, { all: string[]; divable: string[] }>
  /** Location id -> the habitats the Fishing page proves it has. */
  habitatsByLocation: Map<string, Habitat[]>
  /** Mine biome id -> the floor ranges that actually hold water. */
  fishableFloors: Map<string, { min: number; max: number }[]>
  /** True when the Fishing page has not been touched since 1.0 shipped. */
  stale: boolean
}

export const EMPTY_WATER_INDEX: WaterIndex = {
  byHabitat: new Map(),
  habitatsByLocation: new Map(),
  fishableFloors: new Map(),
  stale: true,
}

/** Methods that put a player in the water rather than beside it. */
const DIVING: SpawnMethod[] = ['diving']

/**
 * Build the index.
 *
 * `resolveLocation` maps a wiki link target to a location id and reports a miss,
 * so a renamed region lands in the unresolved queue instead of silently
 * shrinking the pond list to two.
 *
 * Biome order is floor order — `{{BiomesQuick|3}}` is the third biome counting
 * up from the surface — so the biomes are sorted by their own floors rather
 * than trusting the curated file's array order to mean something.
 */
export function buildWaterIndex(
  extract: WatersExtract,
  mines: MineInputs,
  resolveLocation: (names: string[]) => string | null,
): WaterIndex {
  const byHabitat = new Map<Habitat, { all: string[]; divable: string[] }>()
  const habitatsByLocation = new Map<string, Habitat[]>()

  for (const water of extract.waters) {
    const habitat = water.habitat as Habitat
    const id = resolveLocation([water.location.target, water.location.display])
    if (id === null) continue

    const entry = byHabitat.get(habitat) ?? { all: [], divable: [] }
    if (!entry.all.includes(id)) entry.all.push(id)
    if (water.divable && !entry.divable.includes(id)) entry.divable.push(id)
    byHabitat.set(habitat, entry)

    const habitats = habitatsByLocation.get(id) ?? []
    if (!habitats.includes(habitat)) habitats.push(habitat)
    habitatsByLocation.set(id, habitats)
  }

  const inFloorOrder = [...mines.biomes].sort((a, b) => a.floors.min - b.floors.min)
  const fishableFloors = new Map<string, { min: number; max: number }[]>()
  for (const mine of extract.mineFishing) {
    const biome = inFloorOrder[mine.biomeOrder - 1]
    if (biome === undefined) continue
    // An entry with no stated range is fishable throughout, so it takes the
    // biome's own floors. Filling it in here means every fishable biome carries
    // an explicit range and the app never has to ask why one biome has floors
    // and the next does not.
    fishableFloors.set(biome.id, mine.floors.length > 0 ? mine.floors : [biome.floors])
  }

  return {
    byHabitat,
    habitatsByLocation,
    fishableFloors,
    stale: predates1_0(extract.lastEdited),
  }
}

export interface ExpandedPlace {
  locations: string[]
  /** True when the locations were derived from a habitat rather than named. */
  inferred: boolean
}

/**
 * Turn a window's habitats into the places it can be drawn.
 *
 * A named location always wins: when the wiki said "The Narrows", a habitat
 * alongside it is a category, not a second answer. Expansion happens only for
 * the windows that would otherwise have nowhere to go.
 *
 * `overworld` is deliberately not expandable. It means "outdoors, no particular
 * place", and painting a pin on all nine outdoor regions would dress an absence
 * of information up as nine facts.
 */
export function expandHabitats(
  index: WaterIndex,
  habitats: Habitat[],
  locations: string[],
  method: SpawnMethod,
): ExpandedPlace {
  if (locations.length > 0) return { locations, inferred: false }

  const found: string[] = []
  for (const habitat of habitats) {
    const entry = index.byHabitat.get(habitat)
    if (entry === undefined) continue
    for (const id of DIVING.includes(method) ? entry.divable : entry.all) {
      if (!found.includes(id)) found.push(id)
    }
  }

  // Sorted so the output does not depend on the order the wiki listed them in.
  return found.length > 0
    ? { locations: [...found].sort(), inferred: true }
    : { locations: [], inferred: false }
}

/**
 * Split a mine fishing window across the floors that actually hold water.
 *
 * Only applies where the window has no depth of its own: a stated floor range
 * on the item is a fact about that item and outranks the page's general answer
 * for the biome.
 */
export function splitByFishableFloors(
  index: WaterIndex,
  window: AvailabilityWindow,
): AvailabilityWindow[] {
  if (window.depth !== null || window.biome_id === null) return [window]
  if (window.method !== 'fishing' && window.method !== 'diving') return [window]

  const ranges = index.fishableFloors.get(window.biome_id)
  if (ranges === undefined || ranges.length === 0) return [window]

  return ranges.map((depth) => ({ ...window, depth }))
}
