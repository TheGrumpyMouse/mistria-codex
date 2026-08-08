import type { Loaded } from './load.js'
import { error, type Finding, warn } from './report.js'

interface SetRecord {
  id: string
  name: string
  wing: string
  item_ids: string[]
  required_count: number
}

interface ItemRecord {
  id: string
  name: string
  museum: { donatable: boolean; set_id: string | null; wing: string | null } | null
}

/**
 * The museum's own integrity rules.
 *
 * These turn museum curation from a vague chore into a burn-down list: anything
 * violating them is a specific, actionable line in the report rather than a
 * silent hole a player only finds when their tracker won't reach 100%.
 *
 * Every one of these caught a real bug on its first run:
 * - "exactly one set" caught 21 mine bugs being claimed by the archaeology wing,
 *   because Artifacts and Bugs both have sets called "Upper Mines".
 * - "every donatable item assigned" caught nine item names carrying an
 *   undecoded `&#039;`, which slugified to garbage and matched nothing.
 */
export function checkMuseum(loaded: Loaded): Finding[] {
  const findings: Finding[] = []
  const sets = loaded.museum_sets.records as SetRecord[]
  const items = loaded.items.records as ItemRecord[]

  if (sets.length === 0 || items.length === 0) return findings

  // 1. No item may belong to two sets — the tracker would double-count it.
  const claimedBy = new Map<string, string>()
  for (const set of sets) {
    for (const itemId of set.item_ids) {
      const existing = claimedBy.get(itemId)
      if (existing !== undefined && existing !== set.id) {
        findings.push(
          error(
            'museum:double-claimed',
            `"${itemId}" is in both ${existing} and ${set.id}`,
            'data/museum_sets.json',
          ),
        )
      }
      claimedBy.set(itemId, set.id)
    }
  }

  // 2. required_count is per-set data, not a constant. The Legendary Fish set
  //    needs four items, not five; hardcoding five anywhere would make the
  //    museum permanently un-completable.
  for (const set of sets) {
    if (set.item_ids.length !== set.required_count) {
      findings.push(
        error(
          'museum:count-mismatch',
          `${set.id} lists ${set.item_ids.length} items but requires ${set.required_count}`,
          'data/museum_sets.json',
        ),
      )
    }
  }

  // 3. Every set member must be a real item.
  const itemIds = new Set(items.map((i) => i.id))
  for (const set of sets) {
    for (const itemId of set.item_ids) {
      if (!itemIds.has(itemId)) {
        findings.push(
          error('museum:unknown-item', `${set.id} claims "${itemId}"`, 'data/museum_sets.json'),
        )
      }
    }
  }

  // 4. Every donatable item should belong to a set. A warning, not an error:
  //    the wiki can mark something donatable before the wing page lists it, and
  //    that is a curation to-do rather than a broken build.
  const setIds = new Set(sets.map((s) => s.id))
  const unassigned: string[] = []
  for (const item of items) {
    if (item.museum?.donatable !== true) continue
    if (item.museum.set_id === null) {
      unassigned.push(item.name)
      continue
    }
    if (!setIds.has(item.museum.set_id)) {
      findings.push(
        error(
          'museum:bad-set-ref',
          `"${item.name}" points at set "${item.museum.set_id}", which does not exist`,
          'data/items.json',
        ),
      )
    }
  }

  if (unassigned.length > 0) {
    findings.push(
      warn(
        'museum:unassigned',
        `${unassigned.length} donatable items belong to no set: ${unassigned.slice(0, 8).join(', ')}`,
        'data/items.json',
      ),
    )
  }

  // 5. An item in a set that isn't flagged donatable is a contradiction between
  //    the wing page and the item table — worth knowing about either way.
  const donatable = new Set(items.filter((i) => i.museum?.donatable === true).map((i) => i.id))
  const claimedNotDonatable = [...claimedBy.keys()].filter((id) => !donatable.has(id))
  if (claimedNotDonatable.length > 0) {
    findings.push(
      warn(
        'museum:not-flagged-donatable',
        `${claimedNotDonatable.length} items are in a set but not flagged donatable: ` +
          claimedNotDonatable.slice(0, 8).join(', '),
        'data/museum_sets.json',
      ),
    )
  }

  return findings
}
