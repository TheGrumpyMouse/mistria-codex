/**
 * Turn wiki Cargo values into plain text.
 *
 * Cargo returns rendered-ish wikitext with HTML entities already escaped, so a
 * season arrives looking like:
 *
 *   &lt;span style=&quot;...&quot;&gt;[[File:Season icon autumn.png|24px|link=]]&amp;nbsp;[[Fall]]&lt;/span&gt;
 *
 * and has to come out as `Fall`.
 *
 * The one deliberate non-strip: `{{Template|...}}` is left intact and flagged.
 * A silently-stripped template is a silently-lost fact, and we would never know
 * to go looking for it.
 */

const ENTITIES: Readonly<Record<string, string>> = {
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&amp;': '&',
  '&nbsp;': ' ',
  '&apos;': "'",
}

/** Decode the entities Cargo escapes, including numeric ones. */
export function decodeEntities(text: string): string {
  return (
    text
      .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
      .replace(/&#x([0-9a-f]+);/gi, (_, code: string) =>
        String.fromCodePoint(Number.parseInt(code, 16)),
      )
      .replace(/&(?:lt|gt|quot|nbsp|apos);/g, (m) => ENTITIES[m] ?? m)
      // `&amp;` last, so `&amp;nbsp;` doesn't become a space via a double decode.
      .replace(/&amp;/g, '&')
  )
}

/** True if a template survived, meaning a fact may be hiding inside it. */
export function hasUnparsedTemplate(text: string): boolean {
  return /\{\{[^}]/.test(text)
}

/**
 * Strip wikitext and HTML down to readable text.
 *
 * Order matters: entities first (so tags are visible), then file links (which
 * are images and carry no text), then ordinary links.
 */
export function stripWikitext(raw: string): string {
  if (raw === '') return ''

  // Cargo escapes the whole cell once, so wikitext that already contained a
  // literal `&nbsp;` arrives as `&amp;nbsp;` and survives one decode pass as
  // `&nbsp;`. That was a space in the source, so resolve it here — in display
  // text, not in decodeEntities, which must stay a single honest pass.
  let text = decodeEntities(raw).replace(/&nbsp;/g, ' ')

  // Images carry no information we're allowed to use anyway.
  text = text.replace(/\[\[(?:File|Image):[^\]]*\]\]/gi, ' ')

  // [[Target#Anchor|Display]] -> Display
  text = text.replace(/\[\[[^\]|]*\|([^\]]*)\]\]/g, '$1')
  // [[Target#Anchor]] -> Target, underscores back to spaces
  text = text.replace(/\[\[([^\]]*)\]\]/g, (_, target: string) =>
    (target.split('#')[0] ?? '').replace(/_/g, ' '),
  )

  text = text.replace(/<[^>]+>/g, ' ') // html tags
  // Cargo truncates long cells mid-tag, leaving fragments like "</smal". Those
  // never match the tag pattern above and would otherwise ride along into a
  // location token and fail to resolve.
  text = text.replace(/<\/?[a-z]*$/i, ' ')
  text = text.replace(/'{2,}/g, '') // ''italic'' / '''bold'''

  return text.replace(/\s+/g, ' ').trim()
}

/**
 * A sentinel, not whitespace. Splitting on a space would shred "The Eastern
 * Road" into three tokens, none of which resolve against the alias table.
 */
const SEPARATOR = '@@SEP@@'

/**
 * Split a value into meaningful tokens.
 *
 * Cargo already returns list fields as JSON arrays, so this only has to handle
 * separators *within* one entry — a `<br/>` inside a single rendered cell.
 */
export function tokenise(raw: string): string[] {
  const text = decodeEntities(raw).replace(/<br\s*\/?>/gi, SEPARATOR)
  return text
    .split(SEPARATOR)
    .map(stripWikitext)
    .filter((t) => t !== '' && t !== '-' && t !== 'N/A' && t !== 'Unknown')
}

/** Normalise a Cargo list field, which may be an array, a string, or absent. */
export function toTokens(value: unknown): string[] {
  if (value === null || value === undefined) return []
  if (Array.isArray(value)) return value.flatMap((v) => tokenise(String(v)))
  return tokenise(String(value))
}

/**
 * Cargo returns booleans as 1, 0, or null. **null means unknown, not false** —
 * some fish have `fishing: null` — so it stays null and the record records a
 * data gap rather than quietly claiming the answer is "no".
 */
export function toBoolean(value: unknown): boolean | null {
  if (value === 1 || value === '1') return true
  if (value === 0 || value === '0') return false
  return null
}

export function toInteger(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value)
  if (typeof value === 'string') {
    // Strip currency suffixes and separators, but require what's left to
    // actually be a number. Without this check `"n/a"` reduces to `""`, and
    // `Number("")` is 0 — which would render as a sell value of zero.
    const cleaned = value.replace(/[,\s]/g, '').replace(/[^\d.-]/g, '')
    if (/^-?\d+(?:\.\d+)?$/.test(cleaned)) return Math.trunc(Number(cleaned))
  }
  return null
}
