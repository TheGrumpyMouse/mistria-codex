/**
 * Where each artifact comes from, as the game states it.
 *
 * Before this, 90 of 110 artifacts had no availability at all — the wiki's
 * Items table mostly leaves their location column empty, and the pipeline
 * honestly emitted nothing. The game states the whole thing as three joins
 * (see `buildArtifactFacts` in game-facts.ts), and this file turns a pool
 * membership into availability windows.
 *
 * The pools that name no place stay gaps. `fish_trap`, `oopart` and `mist`
 * appear in no room's pool entry, so no window is invented for them here; the
 * two perk-gated ones keep their wiki-derived windows and the fish trap
 * remains an honest `obtain_method` gap.
 */
import {
  type AvailabilityWindow,
  SEASONS,
  type Seal,
  type Season,
  toSnakeId,
} from '@mistria/schema'
import type { BuildContext } from '../context.js'
import { seasonsFor, statedWeather } from '../game-facts.js'
import { expandHabitats, splitByFishableFloors } from '../waters.js'
import { buildLocations } from './fish-crops.js'

/** The window fields every artifact source shares. */
function windowBase(): Omit<
  AvailabilityWindow,
  'method' | 'locations' | 'requires' | 'confidence' | 'prov'
> {
  return {
    habitats: [],
    spot_ids: [],
    // Every pool rolls all year. Fully expanded, never an "all" magic string.
    seasons: [...SEASONS] as Season[],
    // Unknown here, deliberately — the per-method rules layer in
    // `artifactAvailability` upgrades these to not-applicable for the methods
    // curated/vocab/method_rules.json has a human-attested source for (dig
    // spots are rolled per day and ignore both clock and sky). Starting at
    // unknown means a new method defaults to the safe reading.
    weather: null,
    weather_precision: 'unknown',
    time: null,
    time_blocks: null,
    time_precision: 'unknown',
    days: null,
    dates: null,
    depth: null,
    biome_id: null,
    min_year: null,
    rarity: null,
    chance: null,
    quantity: null,
  }
}

const perkRequirement = (key: string) => ({
  type: 'perk' as const,
  key,
  op: 'has' as const,
  value: null,
})

/**
 * The pools found by digging on the overworld, and the one perk-gated farm
 * pool. `vintage_farm_tools` carries `former_farmers` because the perk is the
 * mechanism: `locations.toml` gives the farm no dig site of its own, so the
 * perk's daily dig site is the only way this pool spawns at all.
 */
const FARM_POOL = 'vintage_farm_tools'

/**
 * Availability for one artifact, from the game's pool tables.
 *
 * Null means "the game states nothing" — the caller keeps whatever the wiki
 * said, including nothing. Empty is never returned: a pool that resolves to
 * zero windows is a pool this code does not understand, and pretending
 * otherwise would erase a wiki answer without replacing it.
 */
export function artifactAvailability(
  ctx: BuildContext,
  itemId: string,
): { windows: AvailabilityWindow[]; gaps: string[] } | null {
  const facts = ctx.game?.artifactFacts
  if (facts === undefined || facts === null) return null

  const pool = facts.poolByItem.get(itemId)
  if (pool === undefined) return null

  const rarity = facts.rarityByItem.get(itemId) ?? null
  const windows = windowsForPool(ctx, pool, itemId).map((w) => {
    // The same per-method rules the wiki path applies. Dig spots are rolled
    // per day and sit there until dug — curated/vocab/method_rules.json holds
    // the attestation — so a null here is "no restriction", not "nobody
    // checked". Methods absent from the rules stay unknown, the safe way round.
    const timeNA = ctx.methodRules.timeNotApplicable.includes(w.method)
    const weatherNA = ctx.methodRules.weatherNotApplicable.includes(w.method)
    return {
      ...w,
      rarity,
      time_precision:
        w.time !== null
          ? w.time_precision
          : timeNA
            ? ('not_applicable' as const)
            : w.time_precision,
      weather_precision:
        w.weather !== null
          ? w.weather_precision
          : weatherNA
            ? ('not_applicable' as const)
            : w.weather_precision,
    }
  })
  if (windows.length === 0) return null

  // The gaps a window states about itself. Same vocabulary as the wiki path,
  // so the coverage report keeps counting honestly.
  const gaps: string[] = []
  if (windows.some((w) => w.time_precision === 'unknown')) gaps.push('time')
  if (windows.some((w) => w.weather === null && w.weather_precision === 'unknown')) {
    gaps.push('weather')
  }
  if (windows.some((w) => w.locations.length === 0 && w.habitats.length > 0)) {
    gaps.push('locations')
  }

  return { windows, gaps }
}

function windowsForPool(ctx: BuildContext, pool: string, itemId: string): AvailabilityWindow[] {
  const facts = ctx.game?.artifactFacts
  if (facts === undefined || facts === null) return []

  // A room names this pool: one dig window at that place, stated outright.
  const located = facts.locationsByPool.get(pool)
  if (located !== undefined && located.length > 0) {
    return [
      {
        ...windowBase(),
        method: 'dig_spot',
        locations: located,
        requires: pool === FARM_POOL ? [perkRequirement('former_farmers')] : [],
        confidence: 'verified',
        prov: 'game_files',
      },
    ]
  }

  // A mine biome names this pool: one dig window across its floors. The pool
  // states which biome; the biome's floors come from the curated mines file,
  // the single definition of "floors 21-39 is the Tide Caverns" — the game's
  // own floor starts disagree off-by-one with the published ranges.
  const order = facts.minePoolOrder.get(pool)
  if (order !== undefined) {
    const byFloor = [...ctx.mines.biomes].sort((a, b) => a.floors.min - b.floors.min)
    const biome = byFloor[order - 1]
    if (biome === undefined) return []
    return [
      {
        ...windowBase(),
        method: 'dig_spot',
        locations: biome.location_id === null ? [] : [biome.location_id],
        depth: biome.floors,
        biome_id: biome.id,
        requires: [],
        confidence: 'verified',
        prov: 'game_files',
      },
    ]
  }

  // Ritual chambers: special rooms on stated floor bands. The pool -> chamber
  // join is a name match on `*_ritual_chamber`, which is why every one of
  // these windows is inferred — an inference must never render as a fact.
  if (pool === 'ritual') {
    return facts.ritualFloors.map((band) => {
      const biome = ctx.mines.biomes.find(
        (b) => band.min >= b.floors.min && band.max <= b.floors.max,
      )
      return {
        ...windowBase(),
        method: 'dig_spot' as const,
        locations:
          biome?.location_id === undefined || biome.location_id === null ? [] : [biome.location_id],
        depth: band,
        biome_id: biome?.id ?? null,
        requires: [],
        confidence: 'inferred' as const,
        prov: 'game_files' as const,
      }
    })
  }

  // Fished and dived pools: the rule is in fish.toml, yielding an
  // "unidentified artifact" whose rule id is this item. The perk gate comes
  // from the rule itself, not from a wiki regex.
  const rule = facts.fishRuleByArtifact.get(itemId)
  if (rule !== undefined && (pool === 'sunken' || pool === 'aquatic')) {
    const method = (rule.retrieval ?? []).includes('divespot') ? 'diving' : 'fishing'
    const habitats = (rule.water_type ?? []).filter(
      (w): w is 'ocean' | 'pond' | 'river' => w === 'ocean' || w === 'pond' || w === 'river',
    )
    const where = expandHabitats(ctx.waters, habitats, [], method)
    const seasons = seasonsFor(rule.seasons)

    // `weather = false` on the rule means unrestricted — a stated fact, not a
    // gap — so it expands to every weather those seasons can have, exactly as
    // ordinary fish rules do.
    const weather = statedWeather(rule.weather, seasons, ctx.weatherClasses)

    const window: AvailabilityWindow = {
      ...windowBase(),
      method,
      habitats,
      locations: where.locations,
      seasons,
      weather,
      weather_precision: weather === null ? 'unknown' : 'exact',
      requires: rule.perk_artifact === null ? [] : [perkRequirement(rule.perk_artifact)],
      // The habitat expansion says which waters exist, not which one holds
      // this artifact — the same reasoning that draws expanded fish pins
      // hollow applies here.
      confidence: where.inferred ? 'inferred' : 'verified',
      prov: 'game_files',
    }
    return splitByFishableFloors(ctx.waters, window)
  }

  // The gem and metal sets are the perfect ores, and the curated mines file
  // states which biome each drops in — Perfect Ruby is an Upper Mines ore. A
  // mine window per biome that lists the item. Curated tier, so it renders as
  // the wiki's word rather than the game's.
  if (pool === 'gems_of_mistria' || pool === 'metals_of_mistria') {
    return ctx.mines.biomes
      .filter((biome) => biome.ore_item_names.some((name) => ctx.idFor(name) === itemId))
      .map((biome) => ({
        ...windowBase(),
        method: 'mine_drop' as const,
        locations: [biome.location_id],
        depth: biome.floors,
        biome_id: biome.id,
        requires: [],
        confidence: 'wiki' as const,
        prov: 'manual' as const,
      }))
  }

  // The fish trap set. The pool is *named* for the mechanism and nothing else
  // in the files states the join, so the window is an inference — drawn
  // hollow, like every other one. The trap itself is a placed spot, which is
  // the only spot_ids usage in the dataset so far.
  if (pool === 'fish_trap') {
    return [
      {
        ...windowBase(),
        method: 'fish_trap',
        locations: ['the_beach'],
        spot_ids: ['fish_trap'],
        requires: [],
        confidence: 'inferred',
        prov: 'game_files',
      },
    ]
  }

  // The dig-material set — sod, peat, clay, shards. Every dig site yields
  // them, which is inferred from the set's own name and their presence in the
  // common loot tier; where dig sites exist is stated per room. Inferred, so
  // the pins are hollow.
  if (pool === 'common_finds') {
    if (facts.digSiteLocations.length === 0) return []
    return [
      {
        ...windowBase(),
        method: 'dig_spot',
        locations: facts.digSiteLocations,
        requires: [],
        confidence: 'inferred',
        prov: 'game_files',
      },
    ]
  }

  // `oopart` and `mist`: no room names them, and nothing else in the files
  // places them. The wiki's answer (with its perk gates) stands.
  return []
}

/**
 * The facet's one-word answer to "how is this dug up", from the same pool
 * tables the windows come from. Pools with no facet meaning return nulls.
 */
export function artifactSource(
  ctx: BuildContext,
  itemId: string,
): { dig_source: DigSource; biome_id: string | null } {
  const facts = ctx.game?.artifactFacts
  const pool = facts?.poolByItem.get(itemId)
  if (facts === undefined || facts === null || pool === undefined) {
    return { dig_source: null, biome_id: null }
  }

  if (facts.locationsByPool.has(pool) || pool === 'oopart' || pool === 'common_finds') {
    return { dig_source: 'dig_spot', biome_id: null }
  }

  // The perfect ores and gems come out of mine rocks, not dig sites.
  if (pool === 'gems_of_mistria' || pool === 'metals_of_mistria') {
    return { dig_source: 'rock', biome_id: null }
  }

  const order = facts.minePoolOrder.get(pool)
  if (order !== undefined) {
    const byFloor = [...ctx.mines.biomes].sort((a, b) => a.floors.min - b.floors.min)
    return { dig_source: 'floor_range', biome_id: byFloor[order - 1]?.id ?? null }
  }

  if (pool === 'ritual') return { dig_source: 'floor_range', biome_id: null }
  if (pool === 'sunken') return { dig_source: 'diving', biome_id: null }
  if (pool === 'aquatic') return { dig_source: 'fishing', biome_id: null }
  if (pool === 'fish_trap') return { dig_source: 'fish_trap', biome_id: null }
  if (pool === 'mist') return { dig_source: 'mist_spot', biome_id: null }
  return { dig_source: null, biome_id: null }
}

type DigSource =
  | 'dig_spot'
  | 'rock'
  | 'floor_range'
  | 'diving'
  | 'panning'
  | 'fishing'
  | 'fish_trap'
  | 'mist_spot'
  | null

/** "water" -> "The Water Seal" — mechanical, matching the curated seal names. */
const sealDisplayName = (id: string): string =>
  `The ${id.charAt(0).toUpperCase()}${id.slice(1)} Seal`

/**
 * The seals dataset: each barrier, the quest that breaks it, and its price.
 *
 * Everything but the unlock joins is stated by the game outright. The joins
 * run on quest keys: a mine biome whose `unlock_quest` slugs to the seal's
 * quest is the biome this seal opens, and a location whose `unlock_requires`
 * names the quest is the place it opens. A seal that opens neither — the
 * final one — carries two nulls, which is the honest answer.
 */
export function buildSeals(ctx: BuildContext): Seal[] {
  const facts = ctx.game?.artifactFacts
  if (facts === undefined || facts === null) return []

  const locations = buildLocations(ctx)

  return facts.seals.map((seal) => {
    const mine = ctx.mines.biomes.find(
      (b) => b.unlock_quest !== null && toSnakeId(b.unlock_quest) === seal.questId,
    )
    const location = locations.find((l) =>
      l.unlock_requires.some((r) => r.type === 'quest' && r.key === seal.questId),
    )

    return {
      id: seal.id,
      name: sealDisplayName(seal.id),
      numeric_id: null,
      numeric_id_game_version: null,
      // The id is the game's own seal key, read from seals.toml.
      id_status: 'confirmed' as const,
      former_ids: [],
      also_known_as: seal.questName === null ? [] : [seal.questName],
      game_version: ctx.game?.version ?? null,
      version_added: null,
      confidence: 'verified' as const,
      prov: { '*': 'game_files' as const },
      data_gaps: seal.items.length === 0 ? ['required_items'] : [],
      icon_key: null,
      wiki_page: null,
      blurb: null,

      quest_id: seal.questId,
      required_items: seal.items,
      unlocks_mine_id: mine?.id ?? null,
      unlocks_location_id: location?.id ?? null,
    }
  })
}
