import type { DisplayIndex } from './data'

/**
 * Ranked name search over the display index.
 *
 * The ranking exists because a plain substring filter puts "Copper Nugget
 * Beetle" above "Copper Ore" when you type "copper", and the thing you meant is
 * almost always the shorter, earlier match. Four tiers, best first:
 *
 * 1. the whole name
 * 2. the name starts with it
 * 3. a word in the name starts with it
 * 4. it appears anywhere
 *
 * Within a tier, shorter names win — "Coal" beats "Coal Cart" for "coal" —
 * then alphabetical, so the order is stable rather than incidental.
 *
 * A record's other names are searched in the same four tiers, one whole band
 * below — any match on a real name beats any match on an alias. Typing
 * "seridia" finds the Priestess, because the game has called her that all along
 * and someone who has met her will not think to search for her job title.
 */

export interface SearchHit {
  id: string
  entry: DisplayIndex[string]
  rank: number
  /**
   * The alias that matched, when the display name did not.
   *
   * The UI shows it, and it is not decoration: a result whose visible name does
   * not contain what you typed looks like a bug unless it says why it is there.
   */
  via: string | null
}

const MAX_RESULTS = 60

/**
 * How far an alias match sorts behind a name match.
 *
 * Four, the number of tiers, so the bands cannot interleave: an exact alias hit
 * still ranks below a name that merely contains the query. That is the
 * conservative direction — the name on screen is what someone is looking at.
 */
const ALIAS_PENALTY = 4

/** Fold case and strip punctuation, so "haydens" finds "Hayden's". */
const fold = (text: string): string =>
  text.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/['’]/g, '')

export function rankOf(name: string, needle: string): number | null {
  const haystack = fold(name)
  if (haystack === needle) return 0
  if (haystack.startsWith(needle)) return 1

  const at = haystack.indexOf(needle)
  if (at === -1) return null
  // A match right after a space or hyphen is the start of a word.
  return /[\s-]/.test(haystack.charAt(at - 1)) ? 2 : 3
}

/**
 * Which detail screen a result belongs on.
 *
 * The display index mixes four kinds of thing into one namespace, and only the
 * category says which. Anything unrecognised goes to the item route, which is
 * where the other 1,150 entries live.
 */
export function routeFor(
  category: string,
): '/item/$id' | '/villager/$id' | '/place/$id' | '/monster/$id' | '/quest/$id' {
  if (category === 'character') return '/villager/$id'
  if (category === 'location') return '/place/$id'
  if (category === 'monster') return '/monster/$id'
  if (category === 'quest') return '/quest/$id'
  return '/item/$id'
}

/**
 * Which sprite a result should draw — `routeFor`'s companion.
 *
 * Almost every id is in the display index and carries its own `icon_key`, so
 * this is a fallback: it only fires for an id the index does not know. Twenty
 * call sites used to spell that fallback as `` `item/${id}` `` regardless of
 * what they were drawing, which handed a monster or a place the wrong glyph
 * family and, for the two families with no art at all, two arbitrary letters.
 * The category picks the prefix here for the same reason it picks the route
 * there: it is the only thing that knows what the id refers to.
 *
 * An item falls back to `item/`, which matches no sprite and no glyph by
 * design — its real prefix is its subcategory (`fish/`, `cooked/`, …) and an
 * unindexed record has not told us which.
 */
export function iconKeyFor(id: string, entry?: { i?: string | null; c?: string }): string {
  if (entry?.i != null) return entry.i
  const category = entry?.c
  if (
    category === 'character' ||
    category === 'location' ||
    category === 'monster' ||
    category === 'quest'
  ) {
    return `${category}/${id}`
  }
  return `item/${id}`
}

/**
 * Quest display name -> id, unique names only.
 *
 * Shipped rule tokens carry display names, and six request names are
 * duplicated within the quest category — a last-write-wins map would link
 * those to the wrong record, so a colliding name is dropped instead. None of
 * the names that actually appear in rule tokens collide today; if one ever
 * does, its pill degrades to text rather than lying.
 */
/**
 * The typed-it exemption: a veiled search result shows its real name when the
 * query already is that name (or the start of it, three letters or more).
 * Someone typing "caldarus" is not being spoiled by the answer "Caldarus" —
 * redacting it would just look broken. Spoiler aliases count; the plain
 * category or a stray substring does not.
 */
export function typedTheName(entry: { n: string; sa?: string[] }, query: string): boolean {
  const needle = fold(query.trim())
  if (needle.length < 3) return false
  return [entry.n, ...(entry.sa ?? [])].some((name) => fold(name).startsWith(needle))
}

export function questIdByName(index: DisplayIndex): Map<string, string> {
  const byName = new Map<string, string | null>()
  for (const [id, entry] of Object.entries(index)) {
    if (entry.c !== 'quest') continue
    byName.set(entry.n, byName.has(entry.n) ? null : id)
  }
  return new Map([...byName].flatMap(([name, id]) => (id === null ? [] : [[name, id]])))
}

export function search(index: DisplayIndex, query: string): SearchHit[] {
  const needle = fold(query.trim())
  if (needle === '') return []

  const hits: SearchHit[] = []
  for (const [id, entry] of Object.entries(index)) {
    const rank = rankOf(entry.n, needle)
    if (rank !== null) {
      hits.push({ id, entry, rank, via: null })
      continue
    }

    // Best alias, not first: a record with several other names should be ranked
    // by the one that matches you best, the same as its display name would be.
    // Spoiler aliases are searched too — someone who has met Seridia must find
    // her — and the typed-it exemption is what lets the row say why it matched.
    let best: { rank: number; via: string } | null = null
    for (const alias of [...(entry.a ?? []), ...(entry.sa ?? [])]) {
      const aliasRank = rankOf(alias, needle)
      if (aliasRank !== null && (best === null || aliasRank < best.rank)) {
        best = { rank: aliasRank, via: alias }
      }
    }
    if (best !== null) hits.push({ id, entry, rank: best.rank + ALIAS_PENALTY, via: best.via })
  }

  hits.sort(
    (a, b) =>
      a.rank - b.rank || a.entry.n.length - b.entry.n.length || a.entry.n.localeCompare(b.entry.n),
  )

  // Capped: nobody reads past sixty, and rendering 1,251 rows on every keystroke
  // is the one way a scan this small could still feel slow.
  return hits.slice(0, MAX_RESULTS)
}
