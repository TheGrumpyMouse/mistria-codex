import type { ArtifactFacet, BugFacet, ForageableFacet, Rarity, Recipe } from '@mistria/schema'
import { toInteger, toTokens } from '../../normalise/wikitext.js'
import { type BuildContext, name as itemName, text } from '../context.js'
import { artifactSource } from './artifacts.js'

const RARITIES: Record<string, Rarity> = {
  common: 'common',
  uncommon: 'uncommon',
  rare: 'rare',
  legendary: 'legendary',
}

const CRAFT_KINDS: Record<string, Recipe['kind']> = {
  food: 'cooking',
  cooking: 'cooking',
  crafting: 'crafting',
  blacksmithing: 'blacksmithing',
  woodcrafting: 'woodcrafting',
  furniture: 'woodcrafting',
}

/**
 * Recipes, with ingredients resolved from the separate `Ingredients` table.
 *
 * `Recipes.ingredients` is rendered wikitext ("Apple (1)"); `Ingredients` is the
 * same data normalised as one row per ingredient with a real amount. Using the
 * latter avoids parsing quantities out of display text.
 */
export function buildRecipes(ctx: BuildContext): Recipe[] {
  const byResult = new Map<string, { item: string; amount: number }[]>()
  for (const row of ctx.ingredients) {
    // Both are display names joined against itemByName, so they must be read the
    // same way that map was keyed — decoded, not wikitext-stripped.
    const result = itemName(row.resultItem)
    const ingredient = itemName(row.ingredient)
    if (result === '' || ingredient === '') continue
    const list = byResult.get(result) ?? []
    list.push({ item: ingredient, amount: toInteger(row.amount) ?? 1 })
    byResult.set(result, list)
  }

  return ctx.recipes.map((row) => {
    const outputName = itemName(row.itemName)
    const id = ctx.idFor(outputName)
    const gaps: string[] = []

    const rawIngredients = byResult.get(outputName) ?? []
    const ingredients = rawIngredients
      .filter((i) => ctx.itemByName.has(i.item))
      .map((i) => ({ item_id: ctx.idFor(i.item), tag: null, quantity: Math.max(i.amount, 1) }))

    if (rawIngredients.length === 0) gaps.push('ingredients')
    if (ingredients.length !== rawIngredients.length) gaps.push('unresolved_ingredients')
    if (!ctx.itemByName.has(outputName)) gaps.push('output_item')

    const kind = CRAFT_KINDS[text(row.craftType).toLowerCase()] ?? 'crafting'
    const skillLevel = toInteger(row.skillLevel)

    return {
      id,
      name: outputName,
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
      icon_key: `recipe/${id}`,
      wiki_page: outputName.replace(/ /g, '_'),
      blurb: null,

      kind,
      output: { item_id: id, quantity: 1 },
      ingredients,
      station: text(row.craftType) || null,
      station_level: toInteger(row.workbenchLevel),
      // The skill is implied by craftType rather than named, so the id is left
      // for D3 when the skills table lands. Recording the level alone would
      // mean a requirement that points at nothing.
      skill: null,
      craft_minutes: toInteger(row.time),
      unlock: toTokens(row.recipeSource).length > 0 ? { method: 'shop', source_id: null } : null,
      effects: null,
      ...(skillLevel === null ? {} : {}),
    }
  })
}

export function buildBugFacets(ctx: BuildContext): BugFacet[] {
  return ctx.bugs.map((row) => {
    const condition = text(row.spawnCondition)
    return {
      item_id: ctx.idFor(itemName(row.name)),
      // The wiki phrases these as instructions ("Breaking rocks"), so they are
      // kept as a key for the UI to render rather than mapped to a surface we'd
      // be guessing at.
      spawn_surface: null,
      spawn_condition_key: condition === '' ? null : condition,
      rarity: RARITIES[text(row.rarity).toLowerCase()] ?? null,
    }
  })
}

export function buildArtifactFacets(ctx: BuildContext): ArtifactFacet[] {
  return ctx.artifacts.map((row) => {
    const id = ctx.idFor(itemName(row.name))
    // From the game's pool tables where the extract has them; two nulls where
    // it does not, which is the state every clone was in before the artifact
    // extraction landed.
    const source = artifactSource(ctx, id)
    return {
      item_id: id,
      dig_source: source.dig_source,
      biome_id: source.biome_id,
      rarity:
        ctx.game?.artifactFacts?.rarityByItem.get(id) ??
        RARITIES[text(row.rarity).toLowerCase()] ??
        null,
    }
  })
}

/**
 * Forageables are a tag, not a table.
 *
 * The wiki has no Forageables Cargo table, but tags every forageable item —
 * `Forageable`, `Mines Forageable`, `Bush Forageable`. That is enough to make
 * the category real; the facet fields (respawn days, what it spawns on) have no
 * source yet and are gaps.
 */
export function buildForageableFacets(ctx: BuildContext): ForageableFacet[] {
  const facets: ForageableFacet[] = []

  for (const row of ctx.items) {
    const tags = toTokens(row.tags).map((t) => t.toLowerCase())
    if (!tags.some((t) => t.endsWith('forageable'))) continue

    facets.push({
      item_id: ctx.idFor(itemName(row.itemName)),
      respawn_days: null,
      spawns_on: tags.includes('bush forageable')
        ? 'bush'
        : tags.includes('mines forageable')
          ? 'floor'
          : null,
      yields_seed_item_id: null,
    })
  }

  return facets
}
