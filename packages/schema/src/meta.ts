import { z } from 'zod'
import { ProvenanceSource } from './primitives.js'

/**
 * Bumped when record *shapes* change, not when their contents do.
 *
 * The client refuses to parse a bundle whose schemaVersion it doesn't know, and
 * the sync Worker rejects a `PUT` carrying a lower one, so a stale device can't
 * re-inject ids that a migration has already retired.
 */
export const SCHEMA_VERSION = 1

/**
 * `meta.json` — the manifest the app fetches first, and the only file at a
 * stable URL.
 *
 * GitHub Pages sends fixed response headers and cannot set `Cache-Control` per
 * path, so versioning lives in the URL (`data/v/<dataVersion>/...`) and the
 * service worker owns all cache policy. This file is what tells it which version
 * is current.
 */
export const Meta = z.object({
  /**
   * sha256 over the sorted (filename, fileSha256) pairs, truncated.
   * Content-addressed and deterministic: a rebuild with no data change produces
   * the same version, so no spurious service-worker update and no re-download.
   */
  dataVersion: z.string().min(6),

  /**
   * Bumped when record *shapes* change, separately from content. Lets an old
   * cached bundle meeting new data refuse to parse and force a reload rather
   * than rendering garbage.
   */
  schemaVersion: z.number().int().min(1),

  builtAt: z.string(),
  gameVersion: z.string().nullable().default(null),
  commit: z.string().nullable().default(null),

  /**
   * Where the versioned files live. Comes from here rather than being hardcoded
   * because Pages serves from `/<repo>/` unless a custom domain is attached —
   * a hardcoded `/data/...` works in dev and breaks in production.
   */
  basePath: z.string(),

  files: z.record(
    z.string(),
    z.object({
      bytes: z.number().int(),
      sha256: z.string(),
      records: z.number().int().nullable().default(null),
    }),
  ),

  /** Tier-1 precache list: small, mandatory, and the app cannot render without it. */
  precache: z.array(z.string()).default([]),

  /**
   * The packed game-art atlases, if any have been built.
   *
   * Sheets are content-addressed in their own filenames, so they can be cached
   * forever and never go stale — the only cache control GitHub Pages leaves us,
   * since it sends fixed response headers. `version` exists so the service
   * worker has one value to compare, the way `dataVersion` works for the data.
   *
   * **Absent is a valid state.** A clone with no `assets/game/` builds and runs;
   * every icon falls back to the glyph the app draws itself.
   */
  assets: z
    .object({
      version: z.string(),
      /**
       * Sheet filenames, relative to `assets/game/`.
       *
       * **Tier two, never tier one.** The app renders completely without them —
       * every icon falls back to a drawn glyph — so putting them behind
       * Workbox's all-or-nothing precache would let a single failed sheet stop
       * the service worker installing, trading a working offline app for
       * prettier icons. They are warmed opportunistically instead.
       */
      sheets: z.array(z.string()).default([]),
      /** Portraits, lazily cached — large, and looked at one at a time. */
      portraits: z.number().int().default(0),
      bytes: z.number().int().default(0),
    })
    .nullable()
    .default(null),

  counts: z.record(z.string(), z.number().int()).default({}),

  /** Per-category fill rates, so gaps are visible in the app, not just in CI. */
  coverage: z
    .record(
      z.string(),
      z.object({
        expected: z.number().int().nullable().default(null),
        have: z.number().int(),
        fields: z.record(z.string(), z.number().int()).default({}),
      }),
    )
    .default({}),

  sources: z
    .array(
      z.object({
        id: ProvenanceSource,
        name: z.string().nullable().default(null),
        license: z.string().nullable().default(null),
        url: z.string().nullable().default(null),
        fetchedAt: z.string().nullable().default(null),
        note: z.string().nullable().default(null),
      }),
    )
    .default([]),
})
export type Meta = z.infer<typeof Meta>

/**
 * Emitted every build, empty until the first id rename.
 *
 * User progress in IndexedDB and KV stores item ids. When the game files land
 * and provisional slugs become real internal names, this is what stops every
 * saved museum tracker from orphaning. It exists from the first commit because
 * it cannot be retrofitted once people are using the app.
 */
export const IdMigrations = z.object({
  schemaVersion: z.number().int().min(1),
  migrations: z
    .array(
      z.object({
        from: z.string(),
        to: z.string(),
        since_schema_version: z.number().int().min(1),
      }),
    )
    .default([]),
})
export type IdMigrations = z.infer<typeof IdMigrations>
