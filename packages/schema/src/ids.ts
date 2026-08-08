import { z } from 'zod'

/**
 * Internal snake_case name. This is the only key in the system.
 *
 * Numeric item IDs change between game patches and must never be used as a key
 * or a foreign key — see `numeric_id` on the envelope, which is a nullable,
 * version-stamped secondary field that nothing may reference.
 */
export const IdString = z
  .string()
  .min(1)
  .regex(
    /^[a-z0-9]+(?:_[a-z0-9]+)*$/,
    'must be lower snake_case with no leading/trailing underscore',
  )

export type IdString = z.infer<typeof IdString>

/** Combining marks, so NFKD-decomposed accents drop cleanly. */
const COMBINING_MARKS = /\p{M}+/gu
/** Apostrophes join rather than separate: "Balor's" -> "balors", not "balor_s". */
const APOSTROPHES = /['’ʼ]/g

/**
 * Slugify a display name into a candidate internal name.
 *
 * Written by hand rather than pulled from a dependency: this function's output
 * becomes a database key, and debugging a third party's unicode edge cases at
 * 1am is worse than owning twenty lines. Behaviour is pinned by tests.
 *
 * The result is *provisional* — it is a guess at what the game calls something.
 * Records keep `id_status: "provisional"` until the name is confirmed against
 * the archived v0.15.0 ID table or the game files themselves.
 */
export function toSnakeId(displayName: string): string {
  return displayName
    .normalize('NFKD')
    .replace(COMBINING_MARKS, '')
    .toLowerCase()
    .replace(/&/g, ' and ') // spell out before it becomes a separator
    .replace(APOSTROPHES, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
}

/** True if `value` is already a well-formed internal name. */
export function isValidId(value: string): boolean {
  return IdString.safeParse(value).success
}

/**
 * A reference to another record by id. Identical to `IdString` in shape, but the
 * alias makes referential-integrity checks greppable.
 */
export const IdRef = IdString
export type IdRef = z.infer<typeof IdRef>
