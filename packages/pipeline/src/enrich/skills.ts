/**
 * Extract the skill perk trees from the Skills page.
 *
 * Perks are what make `requires` real. Half the interesting content in the game
 * sits behind one — the Legendary fish need Fishing 30, artifacts drop from
 * rocks only with Stoneturner — and until the perk names exist as ids, a
 * requirement token like `perk:stoneturner` resolves to nothing.
 *
 * **The Description column is never read.** It is verbatim in-game text. What
 * this module takes is the perk's name, its tier, the level that tier unlocks
 * at, and its Essence cost — four facts and a number. `effect_key` stays null
 * until the game files give us a symbolic key instead of a sentence.
 */
import { join } from 'node:path'
import { argv } from 'node:process'
import { pathToFileURL } from 'node:url'
import { consola } from 'consola'
import { CURATED_DIR, SOURCES_DIR } from '../lib/paths.js'
import { readJsonFile } from '../lib/read-json.js'
import {
  fetchPage,
  lastEditedAt,
  type PageFetchOptions,
  sections,
  tableRows,
  versionStamp,
} from '../lib/wiki.js'
import { writeJson } from '../lib/write-json.js'

interface SkillConfig {
  id: string
  name: string
  statue: 'caldarus' | 'mines'
}

interface SkillsVocab {
  page: string
  maxLevel: number
  skills: SkillConfig[]
}

export interface ExtractedPerk {
  skill: string
  name: string
  tier: number
  /** The skill level this tier unlocks at. */
  level: number
  /** Essence. Null when the table omits a price rather than showing zero. */
  cost: number | null
}

export interface SkillsExtract {
  wikiVersionStamp: string | null
  lastEdited: string | null
  maxLevel: number
  skills: (SkillConfig & { tiers: number })[]
  perks: ExtractedPerk[]
}

/** `<big>Tier 2 (Lvl 15)</big>` — one per perk table. */
const TIER_HEADER = /<big>\s*Tier\s+(\d+)\s*\(\s*Lvl\.?\s*(\d+)\s*\)\s*<\/big>/gi
/** The perk name is the only bold text in a row. */
const PERK_NAME = /'''(.+?)'''/
/** `{{Price|10|ess}}`. Only Essence is a perk cost. */
const ESSENCE_COST = /\{\{Price\|\s*(\d+)\s*\|\s*ess\s*\}\}/i

/**
 * Parse one skill's section into perks.
 *
 * The section holds one wikitable per tier, each opening with a
 * `<big>Tier N (Lvl L)</big>` header. Slicing on those headers rather than on
 * table boundaries is deliberate: the tables carry a wall of inline styling and
 * `{{#vardefine:}}` calls that differs between skills, whereas the tier header
 * is identical everywhere.
 *
 * Rows are split on `|-`, **not on newlines**. The page mixes two cell styles —
 * `| icon || '''Name''' || text || {{Price|80|ess}}` on one line, and the same
 * four cells on four lines — and a line-based reader silently drops the price of
 * every perk written the second way. That produced four perks with a null cost
 * and no indication anything had been missed, which is the exact shape of bug
 * this pipeline is built to refuse.
 */
export function parseSkillSection(skill: string, body: string): ExtractedPerk[] {
  const headers = [...body.matchAll(TIER_HEADER)]
  const perks: ExtractedPerk[] = []

  for (const [index, header] of headers.entries()) {
    const from = (header.index ?? 0) + header[0].length
    const to = headers[index + 1]?.index ?? body.length
    const tier = Number(header[1])
    const level = Number(header[2])

    for (const row of tableRows(body.slice(from, to))) {
      const name = PERK_NAME.exec(row)?.[1]?.trim()
      if (name === undefined || name === '') continue

      const cost = ESSENCE_COST.exec(row)?.[1]
      perks.push({
        skill,
        name,
        tier,
        level,
        cost: cost === undefined ? null : Number(cost),
      })
    }
  }

  return perks
}

export async function enrichSkills(options: { useCache?: boolean } = {}): Promise<SkillsExtract> {
  const wiki = await readJsonFile<{ endpoint: string; throttleMs: number }>(
    join(CURATED_DIR, 'vocab', 'wiki.json'),
  )
  const vocab = await readJsonFile<SkillsVocab>(join(CURATED_DIR, 'vocab', 'skills.json'))
  const fetchOptions: PageFetchOptions = { ...wiki, useCache: options.useCache }

  const wikitext = await fetchPage(vocab.page, fetchOptions)
  const bySkill = new Map(sections(wikitext, 3).map((s) => [s.heading, s.body] as const))

  const perks: ExtractedPerk[] = []
  const skills: (SkillConfig & { tiers: number })[] = []

  for (const skill of vocab.skills) {
    const body = bySkill.get(skill.name)
    if (body === undefined) {
      throw new Error(
        `Skills page has no "=== ${skill.name} ===" section. Either the page was ` +
          'restructured or the skill was renamed — check curated/vocab/skills.json.',
      )
    }

    const found = parseSkillSection(skill.id, body)
    if (found.length === 0) {
      throw new Error(
        `${skill.name}: parsed zero perks. Refusing to write an empty perk tree — ` +
          'the table layout has changed.',
      )
    }

    perks.push(...found)
    skills.push({ ...skill, tiers: new Set(found.map((p) => p.tier)).size })
  }

  // The page is one section per skill, so an unrecognised heading is either a
  // new skill or a rename. Both need a human; neither should be silently lost.
  const known = new Set(vocab.skills.map((s) => s.name))
  const unknown = [...bySkill.keys()].filter((h) => !known.has(h) && h !== 'Skill Perks')
  if (unknown.length > 0) {
    consola.warn(`Skills page has sections not in curated/vocab/skills.json: ${unknown.join(', ')}`)
  }

  const extract: SkillsExtract = {
    wikiVersionStamp: versionStamp(wikitext),
    lastEdited: await lastEditedAt(vocab.page, fetchOptions),
    maxLevel: vocab.maxLevel,
    skills,
    perks,
  }

  await writeJson(join(SOURCES_DIR, 'wiki', 'pages', 'skills.json'), extract)
  return extract
}

async function main(): Promise<void> {
  const extract = await enrichSkills({ useCache: !argv.includes('--no-cache') })
  for (const skill of extract.skills) {
    const count = extract.perks.filter((p) => p.skill === skill.id).length
    consola.success(`${skill.name}: ${count} perks across ${skill.tiers} tiers`)
  }
  consola.info(
    `${extract.perks.length} perks, ${extract.skills.length} skills ` +
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
