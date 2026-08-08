/**
 * Shared helpers for reading wiki *pages* (as opposed to Cargo tables).
 *
 * Three enrichers now parse pages — museum wings, skills, the calendar — and
 * they all need the same three things: the raw wikitext, the page's own version
 * banner, and when it was last edited. The last one matters more than it looks:
 * Fields of Mistria hit 1.0 on 2026-08-05 and the wiki is still catching up, so
 * a page untouched since February may describe a game that no longer exists.
 * Recording the edit date turns "how stale is this" into a number the app can
 * show instead of something a reader has to go and check.
 *
 * **Only facts leave these modules.** Raw page wikitext is never written to
 * `sources/` — it is CC BY-SA community text, and committing it would drag that
 * licence over part of this repo. See docs/DATA-POLICY.md.
 */
import { fetchWithCache } from './http.js'

/** The wiki's own "last updated in version X" banner. */
const VERSION_STAMP = /\{\{MostRecentUpdate\|([^}|]+)/i

export interface PageFetchOptions {
  endpoint: string
  throttleMs: number
  useCache?: boolean | undefined
}

/**
 * Fetch a page's wikitext.
 *
 * Throws on a redirect rather than following it. A page move is a real change to
 * an input this project depends on, and it should surface as a build failure
 * with the new title in hand — not as a silently empty parse.
 */
export async function fetchPage(page: string, options: PageFetchOptions): Promise<string> {
  const url = `${options.endpoint}?title=${encodeURIComponent(page)}&action=raw`
  const wikitext = await fetchWithCache(url, {
    throttleMs: options.throttleMs,
    ...(options.useCache === undefined ? {} : { useCache: options.useCache }),
  })

  if (wikitext.trim().startsWith('#REDIRECT')) {
    const target = /\[\[([^\]]+)\]\]/.exec(wikitext)?.[1]?.trim() ?? 'unknown'
    throw new Error(`"${page}" is a redirect to "${target}". Update the curated page config.`)
  }
  return stripComments(wikitext)
}

/**
 * Remove `<!-- … -->`, because a commented-out row is not on the page.
 *
 * Editors comment out content that isn't in the game yet, and the Quests page
 * has a whole unreleased heart quest hidden that way — named `?`, which is
 * exactly what it looks like when a parser reads it as real. They also use
 * empty comments to join lines without whitespace, so stripping is what
 * MediaWiki itself effectively does rather than a liberty taken here.
 */
export const stripComments = (wikitext: string): string => wikitext.replace(/<!--[\s\S]*?-->/g, '')

/** The version banner at the top of a page, if it has one. */
export const versionStamp = (wikitext: string): string | null =>
  VERSION_STAMP.exec(wikitext)?.[1]?.trim() ?? null

/**
 * Ask the MediaWiki API when a page was last touched.
 *
 * Freshness is useful, not load-bearing: a failure here returns null and the
 * record picks up a `predates_1_0` gap, which is the conservative answer.
 */
export async function lastEditedAt(
  page: string,
  options: PageFetchOptions,
): Promise<string | null> {
  const url =
    `${options.endpoint.replace(/index\.php$/, 'api.php')}?action=query&prop=revisions` +
    `&titles=${encodeURIComponent(page)}&rvprop=timestamp&format=json`
  try {
    const raw = await fetchWithCache(url, { throttleMs: options.throttleMs })
    const parsed = JSON.parse(raw) as {
      query?: { pages?: Record<string, { revisions?: { timestamp?: string }[] }> }
    }
    const pages = Object.values(parsed.query?.pages ?? {})
    return pages[0]?.revisions?.[0]?.timestamp ?? null
  } catch {
    return null
  }
}

/** `rowspan="13"` on a cell, which makes it apply to the next twelve rows too. */
const ROWSPAN = /rowspan\s*=\s*"?(\d+)"?/i
/** A heading line, capturing its level and its text. */
const HEADING = /^(={1,4})\s*(.+?)\s*\1\s*$/

export interface Cell {
  text: string
  rowspan: number
  /**
   * The HTML attributes before the cell's content, kept raw.
   *
   * Usually styling, but the Quests page hangs an `id="greetthetownsfolk"`
   * anchor off the name cell of every story quest — which makes "which cell is
   * the name" answerable without counting columns.
   */
  attributes: string
}

/**
 * Split a table row into cells.
 *
 * Wikitext writes cells three ways in these tables — `| a || b` on one line,
 * one `| cell` per line, and a mixture — so both separators are handled. A cell
 * may carry HTML attributes before a single `|`; those are split off, but only
 * when they contain no link or template, since `[[File:x|50px]]` also has a pipe.
 */
export function rowCells(row: string): Cell[] {
  const cells: Cell[] = []

  for (const line of row.split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('!') || trimmed.startsWith('{|')) continue
    if (!trimmed.startsWith('|')) continue

    for (const raw of trimmed.replace(/^\|/, '').split('||')) {
      const attrs = /^([^[{|]*?)\|(?!\|)([\s\S]*)$/.exec(raw)
      const attributes = attrs?.[1] ?? ''
      const text = attrs === null ? raw : (attrs[2] ?? '')
      cells.push({
        text: text.trim(),
        rowspan: Number(ROWSPAN.exec(attributes)?.[1] ?? 1),
        attributes,
      })
    }
  }

  return cells
}

/** Heading path -> the wikitext under it, for every section that holds a table. */
export function tablesByHeading(wikitext: string): { heading: string; table: string }[] {
  const found: { heading: string; table: string }[] = []
  const path: string[] = []
  let buffer: string[] = []
  let inTable = false

  const flush = (): void => {
    if (buffer.length > 0)
      found.push({ heading: path.filter(Boolean).join(' > '), table: buffer.join('\n') })
    buffer = []
  }

  for (const line of wikitext.split('\n')) {
    const heading = HEADING.exec(line.trim())
    if (heading !== null) {
      flush()
      inTable = false
      const level = (heading[1] ?? '').length
      path.length = level - 1
      // Headings carry icons and section links; strip them so a rule can match
      // on the words a person would recognise.
      path[level - 1] = (heading[2] ?? '')
        .replace(/\[\[File:[^\]]*\]\]/g, '')
        .replace(/\[\[[^\]|]*\|([^\]]*)\]\]/g, '$1')
        .replace(/<[^>]*>/g, '')
        .replace(/\s+/g, ' ')
        .trim()
      continue
    }

    if (line.startsWith('{|')) {
      flush()
      inTable = true
    }
    if (inTable) buffer.push(line)
    if (line.startsWith('|}')) {
      flush()
      inTable = false
    }
  }
  flush()

  return found
}

/**
 * The named fields of an infobox template.
 *
 * A field's value runs to the next line that starts a new field, not to the next
 * newline: `residents=` lists six people across `<br>`s and `images=` runs to
 * eight lines. Reading one line per field truncates both, and the truncation is
 * invisible — you get a plausible-looking value that is missing its tail.
 *
 * Returns an empty map when the page has no such template, which the caller
 * should treat as "the page changed" rather than "the field is empty".
 */
export function infoboxFields(wikitext: string, template: string): Map<string, string> {
  const fields = new Map<string, string>()
  const start = templateStart(wikitext, template)
  if (start === -1) return fields

  const body = readBalanced(wikitext, start + 2)
  if (body === null) return fields

  let name: string | null = null
  let value: string[] = []
  const flush = (): void => {
    if (name !== null) fields.set(name, value.join('\n').trim())
  }

  for (const line of body.split('\n')) {
    const field = /^\|\s*([A-Za-z_][\w -]*)\s*=\s*([\s\S]*)$/.exec(line)
    if (field === null) {
      if (name !== null) value.push(line)
      continue
    }
    flush()
    name = (field[1] ?? '').trim()
    value = [field[2] ?? '']
  }
  flush()

  return fields
}

/**
 * Where `{{template}}` starts — the template itself, not one whose name merely
 * begins with it.
 *
 * A plain `indexOf('{{Character')` finds `{{CharacterTabs}}`, which every
 * villager page opens with. It reads that template's empty body, finds no
 * fields, and reports the page as having no infobox — so all 34 villagers came
 * back with no portrait and nothing looked broken. The name has to end where we
 * think it ends.
 */
function templateStart(wikitext: string, template: string): number {
  const needle = `{{${template}`
  for (let at = wikitext.indexOf(needle); at !== -1; at = wikitext.indexOf(needle, at + 1)) {
    const next = wikitext.charAt(at + needle.length)
    if (next === '' || next === '|' || next === '}' || /\s/.test(next)) return at
  }
  return -1
}

export interface SwitchCase {
  /** The values this branch answers to, lowercased. `#default` is one of them. */
  keys: string[]
  body: string
}

/**
 * Split a `{{#switch: expr | a | b = X | c = Y }}` body into its branches.
 *
 * Only depth-zero pipes separate branches, and only a depth-zero `=` divides a
 * branch's keys from its body — everything nested inside a template call is
 * that call's business. A branch with no `=` is an extra key for the branch
 * that follows it, which is how the wiki writes `|a|b|c=…`.
 *
 * `body` here is everything after the switch expression, i.e. what
 * `readBalanced` returns minus the leading `#switch:<expr>`.
 */
/**
 * Index of the first `char` that is not inside braces or a link.
 *
 * Braces are counted one at a time rather than as `{{` pairs, because MediaWiki
 * writes `{{{1|}}}` for a parameter and a pair-counter reads that as one open
 * and two closes. Getting this wrong made the first pipe of
 * `{{#switch:{{lc:{{{1|}}}}}` look like a branch separator, which silently
 * emptied every drop table.
 */
function topLevel(text: string, char: string, from = 0): number {
  let depth = 0
  for (let i = from; i < text.length; i += 1) {
    const c = text[i]
    if (c === '{' || c === '[') depth += 1
    else if (c === '}' || c === ']') depth -= 1
    else if (c === char && depth === 0) return i
  }
  return -1
}

export function switchCases(body: string): SwitchCase[] {
  const cases: SwitchCase[] = []
  let pending: string[] = []

  const takeSegment = (segment: string): void => {
    const equals = topLevel(segment, '=')
    if (equals === -1) {
      pending.push(segment)
      return
    }
    pending.push(segment.slice(0, equals))
    cases.push({
      keys: pending.map((k) => k.trim().toLowerCase()).filter((k) => k !== ''),
      body: segment.slice(equals + 1),
    })
    pending = []
  }

  let start = 0
  for (let pipe = topLevel(body, '|'); pipe !== -1; pipe = topLevel(body, '|', start)) {
    takeSegment(body.slice(start, pipe))
    start = pipe + 1
  }
  takeSegment(body.slice(start))

  return cases
}

/**
 * Resolve every `{{#switch:}}` in a template body for one input value.
 *
 * The wiki uses these as lookup tables — `Template:MonsterDrops` is one big
 * switch on the monster's name, with inner switches for the variants that drop
 * something extra. Reading the outer branch alone loses those; reading the
 * whole body keeps every variant's extras on every variant.
 *
 * A branch that matches nothing collapses to the empty string, which is the
 * right answer: that branch is about a different value.
 */
export function expandSwitch(text: string, key: string): string {
  const wanted = key.trim().toLowerCase()
  let out = text

  for (let guard = 0; guard < 10; guard += 1) {
    const at = out.indexOf('{{#switch:')
    if (at === -1) break

    const whole = readBalanced(out, at + 2)
    if (whole === null) break
    // The switch expression runs to the first pipe that is not inside it —
    // `{{#switch:{{lc:{{{1|}}}}}` has two pipes before the first branch.
    const firstPipe = topLevel(whole, '|')
    const branches = firstPipe === -1 ? [] : switchCases(whole.slice(firstPipe + 1))
    const matched =
      branches.find((c) => c.keys.includes(wanted))?.body ??
      branches.find((c) => c.keys.includes('#default'))?.body ??
      ''

    out = out.slice(0, at) + matched + out.slice(at + whole.length + 4)
  }

  return out
}

/** `{{#vardefine:name|` and `{{#vardefineecho:name|`, capturing the name. */
const VAR_DEFINE = /\{\{#vardefine(?:echo)?:\s*([^|}]+)\|/g
const VAR_USE = /\{\{#var:\s*([^|}]+?)\s*\}\}/g

/** Read from `start` to the `}}` that closes the `{{` we are already inside. */
function readBalanced(text: string, start: number): string | null {
  let depth = 1
  for (let i = start; i < text.length - 1; i += 1) {
    if (text.startsWith('{{', i)) {
      depth += 1
      i += 1
    } else if (text.startsWith('}}', i)) {
      depth -= 1
      if (depth === 0) return text.slice(start, i)
      i += 1
    }
  }
  return null
}

/**
 * Substitute a page's own `{{#var:}}` references.
 *
 * Editors use these to avoid retyping a value that repeats down a table — the
 * Blacksmith defines `copperObjCost` once and refers to it in the Cost column of
 * every copper row. Left unexpanded, forty-four tools and armour pieces come out
 * with no price at all, which looks exactly like a wiki that never recorded one.
 *
 * This is a deliberately small slice of MediaWiki: same-page definitions,
 * substituted a few times so a variable referring to another resolves. Anything
 * calling a real template still comes through unexpanded, and the parsers that
 * read this text ignore what they don't recognise.
 */
export function expandVariables(wikitext: string, passes = 3): string {
  const values = new Map<string, string>()
  for (const match of wikitext.matchAll(VAR_DEFINE)) {
    const value = readBalanced(wikitext, (match.index ?? 0) + match[0].length)
    if (value !== null) values.set((match[1] ?? '').trim(), value)
  }

  let out = wikitext
  for (let pass = 0; pass < passes; pass += 1) {
    const next = out.replace(VAR_USE, (whole, name: string) => {
      const value = values.get(name.trim())
      // Newlines are collapsed because a substituted value lands *inside* a
      // table cell, and the cell splitter works line by line: a value written
      // across two lines would have its second half read as a new row and
      // silently dropped. That is how every "only in Fall" condition on the
      // Requests table disappeared.
      return value === undefined ? whole : value.replace(/\s*\n\s*/g, ' ').trim()
    })
    if (next === out) break
    out = next
  }
  return out
}

/**
 * Split wikitext into `== headings ==` sections at one heading level.
 *
 * Returns the heading text and the body up to the next heading of the same or a
 * shallower level, so a `=== sub ===` stays inside its parent and a following
 * `== History ==` cleanly ends the scope.
 */
export function sections(wikitext: string, level: number): { heading: string; body: string }[] {
  const marker = '='.repeat(level)
  const heading = new RegExp(`^${marker}\\s*([^=].*?)\\s*${marker}\\s*$`, 'gm')
  const shallower = new RegExp(`^={1,${level}}[^=]`, 'm')

  const found = [...wikitext.matchAll(heading)]
  return found.map((match, index) => {
    const from = (match.index ?? 0) + match[0].length
    const to = found[index + 1]?.index ?? wikitext.length
    const scope = wikitext.slice(from, to)
    // A shallower heading before the next same-level one ends this section.
    const cut = scope.search(shallower)
    return {
      heading: (match[1] ?? '').trim(),
      body: cut === -1 ? scope : scope.slice(0, cut),
    }
  })
}

/**
 * The rows of a `{| wikitable |}`, one string per `|-`-delimited row.
 *
 * A row is everything between two `|-` separators, which may span several lines
 * — the wiki writes cells both inline (`| a || b`) and one per line, sometimes
 * in the same table. Splitting on lines instead loses every cell after the first
 * in the second style.
 *
 * The `{|` opener and `|}` terminator are cut from the row they are attached to
 * rather than only skipped when they stand alone, because the last row of a
 * table is followed directly by `|}` and would otherwise keep it — enough to
 * hide a trailing footnote marker at the end of that row.
 *
 * **The separator may be indented.** MediaWiki allows leading whitespace on
 * table markup and editors use it; Celine's schedule indents every `|-` by six
 * spaces. Anchoring the split to column zero collapsed her whole week into one
 * row and produced twenty-eight stops whose "place" was a time.
 */
export function tableRows(table: string): string[] {
  const rows: string[] = []

  for (const chunk of table.split(/^[ \t]*\|-.*$/m)) {
    const kept: string[] = []
    for (const line of chunk.split('\n')) {
      const trimmed = line.trimStart()
      // Everything from the terminator on belongs to whatever follows the table.
      if (trimmed.startsWith('|}')) break
      if (trimmed.startsWith('{|')) continue
      kept.push(line)
    }

    const row = kept.join('\n').trim()
    if (row !== '') rows.push(row)
  }

  return rows
}
