/**
 * Curated per-record overrides for items: `curated/overrides/items.json`.
 *
 * The narrow escape hatch curated/CLAUDE.md describes. Exactly two fields may
 * be overridden — `also_known_as` (search aliases for names people actually
 * type) and `blurb` (our own factual sentence) — and the whitelist is
 * enforced here rather than trusted to the file, because an override
 * mechanism that can touch any field is how a hand-edit ends up in the
 * generated tier.
 *
 * Applied centrally by `build:data` after the items builders run, like the
 * spoiler stamp: no builder knows the file exists. An id the dataset does not
 * hold throws — a typo must not silently override nothing.
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { CURATED_DIR } from './paths.js'

export interface ItemOverride {
  also_known_as?: string[]
  blurb?: string
  reason: string
  source: string
}

const OVERRIDES_PATH = join(CURATED_DIR, 'overrides', 'items.json')

/** An absent file means "no overrides" — the state before the mechanism existed. */
export async function readItemOverrides(): Promise<Record<string, ItemOverride>> {
  let raw: string
  try {
    raw = await readFile(OVERRIDES_PATH, 'utf8')
  } catch {
    return {}
  }
  // A file that exists but does not parse must throw: swallowing it would
  // silently drop every curated alias and blurb.
  const parsed = JSON.parse(raw) as { overrides?: Record<string, ItemOverride> }
  return parsed.overrides ?? {}
}

export function applyItemOverrides(
  records: { id: string; also_known_as: string[]; blurb: string | null }[],
  overrides: Record<string, ItemOverride>,
): void {
  const byId = new Map(records.map((record) => [record.id, record]))
  for (const [id, override] of Object.entries(overrides)) {
    const record = byId.get(id)
    if (record === undefined) {
      throw new Error(
        `curated/overrides/items.json names "${id}", which is not a built item. ` +
          'Fix the id — a typo here silently overrides nothing.',
      )
    }
    if (override.also_known_as !== undefined) {
      // Union rather than replace: a future wiki-derived alias must not be
      // silently discarded by a curated one.
      record.also_known_as = [...new Set([...record.also_known_as, ...override.also_known_as])]
    }
    if (override.blurb !== undefined && record.blurb === null) {
      record.blurb = override.blurb
    }
  }
}
