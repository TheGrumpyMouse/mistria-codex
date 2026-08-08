/**
 * MiniSearch configuration, exported so the build and the client are provably
 * identical.
 *
 * These options are part of the serialised index's contract: loading an index
 * with different options than it was built with does not throw, it silently
 * returns wrong results. That is why this lives in the shared package and not in
 * either consumer.
 */
export const SEARCH_OPTIONS = {
  idField: 'id',
  fields: ['name', 'aliases', 'category', 'tags', 'location_names'],
  /**
   * Stored fields must be enough to paint a result row on their own. If a search
   * result forces the client to load a category bundle to render a name and an
   * icon, "instant search" becomes a multi-megabyte download.
   */
  storeFields: ['id', 'name', 'category', 'icon_key'],
  searchOptions: {
    boost: { name: 3, aliases: 2 },
    prefix: true,
    fuzzy: 0.2,
  },
} as const

/** A record as it enters the search index. Lightweight by design. */
export interface SearchDoc {
  id: string
  name: string
  category: string
  icon_key: string | null
  aliases: string[]
  tags: string[]
  location_names: string[]
}

/** A result as it comes back out, sufficient to render a row. */
export interface SearchHit {
  id: string
  name: string
  category: string
  icon_key: string | null
  score: number
}
