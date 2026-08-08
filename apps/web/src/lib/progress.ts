import Dexie, { type Table } from 'dexie'

/**
 * What you have done, on this device.
 *
 * **One flat table, not a table per feature.** Museum donations land here today
 * and bugs caught, recipes learned and hearts reached will land in the same one
 * — keyed `domain:entityId`. That makes sync a single generic merge and means
 * adding a category later needs no migration and no change to the sync code. A
 * table per feature would have made every one of those a schema bump.
 *
 * **Every fact is `id -> ±epochSeconds`**, and that one decision is what makes
 * the whole thing a CRDT. Positive is done, negative is an explicit tombstone,
 * and merging is "take the larger absolute value, prefer positive on a tie" —
 * commutative, associative, idempotent. Two devices checking different things
 * converge to the union; unchecking propagates instead of being resurrected by
 * the next sync.
 */

export interface ProgressRow {
  /** `museum:ore_copper` — domain and entity, so one table serves every feature. */
  key: string
  /**
   * Seconds since the epoch, signed. Positive means done at that moment,
   * negative means explicitly undone at that moment.
   *
   * Seconds rather than milliseconds because this number is synced, compared
   * and stored thousands of times, and nothing here happens twice in a second.
   */
  t: number
}

class ProgressDatabase extends Dexie {
  progress!: Table<ProgressRow, string>

  constructor() {
    super('mistria-codex')
    this.version(1).stores({ progress: 'key' })
  }
}

export const db = new ProgressDatabase()

export const nowSeconds = (): number => Math.floor(Date.now() / 1000)

/** `museum:ore_copper`. */
export const progressKey = (domain: string, id: string): string => `${domain}:${id}`

/**
 * Mark something done or undone.
 *
 * Undone writes a **tombstone**, never a deletion. A deleted row is
 * indistinguishable from a row this device has not seen yet, so the next sync
 * would treat the other device's "done" as newer and silently re-check it.
 */
export async function setDone(domain: string, id: string, done: boolean): Promise<void> {
  const t = nowSeconds()
  await db.progress.put({ key: progressKey(domain, id), t: done ? t : -t })
}

/** Every id currently marked done in a domain. */
export async function doneIn(domain: string): Promise<Set<string>> {
  const prefix = `${domain}:`
  const rows = await db.progress.where('key').startsWith(prefix).toArray()
  return new Set(rows.filter((row) => row.t > 0).map((row) => row.key.slice(prefix.length)))
}

/**
 * Merge two progress sets. The whole sync protocol is this function.
 *
 * Larger absolute timestamp wins; a tie prefers positive. **Ties must resolve
 * deterministically or the merge is not commutative** — two devices would settle
 * on different answers depending on which merged first, and the set would
 * oscillate forever.
 */
export function mergeProgress(a: readonly ProgressRow[], b: readonly ProgressRow[]): ProgressRow[] {
  const merged = new Map<string, number>()

  for (const row of [...a, ...b]) {
    const existing = merged.get(row.key)
    if (existing === undefined) {
      merged.set(row.key, row.t)
      continue
    }
    const mine = Math.abs(row.t)
    const theirs = Math.abs(existing)
    if (mine > theirs) merged.set(row.key, row.t)
    else if (mine === theirs && row.t > existing) merged.set(row.key, row.t)
  }

  return [...merged.entries()]
    .map(([key, t]) => ({ key, t }))
    .sort((x, y) => x.key.localeCompare(y.key))
}

/** Everything, for a sync push. */
export async function allProgress(): Promise<ProgressRow[]> {
  return await db.progress.orderBy('key').toArray()
}

/** Replace local state with a merged set. Used after a pull. */
export async function applyMerged(rows: ProgressRow[]): Promise<void> {
  await db.progress.bulkPut(rows)
}
