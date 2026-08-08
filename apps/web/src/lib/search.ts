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
 */

export interface SearchHit {
  id: string
  entry: DisplayIndex[string]
  rank: number
}

const MAX_RESULTS = 60

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

export function search(index: DisplayIndex, query: string): SearchHit[] {
  const needle = fold(query.trim())
  if (needle === '') return []

  const hits: SearchHit[] = []
  for (const [id, entry] of Object.entries(index)) {
    const rank = rankOf(entry.n, needle)
    if (rank !== null) hits.push({ id, entry, rank })
  }

  hits.sort(
    (a, b) =>
      a.rank - b.rank || a.entry.n.length - b.entry.n.length || a.entry.n.localeCompare(b.entry.n),
  )

  // Capped: nobody reads past sixty, and rendering 1,251 rows on every keystroke
  // is the one way a scan this small could still feel slow.
  return hits.slice(0, MAX_RESULTS)
}
