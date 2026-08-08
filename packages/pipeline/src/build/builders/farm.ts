import type { Animal, Building, Requirement } from '@mistria/schema'

import type { AnimalInputs, BuildContext, BuildingInputs } from '../context.js'

/**
 * Build the farm animals and the buildings that house them.
 *
 * Both are hand-authored (see `curated/entities/`), so this builder's job is
 * resolution rather than parsing: turn display names into item ids, and refuse
 * to emit a reference to an item that does not exist. A missing name becomes a
 * data gap on the record instead of a dangling id.
 */

/** Resolve display names to item ids, reporting the ones that don't exist. */
function itemIds(
  ctx: BuildContext,
  names: string[],
  owner: string,
): { ids: string[]; missing: string[] } {
  const ids: string[] = []
  const missing: string[] = []
  for (const name of names) {
    if (ctx.itemByName.has(name)) ids.push(ctx.idFor(name))
    else {
      missing.push(name)
      ctx.resolver.recordUnresolved(name, 'curated_item', owner)
    }
  }
  return { ids, missing }
}

export function buildAnimals(ctx: BuildContext): Animal[] {
  const input: AnimalInputs = ctx.animals

  return input.animals.map((animal) => {
    const gaps: string[] = []
    const owner = `animal:${animal.id}`

    const base = itemIds(ctx, animal.products, owner)
    const golden = itemIds(ctx, animal.goldenProducts, owner)
    const feed = itemIds(ctx, input.feed[animal.building], owner)
    const treat = itemIds(ctx, [animal.treat], owner)

    if ([...base.missing, ...golden.missing, ...feed.missing, ...treat.missing].length > 0) {
      gaps.push('products')
    }

    const products = [
      ...base.ids.map((id) => ({ item_id: id, hearts_required: null, quality: null })),
      // 8 hearts is where a golden product becomes possible; 10 makes it
      // certain. The schema holds one threshold, and the one a player plans
      // around is the first.
      ...golden.ids.map((id) => ({
        item_id: id,
        hearts_required: 8,
        quality: 'golden' as const,
      })),
    ]

    return {
      id: animal.id,
      name: animal.name,
      numeric_id: null,
      numeric_id_game_version: null,
      id_status: 'provisional' as const,
      former_ids: [],
      also_known_as: [],
      game_version: null,
      version_added: null,
      confidence: 'wiki' as const,
      prov: { '*': 'manual' as const },
      data_gaps: gaps,
      icon_key: `animal/${animal.id}`,
      wiki_page: animal.wiki_page,
      blurb: null,

      building: animal.building,
      matures_days: input.maturesDays[animal.building],
      products,
      breeding: {
        treat_item_id: treat.ids[0] ?? null,
        gestation_days: input.gestationDays,
      },
      feed_item_ids: feed.ids,
      purchase: { price: animal.price, currency: 'tesserae' as const, shop_id: input.shopId },
    }
  })
}

export function buildBuildings(ctx: BuildContext): Building[] {
  const input: BuildingInputs = ctx.buildings

  return input.buildings.map((building) => {
    const gaps: string[] = []
    const owner = `building:${building.id}`

    const tiers = building.tiers.map((tier) => {
      const materials: { item_id: string; quantity: number }[] = []
      for (const material of tier.materials) {
        if (!ctx.itemByName.has(material.item)) {
          ctx.resolver.recordUnresolved(material.item, 'curated_item', owner)
          gaps.push('materials')
          continue
        }
        materials.push({ item_id: ctx.idFor(material.item), quantity: material.quantity })
      }

      return {
        level: tier.level,
        cost: { tesserae: tier.tesserae, materials },
        capacity: tier.capacity,
        requires: tier.requires as Requirement[],
      }
    })

    // A building with no tiers is one whose cost table we have not read yet.
    // Recording it empty is what lets a player learn the Mill exists.
    if (tiers.length === 0) gaps.push('tiers')

    return {
      id: building.id,
      name: building.name,
      numeric_id: null,
      numeric_id_game_version: null,
      id_status: 'provisional' as const,
      former_ids: [],
      also_known_as: [],
      game_version: null,
      version_added: null,
      confidence: 'wiki' as const,
      prov: { '*': 'manual' as const },
      data_gaps: [...new Set(gaps)],
      icon_key: `building/${building.kind}`,
      wiki_page: building.wiki_page,
      blurb: null,

      kind: building.kind,
      tiers,
      vendor_shop_id: building.vendor,
      placeable_on_farm: building.placeable_on_farm,
    }
  })
}
