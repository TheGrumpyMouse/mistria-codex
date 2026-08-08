import { z } from 'zod'
import { IdString } from './ids.js'
import { Confidence, IdStatus, ProvenanceSource } from './primitives.js'

/**
 * Per-field provenance.
 *
 * A single `source` string on a record becomes a lie the moment enrichment
 * happens: a fish's sell value comes from the game files, its museum set from
 * the wiki, its locations from hand curation. `"*"` is the default source and
 * named keys override it.
 */
export const Provenance = z
  .record(z.string(), ProvenanceSource)
  .refine((p) => '*' in p, { message: 'provenance must define a default source under "*"' })
export type Provenance = z.infer<typeof Provenance>

/**
 * Fields every record carries, whatever its type.
 *
 * Two of these exist purely to survive a future migration and must be present
 * from the first commit:
 *
 * - `former_ids` — when the game files land and provisional slugs are replaced
 *   with real internal names, every user's saved museum progress references the
 *   old ids. Without this, a rename silently orphans their data. It is not
 *   retrofittable once people are using the app.
 * - `id_status` — records whether an id is a guess, a stale confirmation, or the
 *   real thing, so the size of that migration is always visible.
 */
export const Envelope = z.object({
  /** Internal snake_case name. The only key in the system. */
  id: IdString,
  name: z.string().min(1),

  /**
   * Numeric IDs change between patches. Version-stamped, nullable, and nothing
   * may reference it. Carried only for cross-checking against the game files.
   */
  numeric_id: z.number().int().nullable().default(null),
  numeric_id_game_version: z.string().nullable().default(null),

  id_status: IdStatus.default('provisional'),
  former_ids: z.array(IdString).default([]),

  /**
   * Other names this thing goes by. Searchable, never rendered as the name.
   *
   * `former_ids` covers a rename of the *key*; this covers the case where two
   * sources are both right and disagree. The wiki calls the dragon priestess
   * "Priestess" because that is what the game calls her until she introduces
   * herself, and the game files call her Seridia. Someone who has met her will
   * search for Seridia and must not get nothing back.
   *
   * Not a synonym list and not a place for guesses: an entry here means a source
   * uses that name for this record.
   */
  also_known_as: z.array(z.string()).default([]),

  /**
   * Names that are themselves a story reveal, split out of `also_known_as` so
   * the UI can keep them searchable without printing them next to the record.
   * "Seridia" is the canonical case: someone who has met her will search for
   * it and must find the Priestess, but the page saying "also known as
   * Seridia" spoils the reveal for everyone who hasn't. Which names qualify is
   * a human judgement, held in curated/vocab/spoilers.json.
   *
   * Optional, not defaulted: it is stamped centrally after the builders run,
   * and absent means the same thing as empty. A default here would make the
   * field required in every builder's output type for no gain.
   */
  spoiler_aliases: z.array(z.string()).optional(),

  /**
   * A record whose existence or identity is late-game story knowledge. The UI
   * veils these behind an explicit "show me" acknowledgement; nothing is ever
   * filtered out. Stamped centrally at build time from
   * curated/vocab/spoilers.json — a judgement call, so a curated file, not a
   * derivation. Optional for the same reason as `spoiler_aliases`: only
   * flagged records carry it at all.
   */
  spoiler: z.literal(true).optional(),

  /**
   * The wiki describes it; the 1.0 game does not ship it. The UI veils these
   * like spoilers, with "coming later" wording instead of a story warning.
   * Derived, not curated: an item is flagged when the wiki tags it Unreleased
   * AND the game's ItemId enum lacks it (game absence corroborates — a stale
   * wiki tag on something 1.0 shipped is ignored); a festival when the game's
   * own calendar marks it unimplemented. Optional like `spoiler`: only
   * flagged records carry the key.
   */
  unreleased: z.literal(true).optional(),

  /** The game version this record's data reflects. */
  game_version: z.string().nullable().default(null),
  /** The game version that introduced the thing itself, where known. */
  version_added: z.string().nullable().default(null),

  confidence: Confidence,
  prov: Provenance,

  /**
   * Field names we know we are missing. Drives the coverage report and the UI's
   * "we don't know this yet" badge.
   *
   * This is the mechanism that operationalises "do not invent data": explicit
   * ignorance is a first-class value, so there is never a reason to guess.
   */
  data_gaps: z.array(z.string()).default([]),

  /**
   * A string key, never a path to an image. No game art is committed to this
   * repo, and wiki images are never hotlinked — the UI resolves this key to its
   * own glyph.
   */
  icon_key: z.string().nullable().default(null),

  /** Wiki page title, for attribution and for re-verification. */
  wiki_page: z.string().nullable().default(null),

  /**
   * Our own words, or null. Defaults to null and most records should keep it.
   *
   * Never a copy of the in-game description, and never a paraphrase of one —
   * paraphrasing a short creative sentence still produces a derivative work.
   * State facts (where it is found, what it is for, what it is worth) or say
   * nothing. See docs/DATA-POLICY.md.
   */
  blurb: z.string().max(300).nullable().default(null),
})
export type Envelope = z.infer<typeof Envelope>

/** Compose an entity schema onto the common envelope. */
export function withEnvelope<T extends z.ZodRawShape>(shape: T) {
  return Envelope.extend(shape)
}
