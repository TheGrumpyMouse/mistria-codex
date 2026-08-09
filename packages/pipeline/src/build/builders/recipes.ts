import type { ArtifactFacet, BugFacet, ForageableFacet, Rarity, Recipe } from '@mistria/schema'
import { consola } from 'consola'
import { toInteger, toTokens } from '../../normalise/wikitext.js'
import { type BuildContext, name as itemName, text } from '../context.js'
import { rarityFor } from '../game-facts.js'
import { artifactSource } from './artifacts.js'
import { isMuseumRosterRow } from './fish-crops.js'
import type { FurnitureCollapse } from './furniture.js'
import type { GrantIndex } from './grants.js'

const RARITIES: Record<string, Rarity> = {
  common: 'common',
  uncommon: 'uncommon',
  rare: 'rare',
  legendary: 'legendary',
}

/**
 * craftType -> kind, and the skill each craftType trains.
 *
 * Food and Blacksmith name a skill both sources agree on; Milling and Refinery
 * are stations, not skills, so their recipes carry a level-less `skill: null`
 * rather than a guessed owner.
 */
const CRAFT_KINDS: Record<string, Recipe['kind']> = {
  food: 'cooking',
  cooking: 'cooking',
  crafting: 'crafting',
  blacksmith: 'blacksmithing',
  blacksmithing: 'blacksmithing',
  milling: 'crafting',
  refinery: 'crafting',
  woodcrafting: 'woodcrafting',
  furniture: 'woodcrafting',
}

const SKILL_BY_KIND: Partial<Record<Recipe['kind'], string>> = {
  cooking: 'cooking',
  blacksmithing: 'blacksmithing',
  woodcrafting: 'woodcrafting',
}

/** Which game source file makes which kind of recipe. */
function kindForGameFile(file: string): Recipe['kind'] {
  if (file.startsWith('furniture/')) return 'woodcrafting'
  if (file.includes('cooked_dishes')) return 'cooking'
  if (file.includes('blacksmithing') || file.includes('armor')) return 'blacksmithing'
  return 'crafting'
}

function stationForGameFile(file: string): string | null {
  if (file.includes('cooked_dishes')) return 'Food'
  if (file.includes('blacksmithing') || file.includes('armor')) return 'Blacksmith'
  if (file.includes('mill')) return 'Milling'
  if (file.includes('materials')) return 'Refinery'
  return null
}

/**
 * Recipes — from the game files where this clone has them, from the wiki's
 * `Ingredients` table otherwise.
 *
 * The game path is preferred because it needs no resolution at all: every
 * item's `recipe` array is internal ids and counts, verified 265/265 against
 * the dataset. The wiki path joins two Cargo tables on display names, which
 * works but is one rename away from a silent miss.
 *
 * `itemIds` is the set of item records actually being shipped this build.
 * Both outputs and ingredients are gated on it, so a recipe can never point
 * at a record that does not exist (refint would fail the build).
 *
 * Furniture goes through the collapse: colour variants share one record, so
 * only each group's canonical member emits a recipe, addressed to the
 * collapsed id. Without the collapse (a clone whose extract predates it)
 * furniture recipes are held back and counted, exactly as before.
 */
export function buildRecipes(
  ctx: BuildContext,
  itemIds: Set<string>,
  furniture?: FurnitureCollapse,
  grants?: GrantIndex,
): Recipe[] {
  const wiki = wikiRecipes(ctx)
  const game = ctx.game
  if (game === null) return withFallbackSources(wiki.sort((a, b) => a.id.localeCompare(b.id)))

  const wikiById = new Map(wiki.map((r) => [r.id, r]))
  const out: Recipe[] = []
  let variantRecipes = 0
  let unknownOutput = 0

  for (const item of game.itemById.values()) {
    if (item.recipe.length === 0) continue
    const kind = kindForGameFile(item.file)

    let outputId = item.id
    if (item.file.startsWith('furniture/')) {
      const shippedId = furniture?.shippedIdByGameId.get(item.id)
      const canonical =
        shippedId === undefined ? undefined : furniture?.canonicalById.get(shippedId)
      if (shippedId === undefined || canonical === undefined || canonical.id !== item.id) {
        // A colour variant of a recipe already emitted, or furniture not
        // collapsed this build. Either way: one recipe per product.
        variantRecipes += 1
        continue
      }
      outputId = shippedId
    }

    if (!itemIds.has(outputId)) {
      unknownOutput += 1
      continue
    }

    const ingredients = item.recipe
      .filter((c) => itemIds.has(c.item))
      .map((c) => ({ item_id: c.item, tag: null, quantity: Math.max(c.count, 1) }))
    const gaps: string[] = []
    if (ingredients.length !== item.recipe.length) gaps.push('unresolved_ingredients')

    const fromWiki = wikiById.get(outputId)
    const skillId = SKILL_BY_KIND[kind]
    const level = item.crafting_level ?? fromWiki?.skill?.level ?? null

    out.push({
      id: outputId,
      name: item.name ?? fromWiki?.name ?? outputId,
      numeric_id: null,
      numeric_id_game_version: null,
      id_status: 'confirmed',
      former_ids: [],
      also_known_as: [],
      game_version: game.version,
      version_added: null,
      confidence: 'verified',
      prov: { '*': 'game_files' },
      data_gaps: gaps,
      icon_key: `recipe/${outputId}`,
      wiki_page: fromWiki?.wiki_page ?? null,
      blurb: null,

      kind,
      output: { item_id: outputId, quantity: 1 },
      ingredients,
      station: stationForGameFile(item.file) ?? fromWiki?.station ?? null,
      station_level:
        kind === 'cooking'
          ? (item.kitchen_tier ?? fromWiki?.station_level ?? null)
          : (fromWiki?.station_level ?? null),
      skill: skillId !== undefined && level !== null ? { id: skillId, level } : null,
      craft_minutes: item.craft_minutes ?? fromWiki?.craft_minutes ?? null,
      sources: grants?.recipeSources.get(outputId) ?? [],
      effects: null,
    })
  }

  if (variantRecipes > 0 || unknownOutput > 0) {
    consola.info(
      `recipes: ${variantRecipes} colour-variant duplicates collapsed and ` +
        `${unknownOutput} with un-ingested outputs held back`,
    )
  }

  // Wiki-only outputs the game files somehow lack (today: none — the game is
  // a strict superset). Kept rather than dropped, so a clone whose extract
  // predates a wiki addition still ships the wiki's answer.
  const gameIds = new Set(out.map((r) => r.id))
  for (const row of wiki) {
    if (!gameIds.has(row.id) && itemIds.has(row.output.item_id)) out.push(row)
  }

  return withLevelFallback(out.sort((a, b) => a.id.localeCompare(b.id)))
}

/**
 * The answer for a recipe no grant names: the crafting level, and nothing else.
 *
 * Every `recipe_scroll` and `crafting_scroll` in the game is collected, so a
 * recipe with no grant anywhere and a stated level is gated by that level —
 * there is nothing else left to gate it. That is a **structural deduction, not
 * a stated fact**, which is why it ships `confidence: 'inferred'` and must
 * never render like a source the game names. Four recipes have neither a grant
 * nor a level (the apiary, the terrarium, the engagement ring and the giant
 * essence stone, each handed over by a story beat nothing models yet); those
 * say so in `data_gaps` rather than inventing a third answer.
 */
function withLevelFallback(recipes: Recipe[]): Recipe[] {
  let inferred = 0
  let unknown = 0

  const out = recipes.map((recipe): Recipe => {
    if (recipe.sources.length > 0) return recipe
    if (recipe.skill === null) {
      unknown += 1
      return { ...recipe, data_gaps: [...new Set([...recipe.data_gaps, 'sources'])] }
    }
    inferred += 1
    return {
      ...recipe,
      sources: [
        {
          method: 'skill_level',
          source_id: null,
          character_id: null,
          price: null,
          currency: 'tesserae',
          requires: [{ type: 'skill', key: recipe.skill.id, op: '>=', value: recipe.skill.level }],
          confidence: 'inferred',
        },
      ],
    }
  })

  const stated = out.length - inferred - unknown
  consola.info(
    `recipes: ${stated} with a stated source · ${inferred} inferred from a crafting level · ` +
      `${unknown} with neither`,
  )
  return out
}

/**
 * The no-extract path's sources.
 *
 * A clone with no `sources/game/` has only the wiki's `recipeSource` cell,
 * which states *that* a source exists without stating which. `wikiRecipes`
 * already turns a non-empty cell into a bare `shop` source; this only adds the
 * level fallback for the rest, so the two paths agree on shape.
 */
const withFallbackSources = (recipes: Recipe[]): Recipe[] => withLevelFallback(recipes)

/**
 * The wiki path: `Recipes` joined to `Ingredients` on the result's display
 * name. The `ingredient` cell is wikitext (`[[File:apple.png|…]] [[Apple]]`),
 * so it goes through the stripper — reading it as a bare name was the bug
 * that left all 282 recipes ingredient-less for five milestones.
 */
function wikiRecipes(ctx: BuildContext): Recipe[] {
  const byResult = new Map<string, { item: string; amount: number }[]>()
  for (const row of ctx.ingredients) {
    const result = itemName(row.resultItem)
    const ingredient = text(row.ingredient)
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
    const skillId = SKILL_BY_KIND[kind]
    const skillLevel = toInteger(row.skillLevel)

    return {
      id,
      name: outputName,
      numeric_id: null,
      numeric_id_game_version: null,
      id_status: 'provisional' as const,
      former_ids: [],
      also_known_as: [],
      game_version: null,
      version_added: null,
      confidence: 'wiki' as const,
      prov: { '*': 'wiki_cargo' as const },
      data_gaps: gaps,
      icon_key: `recipe/${id}`,
      wiki_page: outputName.replace(/ /g, '_'),
      blurb: null,

      kind,
      output: { item_id: id, quantity: 1 },
      ingredients,
      station: text(row.craftType) || null,
      station_level: toInteger(row.workbenchLevel),
      skill:
        skillId !== undefined && skillLevel !== null ? { id: skillId, level: skillLevel } : null,
      craft_minutes: toInteger(row.time),
      // The wiki states *that* there is a source without stating which: the
      // cell is wikitext naming a stall, a mine, a quest or "Available From
      // Start", and reducing it to a boolean is what made 163 recipes claim
      // "shop" for five milestones. It survives only as the no-extract
      // fallback, and only because a bare "somewhere sells it" still beats
      // silence — `sources/game/unlocks.json` is what actually answers this.
      sources:
        toTokens(row.recipeSource).length > 0
          ? [
              {
                method: 'shop' as const,
                source_id: null,
                character_id: null,
                price: null,
                currency: 'tesserae' as const,
                requires: [],
                confidence: 'wiki' as const,
              },
            ]
          : [],
      effects: null,
    }
  })
}

export function buildBugFacets(ctx: BuildContext): BugFacet[] {
  // The same skip as itemInputs: an apiary/terrarium product listed for its
  // museum set is not a bug, and must not appear on the bug facet.
  return ctx.bugs
    .filter((row) => !isMuseumRosterRow(ctx, row))
    .map((row) => {
      const condition = text(row.spawnCondition)
      const id = ctx.idFor(itemName(row.name))
      return {
        item_id: id,
        // The wiki phrases these as instructions ("Breaking rocks"), so they are
        // kept as a key for the UI to render rather than mapped to a surface we'd
        // be guessing at.
        spawn_surface: null,
        spawn_condition_key: condition === '' ? null : condition,
        // The game's own grade wins, as it already does on the item record —
        // these two disagreed for four bugs purely because the facet had
        // never been given the game's answer. It also grades six bugs
        // `very_rare`, which maps to `epic`; the wiki has no such step.
        rarity:
          rarityFor(ctx.game?.bugById.get(id)?.rarity ?? null) ??
          RARITIES[text(row.rarity).toLowerCase()] ??
          null,
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
