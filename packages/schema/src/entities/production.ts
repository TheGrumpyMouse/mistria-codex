import { z } from 'zod'
import { Requirement } from '../availability.js'
import { withEnvelope } from '../envelope.js'
import { IdRef } from '../ids.js'
import { Currency, Quality, Season } from '../primitives.js'

export const Crop = withEnvelope({
  seed_item_id: IdRef.nullable().default(null),
  produce_item_id: IdRef.nullable().default(null),
  growth_days: z.number().int().nullable().default(null),
  /** Null means it does not regrow — a single harvest. */
  regrow_days: z.number().int().nullable().default(null),
  seasons: z.array(Season).default([]),
  is_trellis: z.boolean().nullable().default(null),
  yield: z.object({ min: z.number().int(), max: z.number().int() }).nullable().default(null),
  quality_enabled: z.boolean().nullable().default(null),
  greenhouse_ok: z.boolean().nullable().default(null),
  seed_sources: z.array(IdRef).default([]),
})
export type Crop = z.infer<typeof Crop>

/**
 * An ingredient slot. Either a specific item, or a tag ("any fish") where the
 * game accepts a category — never both.
 */
export const RecipeIngredient = z
  .object({
    item_id: IdRef.nullable().default(null),
    tag: z.string().nullable().default(null),
    quantity: z.number().int().min(1).default(1),
  })
  .refine((i) => (i.item_id === null) !== (i.tag === null), {
    message: 'an ingredient must specify exactly one of item_id or tag',
  })
export type RecipeIngredient = z.infer<typeof RecipeIngredient>

export const Recipe = withEnvelope({
  kind: z.enum(['cooking', 'crafting', 'blacksmithing', 'woodcrafting']),
  output: z.object({ item_id: IdRef, quantity: z.number().int().min(1).default(1) }),
  ingredients: z.array(RecipeIngredient).default([]),

  station: z.string().nullable().default(null),
  station_level: z.number().int().nullable().default(null),
  skill: z
    .object({ id: IdRef, level: z.number().int().min(0).max(60) })
    .nullable()
    .default(null),
  craft_minutes: z.number().int().nullable().default(null),

  unlock: z
    .object({
      method: z.enum(['shop', 'mail', 'quest', 'skill', 'festival', 'chest', 'story', 'default']),
      source_id: IdRef.nullable().default(null),
    })
    .nullable()
    .default(null),

  effects: z
    .object({
      health: z.number().int().nullable().default(null),
      stamina: z.number().int().nullable().default(null),
      mana: z.number().int().nullable().default(null),
      buffs: z.array(z.string()).default([]),
    })
    .nullable()
    .default(null),
})
export type Recipe = z.infer<typeof Recipe>

export const Animal = withEnvelope({
  building: z.enum(['coop', 'barn']),
  matures_days: z.number().int().nullable().default(null),
  products: z
    .array(
      z.object({
        item_id: IdRef,
        hearts_required: z.number().int().min(0).max(10).nullable().default(null),
        quality: Quality.nullable().default(null),
      }),
    )
    .default([]),
  breeding: z
    .object({
      treat_item_id: IdRef.nullable().default(null),
      gestation_days: z.number().int().nullable().default(null),
    })
    .nullable()
    .default(null),
  feed_item_ids: z.array(IdRef).default([]),
  purchase: z
    .object({ price: z.number().int(), currency: Currency.default('tesserae'), shop_id: IdRef })
    .nullable()
    .default(null),
})
export type Animal = z.infer<typeof Animal>

export const Building = withEnvelope({
  kind: z.enum([
    'coop',
    'barn',
    'greenhouse',
    'kitchen',
    'crafting_station',
    'mill',
    'home_upgrade',
    'farm_expansion',
    'other',
  ]),
  tiers: z
    .array(
      z.object({
        level: z.number().int().min(1),
        cost: z.object({
          tesserae: z.number().int().nullable().default(null),
          materials: z
            .array(z.object({ item_id: IdRef, quantity: z.number().int().min(1) }))
            .default([]),
        }),
        capacity: z.number().int().nullable().default(null),
        requires: z.array(Requirement).default([]),
      }),
    )
    .default([]),
  vendor_shop_id: IdRef.nullable().default(null),
  placeable_on_farm: z.boolean().nullable().default(null),
})
export type Building = z.infer<typeof Building>
