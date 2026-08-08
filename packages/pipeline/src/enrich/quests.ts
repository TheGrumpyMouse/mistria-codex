/**
 * Extract the quest list from the Quests page.
 *
 * The reason to go near this page at all is gates. Fifteen quest ids are already
 * referenced by the mines and the shops — `breaking_the_fire_seal`,
 * `upgrade_the_inn` — and until the quests exist, those point at nothing. A gate
 * the app cannot name is a gate it cannot explain.
 *
 * **Column two of every table here is the quest's in-game text**, verbatim, in
 * the player character's voice, and the "Requirements to Complete" column is the
 * wiki's own prose. Neither is read. What is taken: the name, the kind, who
 * gives it, the rewards, and — only where the wiki writes them as
 * `{{ItemIcon|Heather}} (3)` — delivery objectives, which is a structured fact
 * rather than a sentence.
 *
 * Name cells differ by section (an `id=` anchor, a link, or plain text), so the
 * strategy is declared in `curated/vocab/quests.json` rather than guessed.
 */
import { join } from 'node:path'
import { argv } from 'node:process'
import { pathToFileURL } from 'node:url'
import { consola } from 'consola'
import { CURATED_DIR, SOURCES_DIR } from '../lib/paths.js'
import { readJsonFile } from '../lib/read-json.js'
import {
  type Cell,
  expandVariables,
  fetchPage,
  lastEditedAt,
  type PageFetchOptions,
  rowCells,
  tablesByHeading,
  versionStamp,
} from '../lib/wiki.js'
import { writeJson } from '../lib/write-json.js'

type NameStrategy = 'id' | 'link' | 'text'

interface SectionRule {
  match: string
  kind: string
  nameFrom: NameStrategy
  repeatable: boolean
  /** Which cell holds deliverables, counted back from the last. */
  objectivesFromEnd?: number
}

interface QuestVocab {
  page: string
  sections: SectionRule[]
  ignoreSections: { match: string; reason: string }[]
}

export interface ExtractedQuest {
  section: string
  kind: string
  name: string
  /** `{{NPC|Adeline}}`, carried down a rowspanned requester column. */
  giver: string | null
  rewardItems: { name: string; quantity: number | null }[]
  rewardCurrency: { amount: number; token: string }[]
  objectives: { itemName: string; quantity: number | null }[]
  seasons: string[]
  /** Gates from the "Requirements to Receive" column, unresolved. */
  conditions: ExtractedCondition[]
  repeatable: boolean
}

export interface QuestExtract {
  wikiVersionStamp: string | null
  lastEdited: string | null
  quests: ExtractedQuest[]
  unclassifiedSections: string[]
}

/** `id="greetthetownsfolk"` on the name cell of the story tables. */
const ID_ANCHOR = /id\s*=\s*"([^"]+)"/
const LINK = /\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/
const NPC = /\{\{NPC\|([^}|]+)/
/** `{{ItemIcon|Heather}} (3)` — the count is optional. */
const ITEM_WITH_COUNT = /\{\{(?:Item|Furniture)Icon(?:Auto)?\|([^}|]+)[^}]*\}\}(?:\s*\((\d+)\))?/g
const PRICE = /\{\{Price\|\s*(\d+)\s*(?:\|\s*([^}|]*))?\}\}/g
/** After variable expansion, a seasonal condition reads "Current Season: {{Season|Fall}}". */
const SEASON_CONDITION = /Current Season:\s*\{\{Season\|([A-Za-z]+)/g

/**
 * The "Requirements to Receive" column, once the page variables are expanded.
 *
 * The wiki writes every one of these as a `{{#vardefine}}` — `conditionYear2`,
 * `conditionEarth`, `conditionOre` — which is why they are invisible in the raw
 * wikitext and legible after expansion. Matching the expanded prose rather than
 * the variable names means a new condition that reuses an existing phrasing is
 * picked up without a code change, and a genuinely new phrasing is *missed*
 * rather than mis-read, which is the failure direction to prefer.
 *
 * Season is handled separately, above: it is a restriction on when a request
 * can appear rather than a thing the player has to have done.
 */
const CONDITIONS: { kind: ExtractedCondition['kind']; pattern: RegExp }[] = [
  /** `*Reached Year 2` */
  { kind: 'year', pattern: /Reached Year\s*(\d+)/g },
  /** `*Obtained: {{ItemIcon|Worn Pickaxe}}` */
  { kind: 'item', pattern: /Obtained:\s*\{\{(?:Item|Furniture)Icon(?:Auto)?\|([^}|]+)/g },
  /** `*Completed: {{SourceIcon|Story Quest Short|Cop Some Ore}}` */
  { kind: 'quest', pattern: /Completed:\s*(\{\{SourceIcon\|[^}]*\}\})/g },
  /** `*Reached {{BiomesQuick|3|icon}}` — the mine biome by its order. */
  { kind: 'biome', pattern: /Reached\s*\{\{BiomesQuick\|\s*(\d+)/g },
  /** `*Unlocked {{Icon|Fp_wiki_deep_woods|The Deep Woods}}` */
  { kind: 'location', pattern: /Unlocked\s*\{\{Icon\|[^}|]*\|([^}|]+)/g },
  /** `*Built: a {{Icon|Small_Red_Coop_Blueprint|Coop}}` */
  { kind: 'building', pattern: /Built:\s*(?:an?\s*)?\{\{Icon\|[^}|]*\|([^}|]+)/g },
  /** `*{{Skill|Cooking}} Lv.20` */
  { kind: 'skill', pattern: /\{\{Skill\|([^}|]+)\}\}\s*Lv\.?\s*(\d+)/g },
]

/** One gate on a request, still in the wiki's own words. Resolved in the builder. */
export interface ExtractedCondition {
  kind: 'year' | 'item' | 'quest' | 'biome' | 'location' | 'building' | 'skill'
  /** A year number, a level, or a display name to resolve. */
  value: string
  /** Set for a skill: the level required. */
  level?: number
}

/**
 * The quest a `{{SourceIcon}}` names.
 *
 * **The last positional argument, not the second.** The template puts the icon
 * type first, so `{{SourceIcon|Story Quest Short|Cop Some Ore}}` and
 * `{{SourceIcon|Request|Maple|Common Pheromone}}` need different indices — the
 * second is a request *from Maple* for a Common Pheromone, and reading argument
 * two calls the quest "Maple". This is the same trap the schedule parser hit,
 * which is why it is solved the same way rather than by counting arguments.
 *
 * `Cooking Challenge` is excluded: its argument is a **count** — complete
 * twelve of them — not a name, and turning "12" into a quest id would produce a
 * reference to a quest that cannot exist.
 */
export function questFromSourceIcon(call: string): string | null {
  const args = call
    .replace(/^\{\{SourceIcon\|/, '')
    .replace(/\}\}$/, '')
    .split('|')
    .map((a) => a.trim())
    .filter((a) => a !== '' && !/^[\w -]+=/.test(a))

  const type = args[0] ?? ''
  if (/cooking challenge/i.test(type)) return null

  const last = args.at(-1)
  return last === undefined || last === type || /^\d+$/.test(last) ? null : last
}

/** Read every gate the "Requirements to Receive" cell states. */
export function parseConditions(cell: string): ExtractedCondition[] {
  const found: ExtractedCondition[] = []

  for (const { kind, pattern } of CONDITIONS) {
    for (const match of cell.matchAll(pattern)) {
      const raw = (match[1] ?? '').trim()
      if (raw === '') continue

      if (kind === 'quest') {
        const quest = questFromSourceIcon(raw)
        if (quest !== null) found.push({ kind, value: quest })
        continue
      }
      if (kind === 'skill') {
        found.push({ kind, value: raw, level: Number(match[2]) })
        continue
      }

      // `{{ItemIcon|Worn Fishing Rod||Worn Fishing Rod.png}}` names a display
      // file after an empty argument, and expansion flattens the two into
      // "Worn Fishing Rod Worn Fishing Rod.png". **Skipped, not repaired**: the
      // obvious fix — strip the trailing filename — turns it into "Worn Fishing
      // Rod Worn Fishing", which is a different wrong answer that looks more
      // like a right one. One condition goes unrecorded and nothing is invented.
      if (/\.(?:png|jpg|gif)\b/i.test(raw)) continue
      found.push({ kind, value: raw })
    }
  }

  return found
}

/** Strip wiki markup down to plain words, for the plain-text name strategy. */
const plain = (text: string): string =>
  text
    .replace(/\[\[[^\]|]*\|([^\]]*)\]\]/g, '$1')
    .replace(/\[\[([^\]]*)\]\]/g, '$1')
    .replace(/'''?/g, '')
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim()

/**
 * The quest's name, by whichever marker its table uses.
 *
 * - `id` — the name cell carries an `id="…"` anchor, unique to the story tables.
 * - `link` — the name is the display text of a link
 *   (`[[Adeline/Heart_Events#Four_Hearts|A Rewarding Choice]]`).
 * - `text` — the first plain-text cell. Numeric cells are skipped because the
 *   Cooking and Mission tables open with a `#` column, and "1" is not a quest.
 *
 * Returns null rather than falling back to another strategy: a row whose name
 * cannot be found the declared way is a layout change, and guessing would put a
 * description or a row number in the name field.
 */
export function questName(cells: Cell[], strategy: NameStrategy): string | null {
  if (strategy === 'id') {
    const cell = cells.find((c) => ID_ANCHOR.test(c.attributes))
    return cell === undefined ? null : plain(cell.text) || null
  }

  if (strategy === 'link') {
    for (const cell of cells) {
      const link = LINK.exec(cell.text)
      if (link === null) continue
      const target = (link[1] ?? '').trim()
      if (/^(File|Image|Category):/i.test(target)) continue
      const display = (link[2] ?? '').trim()
      const found = display !== '' ? display : (target.split('#').at(-1)?.replace(/_/g, ' ') ?? '')
      if (found.length < 3 || !/[A-Za-z]/.test(found)) continue
      return found
    }
    return null
  }

  for (const cell of cells) {
    const text = plain(cell.text)
    // Skip the row number, the requester, and the punctuation left over from a
    // table's closing markup — five rows produced names like "+" and "}{{Top}}".
    if (text === '' || /^\d+$/.test(text) || NPC.test(cell.text)) continue
    if (text.length < 3 || !/[A-Za-z]/.test(text)) continue
    // Anything this long is the description column, not a title.
    if (text.length > 70 || text.includes('. ')) return null
    return text
  }
  return null
}

/** Parse one quest table. */
export function parseQuestTable(
  table: string,
  rule: SectionRule,
  section: string,
): ExtractedQuest[] {
  const quests: ExtractedQuest[] = []
  let carriedGiver: { name: string; remaining: number } | null = null

  for (const chunk of table.split(/^\|-.*$/m)) {
    const cells = rowCells(chunk)
    if (cells.length === 0) continue

    const name = questName(cells, rule.nameFrom)
    if (name === null) continue

    // The requester column is rowspanned across all of that character's rows.
    const giverCell = cells.find((c) => NPC.test(c.text))
    let giver: string | null = null
    if (giverCell !== undefined) {
      giver = NPC.exec(giverCell.text)?.[1]?.trim() ?? null
      if (giver !== null && giverCell.rowspan > 1) {
        carriedGiver = { name: giver, remaining: giverCell.rowspan - 1 }
      }
    } else if (carriedGiver !== null) {
      const carried: { name: string; remaining: number } = carriedGiver
      giver = carried.name
      carriedGiver =
        carried.remaining > 1 ? { name: carried.name, remaining: carried.remaining - 1 } : null
    }

    // Heart quests name the character in the link target, not a cell:
    // `[[Adeline/Heart_Events#Four_Hearts|…]]`.
    if (giver === null && rule.nameFrom === 'link') {
      const target = LINK.exec(cells[0]?.text ?? '')?.[1] ?? ''
      const owner = target.split('/')[0]?.trim()
      if (owner !== undefined && owner !== '' && !owner.includes('#')) giver = owner
    }

    // Rewards are always the last column on every table on this page.
    const rewardCell = cells.at(-1)?.text ?? ''
    const rewardItems = [...rewardCell.matchAll(ITEM_WITH_COUNT)].map((m) => ({
      name: (m[1] ?? '').trim(),
      quantity: m[2] === undefined ? null : Number(m[2]),
    }))
    const rewardCurrency = [...rewardCell.matchAll(PRICE)].map((m) => ({
      amount: Number(m[1]),
      token: (m[2] ?? '').trim(),
    }))

    const objectiveCell =
      rule.objectivesFromEnd === undefined ? '' : (cells.at(-rule.objectivesFromEnd)?.text ?? '')
    const objectives = [...objectiveCell.matchAll(ITEM_WITH_COUNT)].map((m) => ({
      itemName: (m[1] ?? '').trim(),
      quantity: m[2] === undefined ? null : Number(m[2]),
    }))

    const rowText = cells.map((c) => c.text).join(' ')
    const seasons = [...rowText.matchAll(SEASON_CONDITION)].map((m) =>
      (m[1] ?? '').trim().toLowerCase(),
    )
    // Read from the whole row rather than a fixed column: the tables on this
    // page do not agree on how many columns they have, and a condition in the
    // wrong cell is still a condition. Every pattern is anchored on its own
    // phrasing, so there is nothing for a neighbouring column to collide with.
    const conditions = parseConditions(rowText)

    quests.push({
      section,
      kind: rule.kind,
      name,
      giver,
      rewardItems,
      rewardCurrency,
      objectives,
      seasons: [...new Set(seasons)],
      conditions,
      repeatable: rule.repeatable,
    })
  }

  return quests
}

export async function enrichQuests(options: { useCache?: boolean } = {}): Promise<QuestExtract> {
  const wiki = await readJsonFile<{ endpoint: string; throttleMs: number }>(
    join(CURATED_DIR, 'vocab', 'wiki.json'),
  )
  const vocab = await readJsonFile<QuestVocab>(join(CURATED_DIR, 'vocab', 'quests.json'))
  const fetchOptions: PageFetchOptions = { ...wiki, useCache: options.useCache }

  // The Requests table encodes every "only in Fall" condition as a page
  // variable, so without expansion the season restrictions are invisible.
  const wikitext = expandVariables(await fetchPage(vocab.page, fetchOptions))

  const quests: ExtractedQuest[] = []
  const unclassified = new Set<string>()

  for (const { heading, table } of tablesByHeading(wikitext)) {
    const folded = heading.toLowerCase()
    // Rules are matched in order, so the more specific "Requests > Crown
    // Requests" wins over the bare "Requests" that would also match it.
    const rule = vocab.sections.find((s) => folded.includes(s.match.toLowerCase()))
    if (rule === undefined) {
      const ignored = vocab.ignoreSections.some((s) => folded.includes(s.match.toLowerCase()))
      if (!ignored && heading !== '') unclassified.add(heading)
      continue
    }
    quests.push(...parseQuestTable(table, rule, heading))
  }

  if (quests.length === 0) {
    throw new Error(
      `${vocab.page}: parsed zero quests. Refusing to write an empty quest list — ` +
        'the page layout has changed.',
    )
  }
  for (const heading of unclassified) {
    consola.warn(`${vocab.page}: table under "${heading}" is neither a quest table nor ignored`)
  }

  const extract: QuestExtract = {
    wikiVersionStamp: versionStamp(wikitext),
    lastEdited: await lastEditedAt(vocab.page, fetchOptions),
    quests,
    unclassifiedSections: [...unclassified].sort(),
  }

  await writeJson(join(SOURCES_DIR, 'wiki', 'pages', 'quests.json'), extract)
  return extract
}

async function main(): Promise<void> {
  const extract = await enrichQuests({ useCache: !argv.includes('--no-cache') })
  const byKind = new Map<string, number>()
  for (const quest of extract.quests) {
    byKind.set(quest.kind, (byKind.get(quest.kind) ?? 0) + 1)
  }
  for (const [kind, count] of [...byKind].sort()) consola.log(`${kind.padEnd(18)} ${count}`)
  consola.info(
    `${extract.quests.length} quests ` +
      `[stamp ${extract.wikiVersionStamp ?? '?'}, edited ${extract.lastEdited?.slice(0, 10) ?? '?'}]`,
  )
}

const entry = argv[1]
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  main().catch((err: unknown) => {
    consola.error(err instanceof Error ? err.message : err)
    process.exitCode = 1
  })
}
