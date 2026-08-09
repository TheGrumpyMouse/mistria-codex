import type { Loaded } from './load.js'
import { type Finding, warn } from './report.js'

interface Requirement {
  type: string
  key: string
  op: string
  value: number | string | null
}

/**
 * Every gate must name something that exists.
 *
 * `requires` is the one place in the dataset that references other records by a
 * bare string rather than an `*_id` field, so referential integrity does not
 * see it. That is exactly where drift hides: a shop gated on
 * `skill:fishing >= 8` keeps working when Fishing is renamed, and quietly
 * becomes a gate nobody can ever satisfy.
 *
 * Warnings rather than errors while the referenced datasets are still filling
 * in — a gate on a quest we have not ingested is a to-do, not a broken build.
 * `perk` and `skill` are checked strictly, because both datasets are complete.
 */
export function checkGates(loaded: Loaded): Finding[] {
  const findings: Finding[] = []

  const idsOf = (dataset: keyof Loaded): Set<string> =>
    new Set(
      loaded[dataset].records
        .map((r) => (r as Record<string, unknown>).id)
        .filter((id): id is string => typeof id === 'string'),
    )

  const questIds = idsOf('quests')
  const skillIds = idsOf('skills')
  const perkIds = new Set(
    loaded.skills.records.flatMap((skill) =>
      ((skill as { perks?: { id: string }[] }).perks ?? []).map((p) => p.id),
    ),
  )

  const targets: Record<string, Set<string>> = {
    quest: questIds,
    skill: skillIds,
    perk: perkIds,
    // A "once you have shipped a potato" gate names an item, and the item table
    // is complete — so a typo in one is catchable here rather than becoming a
    // condition no player can ever satisfy. This is the same reasoning that
    // makes `perk` and `skill` strict.
    shipped_item: idsOf('items'),
    donated_item: idsOf('items'),
  }

  /** Walk any record shape looking for `requires`-shaped arrays. */
  const collect = (value: unknown, at: string, out: { req: Requirement; at: string }[]): void => {
    if (Array.isArray(value)) {
      for (const [i, v] of value.entries()) collect(v, `${at}[${i}]`, out)
      return
    }
    if (value === null || typeof value !== 'object') return

    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const isGateList =
        (key === 'requires' ||
          key === 'gate' ||
          key === 'prerequisites' ||
          key === 'unlock_requires') &&
        Array.isArray(child)
      if (isGateList) {
        for (const [i, entry] of (child as unknown[]).entries()) {
          const req = entry as Requirement
          if (typeof req?.type === 'string' && typeof req?.key === 'string') {
            out.push({ req, at: `${at}.${key}[${i}]` })
          }
        }
        continue
      }
      collect(child, `${at}.${key}`, out)
    }
  }

  for (const { records, file } of Object.values(loaded)) {
    const found: { req: Requirement; at: string }[] = []
    for (const [i, record] of records.entries()) collect(record, `[${i}]`, found)

    const unknown = new Map<string, number>()
    for (const { req } of found) {
      const target = targets[req.type]
      // Types with no dataset yet (building, tool, town_rank, hearts, item,
      // season_unlocked) are not checked here; they arrive with their datasets.
      if (target === undefined || target.size === 0) continue
      if (!target.has(req.key)) {
        const label = `${req.type}:${req.key}`
        unknown.set(label, (unknown.get(label) ?? 0) + 1)
      }
    }

    if (unknown.size > 0) {
      const listed = [...unknown.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 8)
        .map(([label, count]) => (count > 1 ? `${label} (x${count})` : label))
      findings.push(
        warn(
          'gate:unknown-target',
          `${unknown.size} gate${unknown.size === 1 ? '' : 's'} name something that does not exist: ${listed.join(', ')}`,
          `data/${file}`,
        ),
      )
    }
  }

  return findings
}
