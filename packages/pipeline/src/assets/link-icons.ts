/**
 * Icons for the things that are not items, harvested from data we already have.
 *
 * Skills, shops and farm animals have no image column anywhere in Cargo. But the
 * wiki writes an icon and its link target together, thousands of times, inside
 * the `Items.sources` strings that are already committed:
 *
 * ```
 * [[File:Fishing_icon.png|20px|link=Fishing]] [[Fishing]]
 * [[File:Cows category icon.png|24px|link=Cow]]
 * ```
 *
 * **`link=` is an association a human wrote, not a naming convention we
 * inferred.** That is the whole reason this file exists rather than a rule like
 * "a skill's icon is its name plus `_icon.png`" — which would be right six times
 * out of nine and silently invent three filenames.
 *
 * Two rules keep it honest:
 *
 * - **A target naming more than one distinct file is dropped, not picked from.**
 *   `Farming` is linked from both an almanac glyph and a watering can; choosing
 *   between them would be a coin toss dressed as data. The record keeps its
 *   drawn glyph instead, which is a correct answer.
 * - **Mines are excluded deliberately.** All five biomes link the same
 *   `Fp_wiki_mining.png`, so adopting it would make five distinct places render
 *   identically — strictly worse than five distinct generated glyphs.
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { toSnakeId } from '@mistria/schema'
import { DATA_DIR, SOURCES_DIR } from '../lib/paths.js'
import type { Want } from './inventory.js'
import type { AssetFamily } from './manifest.js'
import { canonicalWikiName, decodeEntities } from './names.js'

/** `[[File:Cows category icon.png|24px|link=Cow]]` — file and target together. */
const LINKED_FILE = /\[\[File:([^\]|]+)\|[^\]]*?link=([^\]|]*)/gi

/**
 * Which datasets can adopt a linked icon, and under which family.
 *
 * Each is looked up only in its own dataset, so a link to `Fishing` cannot
 * resolve to a location that happens to share the name.
 */
const LINKED_DATASETS: readonly { family: AssetFamily; file: string }[] = [
  { family: 'skill', file: 'skills.json' },
  { family: 'ui', file: 'shops.json' },
  { family: 'ui', file: 'animals.json' },
]

/**
 * Every `link=` target that names exactly one file.
 *
 * Targets are keyed by `toSnakeId` of the page name with any `#section` dropped,
 * because that is the same normalisation the record ids went through — matching
 * on the raw string would miss `General_Store` against `general_store`.
 */
export function linkedIcons(strings: string[]): Map<string, string> {
  const candidates = new Map<string, Set<string>>()

  for (const raw of strings) {
    for (const match of decodeEntities(raw).matchAll(LINKED_FILE)) {
      const file = canonicalWikiName(match[1] ?? '')
      const target = (match[2] ?? '').split('#')[0]?.trim() ?? ''
      if (file === '' || target === '') continue

      const key = toSnakeId(target)
      if (key === '') continue
      const files = candidates.get(key) ?? new Set<string>()
      files.add(file)
      candidates.set(key, files)
    }
  }

  const resolved = new Map<string, string>()
  for (const [key, files] of candidates) {
    // Exactly one, or none. See the note at the top of this file.
    const only = files.size === 1 ? [...files][0] : undefined
    if (only !== undefined) resolved.set(key, only)
  }
  return resolved
}

/** Every string in `Items` that might carry a linked icon. */
async function iconBearingStrings(): Promise<string[]> {
  interface CargoItem {
    sources: string[] | null
    season: string | null
    location: string[] | null
  }
  const rows = JSON.parse(
    await readFile(join(SOURCES_DIR, 'wiki', 'cargo', 'items.json'), 'utf8'),
  ) as CargoItem[]

  return rows.flatMap((row) => [...(row.sources ?? []), ...(row.location ?? []), row.season ?? ''])
}

export interface LinkIconResult {
  wants: Want[]
  /** Records with no unambiguous icon. They keep their drawn glyph. */
  unmatched: string[]
}

export async function collectLinkedWants(): Promise<LinkIconResult> {
  const icons = linkedIcons(await iconBearingStrings())
  const wants: Want[] = []
  const unmatched: string[] = []

  for (const { family, file } of LINKED_DATASETS) {
    let records: { id: string; icon_key: string | null }[]
    try {
      records = JSON.parse(await readFile(join(DATA_DIR, file), 'utf8')) as typeof records
    } catch {
      continue
    }

    for (const record of records) {
      if (record.icon_key === null) continue
      const sourceFile = icons.get(record.id)
      if (sourceFile === undefined) {
        unmatched.push(record.icon_key)
        continue
      }
      wants.push({ family, iconKey: record.icon_key, sourceFile })
    }
  }

  return { wants, unmatched }
}
