/**
 * Curated recipe sources: `curated/overrides/recipe_sources.json`.
 *
 * For recipes the game files grant nowhere — every scroll surface is
 * collected, so "no grant" is a checked fact — but the wiki states a real
 * mechanism: the statue scrolls in the sealed caves' golden boxes, the Big
 * Water Sprites perk. Injected before the skill-level fallback runs, so a
 * recipe with a curated stated source never also carries the inferred row.
 *
 * The file states only `method` and `source_id`; everything else is filled
 * here (`confidence: 'wiki'`), so the file cannot quietly become a hand-edit
 * of the generated tier. An id naming no built recipe throws; a `perk`
 * source_id is validated against the game's perk table because perks are not
 * a dataset refint can check.
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Recipe, RecipeSource } from '@mistria/schema'
import { CURATED_DIR } from './paths.js'

export interface CuratedRecipeSource {
  method: RecipeSource['method']
  source_id: string
  reason: string
  source: string
}

const OVERRIDES_PATH = join(CURATED_DIR, 'overrides', 'recipe_sources.json')

/** An absent file means "no curated sources" — the state before the mechanism existed. */
export async function readRecipeSourceOverrides(): Promise<Record<string, CuratedRecipeSource[]>> {
  let raw: string
  try {
    raw = await readFile(OVERRIDES_PATH, 'utf8')
  } catch {
    return {}
  }
  const parsed = JSON.parse(raw) as { sources?: Record<string, CuratedRecipeSource[]> }
  return parsed.sources ?? {}
}

export function applyRecipeSourceOverrides(
  recipes: Recipe[],
  overrides: Record<string, CuratedRecipeSource[]>,
  perkNameById: ReadonlyMap<string, string> | null,
): void {
  const byId = new Map(recipes.map((recipe) => [recipe.id, recipe]))
  for (const [id, entries] of Object.entries(overrides)) {
    const recipe = byId.get(id)
    if (recipe === undefined) {
      throw new Error(
        `curated/overrides/recipe_sources.json names "${id}", which is not a built recipe. ` +
          'Fix the id — a typo here silently sources nothing.',
      )
    }
    for (const entry of entries) {
      if (entry.method === 'perk' && perkNameById !== null && !perkNameById.has(entry.source_id)) {
        throw new Error(
          `curated/overrides/recipe_sources.json: "${id}" names perk "${entry.source_id}", ` +
            'which is not in the game files. Fix the id.',
        )
      }
      recipe.sources.push({
        method: entry.method,
        source_id: entry.source_id,
        stall_key: null,
        character_id: null,
        price: null,
        currency: 'tesserae',
        requires: [],
        confidence: 'wiki',
      })
    }
  }
}
