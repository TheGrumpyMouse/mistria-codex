/**
 * The spoiler list must point at things that exist, and the stamps must have
 * landed.
 *
 * Both failures are errors, not warnings, because both fail silently
 * otherwise: an id that matches nothing veils nothing (a typo'd
 * "breaking_the_final_seal" leaves the real quest wide open), and a stamp
 * missing from `data/` means the committed data predates the current list.
 */
import { readSpoilerRules } from '../lib/spoilers.js'
import type { Loaded, LoadedDataset } from './load.js'
import { error, type Finding } from './report.js'

interface Enveloped {
  id?: unknown
  spoiler?: unknown
  also_known_as?: unknown
  spoiler_aliases?: unknown
}

export async function checkSpoilers(loaded: Loaded): Promise<Finding[]> {
  const rules = await readSpoilerRules()
  const findings: Finding[] = []
  const file = 'curated/vocab/spoilers.json'

  for (const [dataset, ids] of Object.entries(rules.records)) {
    const ds = (loaded as Record<string, LoadedDataset | undefined>)[dataset]
    if (ds === undefined) {
      findings.push(error('spoilers', `"${dataset}" is not a dataset name`, file))
      continue
    }

    const byId = new Map(
      (ds.records as Enveloped[]).flatMap((r) =>
        typeof r.id === 'string' ? [[r.id, r] as const] : [],
      ),
    )
    for (const id of ids) {
      const record = byId.get(id)
      if (record === undefined) {
        findings.push(error('spoilers', `${dataset}: no record "${id}"`, file))
      } else if (record.spoiler !== true) {
        findings.push(
          error(
            'spoilers',
            `${dataset}/${id} is listed but not stamped — data/ is stale, re-run build:data`,
            `data/${ds.file}`,
          ),
        )
      }
    }
  }

  for (const [id, names] of Object.entries(rules.aliases)) {
    const owner = Object.values(loaded)
      .flatMap((ds) => ds.records as Enveloped[])
      .find((r) => r.id === id)

    if (owner === undefined) {
      findings.push(error('spoilers', `alias owner "${id}" matches no record`, file))
      continue
    }

    const held = Array.isArray(owner.spoiler_aliases) ? (owner.spoiler_aliases as string[]) : []
    const printed = Array.isArray(owner.also_known_as) ? (owner.also_known_as as string[]) : []
    for (const name of names) {
      if (printed.includes(name)) {
        findings.push(
          error(
            'spoilers',
            `"${name}" is still in ${id}.also_known_as — data/ is stale, re-run build:data`,
          ),
        )
      } else if (!held.includes(name)) {
        findings.push(
          error(
            'spoilers',
            `"${name}" is not a name any source uses for "${id}" — nothing to move`,
            file,
          ),
        )
      }
    }
  }

  return findings
}
