/**
 * The spoiler curtain's build half: read the curated judgement file, stamp the
 * flags onto whatever the builders produced.
 *
 * One module shared by `build:data` (which stamps) and `pnpm validate` (which
 * re-reads the file and checks the stamps landed), so the two can never parse
 * the file differently. No builder knows this file exists — "is this a
 * spoiler" is a presentation-tier judgement, not a fact about the record, and
 * keeping the stamp central means widening the list never touches a builder.
 */
import { access, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { CURATED_DIR } from './paths.js'

export interface SpoilerRules {
  /** dataset name -> record ids the app should veil. */
  records: Record<string, string[]>
  /** record id -> names that are themselves the reveal (moved out of also_known_as). */
  aliases: Record<string, string[]>
}

const EMPTY: SpoilerRules = { records: {}, aliases: {} }

const RULES_PATH = join(CURATED_DIR, 'vocab', 'spoilers.json')

/**
 * An absent file means "nothing is a spoiler" — the state before the feature
 * existed. A file that exists but does not parse must throw: swallowing a
 * syntax error would silently unveil everything, which is exactly the failure
 * a curated list must not have.
 */
export async function readSpoilerRules(): Promise<SpoilerRules> {
  try {
    await access(RULES_PATH)
  } catch {
    return EMPTY
  }

  const parsed = JSON.parse(await readFile(RULES_PATH, 'utf8')) as {
    records?: Record<string, string[]>
    aliases?: Record<string, string[]>
  }
  return { records: parsed.records ?? {}, aliases: parsed.aliases ?? {} }
}

interface Stampable {
  id?: unknown
  spoiler?: true
  also_known_as?: string[]
  spoiler_aliases?: string[]
}

/**
 * Stamp one dataset's records, in place, after its builder ran.
 *
 * Only flagged records gain a key at all — `spoiler` and `spoiler_aliases`
 * are optional in the envelope, so the other thousand records' diff is empty.
 * Datasets without an envelope (gift prefs and friends) have no `id` and pass
 * straight through.
 */
export function stampSpoilers(dataset: string, records: unknown[], rules: SpoilerRules): void {
  const flagged = new Set(rules.records[dataset] ?? [])

  for (const record of records as Stampable[]) {
    if (typeof record.id !== 'string') continue

    if (flagged.has(record.id)) record.spoiler = true

    const reveals = rules.aliases[record.id]
    if (reveals === undefined || record.also_known_as === undefined) continue
    const moving = record.also_known_as.filter((n) => reveals.includes(n))
    if (moving.length === 0) continue
    record.also_known_as = record.also_known_as.filter((n) => !reveals.includes(n))
    record.spoiler_aliases = moving
  }
}
