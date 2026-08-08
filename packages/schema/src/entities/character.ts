import { z } from 'zod'
import { GameDate, Requirement } from '../availability.js'
import { withEnvelope } from '../envelope.js'
import { IdRef } from '../ids.js'
import { DayOfWeek, GiftInterest, Season, Weather } from '../primitives.js'
import { TimeOfDay } from '../time.js'

export const Character = withEnvelope({
  birthday: z
    .object({ season: Season, day: z.number().int().min(1).max(28) })
    .nullable()
    .default(null),
  romanceable: z.boolean().nullable().default(null),
  species: z.string().nullable().default(null),
  gender: z.string().nullable().default(null),
  occupation: z.string().nullable().default(null),
  affiliation: z.string().nullable().default(null),

  home_location_id: IdRef.nullable().default(null),
  family: z
    .array(z.object({ relation: z.string(), character_id: IdRef.nullable().default(null) }))
    .default([]),

  /** Only romance candidates have these. Hearts are 2/4/6/8/10. */
  heart_events: z
    .array(
      z.object({
        hearts: z.number().int().min(1).max(10),
        trigger: z.string().nullable().default(null),
        requires: z.array(Requirement).default([]),
      }),
    )
    .default([]),

  is_vendor: z.boolean().default(false),
  shop_id: IdRef.nullable().default(null),
  schedule_id: IdRef.nullable().default(null),
})
export type Character = z.infer<typeof Character>

/**
 * Gift preferences, one record per character.
 *
 * The wiki's GiftPrefs table is 5,328 flat rows; collapsing to ~56 records keeps
 * the shipped file around 40KB. The build also emits a reverse index
 * (item -> who loves it) because the item detail screen needs that direction.
 */
export const GiftPrefs = z.object({
  character_id: IdRef,
  prefs: z.record(GiftInterest, z.array(IdRef)),
})
export type GiftPrefs = z.infer<typeof GiftPrefs>

/**
 * One block of an NPC's day: where they are, from when to when.
 * `x`/`y` are optional pin overrides in the location's map coordinate space.
 *
 * `[from, to)` — half open, and **it never wraps**. A stint that runs past
 * midnight is split by the build into two blocks, the first ending at the
 * sentinel `"00:00"`, which in `to` means end of day rather than the start of
 * one. So `end = to === "00:00" ? 1440 : toMinutes(to)`, and no runtime code
 * ever compares `from > to` to work out what an author meant.
 *
 * Blocks do not have to cover the whole day. A hole is an honest answer: it is
 * where the source named a place we could not resolve, and "unknown" beats
 * stretching the previous block over it.
 */
export const ScheduleBlock = z.object({
  from: TimeOfDay,
  to: TimeOfDay,
  location_id: IdRef,
  x: z.number().nullable().default(null),
  y: z.number().nullable().default(null),
  activity_key: z.string().nullable().default(null),
})
export type ScheduleBlock = z.infer<typeof ScheduleBlock>

/**
 * An NPC's schedule as **priority-ordered overrides, first match wins entirely**
 * — which is how the game itself resolves them.
 *
 * The naive model (4 seasons x 7 days x 6 weather = 168 rows per NPC, ~9,400
 * rows across the cast) is not a thing anyone finishes by hand. Overrides cut
 * that by an order of magnitude: author the default weekday, then only the cases
 * that differ.
 *
 * An omitted field in `when` is unconstrained. Characters with no data carry
 * `entries: []` and `data_gaps: ["schedule"]` rather than blocking a release.
 *
 * **Lower `priority` is checked first.** Entries are emitted already sorted, so
 * a consumer takes the first whose `when` matches and stops. That is what makes
 * "Saturday, after Repair the Bridge is complete" expressible without a
 * negation operator: the gated entry sits above the ungated one, and a save
 * that has not finished the quest simply falls through to it.
 */
export const Schedule = z.object({
  character_id: IdRef,
  entries: z
    .array(
      z.object({
        priority: z.number().int(),
        label: z.string().min(1),
        when: z.object({
          seasons: z.array(Season).nullable().default(null),
          days: z.array(DayOfWeek).nullable().default(null),
          weather: z.array(Weather).nullable().default(null),
          dates: z.array(GameDate).nullable().default(null),
          requires: z.array(Requirement).default([]),
        }),
        blocks: z.array(ScheduleBlock).min(1),
      }),
    )
    .default([]),
  data_gaps: z.array(z.string()).default([]),
})
export type Schedule = z.infer<typeof Schedule>
