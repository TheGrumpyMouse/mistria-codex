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
  gates: { type: string; label: string }[]
  rewards: { tesserae: number | null; renown: number | null } | null
}

export interface RequestBoard {
  requests: BoardRequest[]
}

export interface WantedItem {
  id: string
  name: string
  icon_key: string | null
  /** The largest single request, so holding this many covers the worst case. */
  keep: number
  /** How many separate requests want it. */
  requests: number
  /** Villager names, sorted, deduplicated. */
  askers: string[]
  /** Seasons it can be asked in. Empty means any. */
  seasons: string[]
  /** True when *every* request for it is gated — you cannot be asked yet. */
  gated: boolean
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
    WantedItem & { askerSet: Set<string>; seasonSet: Set<string>; ungated: boolean }
  >()

  for (const request of requests) {
    for (const item of request.items) {
      const existing = byItem.get(item.id) ?? {
        id: item.id,
        name: item.name,
        icon_key: item.icon_key,
        keep: 0,
        requests: 0,
        askers: [],
        seasons: [],
        gated: true,
        askerSet: new Set<string>(),
        seasonSet: new Set<string>(),
        ungated: false,
      }

      existing.keep = Math.max(existing.keep, item.quantity)
      existing.requests += 1
      if (request.giver_name !== null) existing.askerSet.add(request.giver_name)

      // A request with no season restriction can come at any time, so it adds
      // nothing to the set — an empty set means "any season" and the row shows
      // no badges rather than all four.
      if (request.seasons !== null) {
        for (const season of request.seasons) existing.seasonSet.add(season)
      }

      // One open route is enough. See the note above: this is an OR, and
      // `gated` is its negation.
      if (request.gates.length === 0) existing.ungated = true

      byItem.set(item.id, existing)
    }
  }

  return [...byItem.values()]
    .map((entry) => ({
      id: entry.id,
      name: entry.name,
      icon_key: entry.icon_key,
      keep: entry.keep,
      requests: entry.requests,
      askers: [...entry.askerSet].sort(),
      seasons: [...entry.seasonSet].sort(
        (a, b) => SEASON_ORDER.indexOf(a) - SEASON_ORDER.indexOf(b),
      ),
      gated: !entry.ungated,
    }))
    .sort((a, b) => b.requests - a.requests || b.keep - a.keep || a.name.localeCompare(b.name))
}
