/**
 * The request board, and the one derivation the screen actually needs.
 *
 * The board posts a few requests at a time and picks them at random, so no
 * single one can be predicted. The pool is fixed, though, which means the
 * useful question is not "what will be asked" but **"what should I keep"** —
 * and that is this file: the pool, inverted from requests to items.
 */

export interface BoardItem {
  id: string
  name: string
  icon_key: string | null
  /** Joined at ship time from the item record; bundles older than the field lack it. */
  category?: string | null
  quantity: number
}

export interface BoardRequest {
  id: string
  name: string
  giver_id: string | null
  giver_name: string | null
  items: BoardItem[]
  /** Null means all year — never "unknown". */
  seasons: string[] | null
  /** `key` links quest/location gates to their pages; older bundles lack it. */
  gates: { type: string; key?: string; label: string }[]
  rewards: { tesserae: number | null; renown: number | null } | null
}

export interface RequestBoard {
  requests: BoardRequest[]
}

export interface WantedItem {
  id: string
  name: string
  icon_key: string | null
  /**
   * The item's category, for the board's collapsible groups. A bundle from
   * before the field shipped reads as `misc`, which renders as "Other" — the
   * item stays visible, just less specifically shelved.
   */
  category: string
  /** The largest single request, so holding this many covers the worst case. */
  keep: number
  /** How many separate requests want it. */
  requests: number
  /** The villagers who might ask, sorted by name, deduplicated. A null id is
   *  a giver the board names but the roster does not — text, not a link. */
  askers: { id: string | null; name: string }[]
  /** Seasons it can be asked in. Empty means any. */
  seasons: string[]
  /** True when *every* request for it is gated — you cannot be asked yet. */
  gated: boolean
  /**
   * What stands in the way, when `gated` — the distinct gate labels, in the
   * order first seen.
   *
   * These are alternative routes, not a checklist: each request is its own way
   * to be asked, so opening any one of them opens the item. Within a single
   * request several gates are an AND, but that detail belongs on the request
   * itself (the villager view shows it) rather than on a summary row.
   */
  gateLabels: string[]
}

const SEASON_ORDER = ['spring', 'summer', 'fall', 'winter']

/**
 * Invert the board: one row per item, with what to hold and who might ask.
 *
 * `keep` is the **maximum** of the quantities rather than the sum. Requests
 * arrive one at a time and are satisfied one at a time, so the largest single
 * ask is what you need on hand; summing would tell someone to hoard six of
 * something when two was always enough.
 *
 * `gated` is an AND across every request for the item, not an OR. If one route
 * to being asked is open, the item can be asked for — saying otherwise would
 * hide something you genuinely might need today.
 */
export function itemsWanted(requests: BoardRequest[]): WantedItem[] {
  const byItem = new Map<
    string,
    WantedItem & {
      askerSet: Map<string, string | null>
      seasonSet: Set<string>
      ungated: boolean
      labelSet: Set<string>
    }
  >()

  for (const request of requests) {
    for (const item of request.items) {
      const existing = byItem.get(item.id) ?? {
        id: item.id,
        name: item.name,
        icon_key: item.icon_key,
        category: item.category ?? 'misc',
        keep: 0,
        requests: 0,
        askers: [],
        seasons: [],
        gated: true,
        gateLabels: [],
        askerSet: new Map<string, string | null>(),
        seasonSet: new Set<string>(),
        ungated: false,
        labelSet: new Set<string>(),
      }

      existing.keep = Math.max(existing.keep, item.quantity)
      existing.requests += 1
      if (request.giver_name !== null) existing.askerSet.set(request.giver_name, request.giver_id)

      // A request with no season restriction can come at any time, so it adds
      // nothing to the set — an empty set means "any season" and the row shows
      // no badges rather than all four.
      if (request.seasons !== null) {
        for (const season of request.seasons) existing.seasonSet.add(season)
      }

      // One open route is enough. See the note above: this is an OR, and
      // `gated` is its negation.
      if (request.gates.length === 0) existing.ungated = true
      for (const gate of request.gates) existing.labelSet.add(gate.label)

      byItem.set(item.id, existing)
    }
  }

  return [...byItem.values()]
    .map((entry) => ({
      id: entry.id,
      name: entry.name,
      icon_key: entry.icon_key,
      category: entry.category,
      keep: entry.keep,
      requests: entry.requests,
      askers: [...entry.askerSet]
        .map(([name, id]) => ({ id, name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      seasons: [...entry.seasonSet].sort(
        (a, b) => SEASON_ORDER.indexOf(a) - SEASON_ORDER.indexOf(b),
      ),
      gated: !entry.ungated,
      // Only when nothing is open: on an available item the labels describe
      // routes you do not need, which would read as a warning about something
      // you can already have.
      gateLabels: entry.ungated ? [] : [...entry.labelSet],
    }))
    .sort((a, b) => b.requests - a.requests || b.keep - a.keep || a.name.localeCompare(b.name))
}
