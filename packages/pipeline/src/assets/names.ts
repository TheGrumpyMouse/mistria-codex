/**
 * Filenames, on both sides of the fetch.
 *
 * Two naming systems meet here and neither is ours to change: MediaWiki's, which
 * is what the wiki will answer to, and the kebab-case one we store under. Every
 * function in this file is pure, because a mistake here is invisible — it does
 * not throw, it just quietly downloads the same sprite twice or, worse, files two
 * different sprites under one name.
 */

/**
 * The name MediaWiki considers canonical.
 *
 * `_` and a space are the same character to MediaWiki, and the first letter is
 * forced uppercase. The real data has all three spellings — `acorn.png`,
 * `Alda_clay_pot.png` and `Worn Hoe.png` all appear in `Items.icon` — so
 * comparing raw strings finds duplicates that are not duplicates and misses ones
 * that are. Canonicalise before you dedupe, always.
 *
 * Everything after the first character stays case-sensitive, because to
 * MediaWiki it is: `Sapling hat.png` and `Sapling Hat.png` are two files.
 */
export function canonicalWikiName(raw: string): string {
  const collapsed = raw.replace(/_/g, ' ').replace(/\s+/g, ' ').trim()
  if (collapsed === '') return ''
  return collapsed.charAt(0).toUpperCase() + collapsed.slice(1)
}

/**
 * The wiki's page *about* a file — `https://…/wiki/File:Copper%20Ore.png`.
 *
 * This, not the direct `/images/` URL, is what the manifest and `ATTRIBUTION.md`
 * record. Two reasons: the direct URL carries a cache-busting query string that
 * changes whenever the file does, so recording it would churn the manifest on
 * every re-upload; and the description page is the one that carries the upload
 * history and licensing notice, which is what a credit link is for.
 */
export function filePageUrl(endpoint: string, canonical: string): string {
  return `${endpoint}/wiki/File:${encodeURIComponent(canonical)}`
}

/** `.png` — lowercased, with the dot. Empty string if there is no extension. */
export function extensionOf(canonical: string): string {
  const match = /\.[a-z0-9]+$/i.exec(canonical)
  return match === null ? '' : match[0].toLowerCase()
}

/**
 * Our own name for a file: lowercase, kebab, ASCII.
 *
 * Deliberately not `toSnakeId`. That function produces *item ids*, and an item id
 * is a foreign key that half the dataset points at — reusing it here would mean a
 * sprite filename and a database key drift into each other, and renaming one
 * would silently be renaming the other. A sprite's stored name is a filename and
 * nothing else, so it gets its own function and its own shape.
 */
export function localName(canonical: string): string {
  const extension = extensionOf(canonical)
  const stem = extension === '' ? canonical : canonical.slice(0, -extension.length)

  const kebab = stem
    .normalize('NFKD')
    // Strip combining marks — `Céline` becomes `celine`, not `c-line`.
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ') // spell out before it becomes a separator
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return `${kebab === '' ? 'unnamed' : kebab}${extension}`
}

/**
 * `[[File:Abyssal chest.png]]` -> `Abyssal chest.png`. Null if there is no ref.
 *
 * Entities are decoded first, because Cargo hands back `Dragon&#039;s horn.png`
 * and asking the wiki for a file with a literal `&#039;` in its name gets
 * nothing — quietly, since a name that does not exist looks exactly like a
 * record that never had an icon.
 */
export function fileRef(wikitext: string): string | null {
  const match = /\[\[\s*File:([^\]|]+)/i.exec(decodeEntities(wikitext))
  const raw = match?.[1]
  if (raw === undefined) return null
  const canonical = canonicalWikiName(raw)
  return canonical === '' ? null : canonical
}

/**
 * Undo the HTML entities Cargo returns.
 *
 * The API hands back `&lt;span&gt;` and `&#039;` rather than the characters, so a
 * regex over the raw string finds nothing at all — silently, which is the worst
 * kind of nothing.
 */
export function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
}
