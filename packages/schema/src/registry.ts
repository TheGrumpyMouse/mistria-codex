import type { z } from 'zod'
import { Character, GiftPrefs, Schedule } from './entities/character.js'
import { ArtifactFacet, BugFacet, FishFacet, ForageableFacet, Item } from './entities/item.js'
import { Animal, Building, Crop, Recipe } from './entities/production.js'
import { Festival, MuseumSet, Quest, Shop, Skill } from './entities/progression.js'
import { Location, MapRegion, MineBiome, Monster, Spot } from './entities/world.js'

export interface DatasetSpec {
  /** Path relative to `data/`, and the basename used for `build/schema/`. */
  readonly file: string
  /** Schema for a single record. Every dataset file is a JSON array of these. */
  readonly schema: z.ZodType
  /** Field holding the record's own key, for duplicate detection. */
  readonly key: string
  readonly description: string
}

/**
 * The full set of dataset files, and the single place that decides what exists.
 *
 * Both the JSON Schema emitter and the validator iterate this, so a new entity
 * type is added in exactly one place and cannot be half-registered.
 */
export const DATASETS = {
  items: {
    file: 'items.json',
    schema: Item,
    key: 'id',
    description: 'Every inventory item. The canonical table; facets reference it.',
  },
  fish: {
    file: 'facets/fish.json',
    schema: FishFacet,
    key: 'item_id',
    description: 'Fish-only fields, keyed to an item.',
  },
  bugs: {
    file: 'facets/bugs.json',
    schema: BugFacet,
    key: 'item_id',
    description: 'Bug-only fields, keyed to an item.',
  },
  forageables: {
    file: 'facets/forageables.json',
    schema: ForageableFacet,
    key: 'item_id',
    description: 'Forageable-only fields, keyed to an item.',
  },
  artifacts: {
    file: 'facets/artifacts.json',
    schema: ArtifactFacet,
    key: 'item_id',
    description: 'Artifact-only fields, keyed to an item.',
  },
  crops: { file: 'crops.json', schema: Crop, key: 'id', description: 'Crops, seeds, growth.' },
  recipes: {
    file: 'recipes.json',
    schema: Recipe,
    key: 'id',
    description: 'Cooking, crafting, blacksmithing and woodcrafting recipes.',
  },
  characters: {
    file: 'characters.json',
    schema: Character,
    key: 'id',
    description: 'Villagers, vendors and romance candidates.',
  },
  gift_prefs: {
    file: 'gift_prefs.json',
    schema: GiftPrefs,
    key: 'character_id',
    description: 'Gift preferences, one record per character.',
  },
  schedules: {
    file: 'schedules.json',
    schema: Schedule,
    key: 'character_id',
    description: 'NPC daily schedules as priority-ordered overrides.',
  },
  locations: {
    file: 'locations.json',
    schema: Location,
    key: 'id',
    description: 'Concrete places on a map, with pin anchors.',
  },
  maps: {
    file: 'maps.json',
    schema: MapRegion,
    key: 'id',
    description: 'Hand-drawn region maps. No game art.',
  },
  spots: {
    file: 'spots.json',
    schema: Spot,
    key: 'id',
    description: 'Fine-grained points: dig spots, dive holes, forage patches.',
  },
  museum_sets: {
    file: 'museum_sets.json',
    schema: MuseumSet,
    key: 'id',
    description: 'Museum donation sets across the four wings.',
  },
  festivals: {
    file: 'festivals.json',
    schema: Festival,
    key: 'id',
    description: 'Seasonal festivals.',
  },
  quests: { file: 'quests.json', schema: Quest, key: 'id', description: 'Quests of every kind.' },
  shops: {
    file: 'shops.json',
    schema: Shop,
    key: 'id',
    description: 'Shops, opening hours and stock.',
  },
  skills: {
    file: 'skills.json',
    schema: Skill,
    key: 'id',
    description: 'The nine skills and their perks.',
  },
  animals: {
    file: 'animals.json',
    schema: Animal,
    key: 'id',
    description: 'Coop and barn animals.',
  },
  buildings: {
    file: 'buildings.json',
    schema: Building,
    key: 'id',
    description: 'Farm buildings and home upgrades.',
  },
  mines: {
    file: 'mines.json',
    schema: MineBiome,
    key: 'id',
    description: 'Mine biomes and their floor ranges.',
  },
  monsters: {
    file: 'monsters.json',
    schema: Monster,
    key: 'id',
    description: 'Mine monsters and drop tables.',
  },
} as const satisfies Record<string, DatasetSpec>

export type DatasetName = keyof typeof DATASETS
export const DATASET_NAMES = Object.keys(DATASETS) as DatasetName[]
