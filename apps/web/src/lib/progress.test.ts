import { describe, expect, it } from 'vitest'
import { mergeProgress, type ProgressRow } from './progress'

/**
 * The merge is the entire sync protocol, so it is tested as a CRDT rather than
 * as a function: **commutative, associative, idempotent.** If any of those
 * fails, two devices can settle on different answers depending on which synced
 * first, and no amount of retrying fixes it.
 */

const same = (a: ProgressRow[], b: ProgressRow[]): void => {
  expect(a).toEqual(b)
}

/** Deterministic pseudo-random sets — reproducible, no dependency. */
function sample(seed: number, size: number): ProgressRow[] {
  const rows: ProgressRow[] = []
  let s = seed
  for (let i = 0; i < size; i += 1) {
    s = (s * 1103515245 + 12345) % 2147483648
    const key = `museum:item_${s % 20}`
    const t = ((s >> 5) % 1000) + 1
    rows.push({ key, t: s % 3 === 0 ? -t : t })
  }
  return rows
}

describe('mergeProgress', () => {
  it('takes the later write', () => {
    same(mergeProgress([{ key: 'museum:a', t: 10 }], [{ key: 'museum:a', t: 20 }]), [
      { key: 'museum:a', t: 20 },
    ])
  })

  it('lets a later un-check win over an earlier check', () => {
    // Unchecking has to propagate. If it did not, the next sync would resurrect
    // everything the other device removed.
    same(mergeProgress([{ key: 'museum:a', t: 10 }], [{ key: 'museum:a', t: -20 }]), [
      { key: 'museum:a', t: -20 },
    ])
  })

  it('lets a later check win over an earlier un-check', () => {
    same(mergeProgress([{ key: 'museum:a', t: -10 }], [{ key: 'museum:a', t: 20 }]), [
      { key: 'museum:a', t: 20 },
    ])
  })

  it('prefers done on an exact tie, in both argument orders', () => {
    // A tie must resolve the same way whichever side it arrives from, or the
    // merge is not commutative and the value oscillates.
    const done = [{ key: 'museum:a', t: 10 }]
    const undone = [{ key: 'museum:a', t: -10 }]
    same(mergeProgress(done, undone), [{ key: 'museum:a', t: 10 }])
    same(mergeProgress(undone, done), [{ key: 'museum:a', t: 10 }])
  })

  it('takes the union of two devices that checked different things', () => {
    const merged = mergeProgress(
      [
        { key: 'museum:a', t: 1 },
        { key: 'museum:b', t: 2 },
      ],
      [
        { key: 'museum:c', t: 3 },
        { key: 'museum:d', t: 4 },
      ],
    )
    expect(merged.map((r) => r.key)).toEqual(['museum:a', 'museum:b', 'museum:c', 'museum:d'])
  })

  it('is commutative', () => {
    for (let seed = 1; seed <= 50; seed += 1) {
      const a = sample(seed, 12)
      const b = sample(seed * 7 + 1, 12)
      same(mergeProgress(a, b), mergeProgress(b, a))
    }
  })

  it('is associative', () => {
    for (let seed = 1; seed <= 50; seed += 1) {
      const a = sample(seed, 8)
      const b = sample(seed * 3 + 2, 8)
      const c = sample(seed * 11 + 5, 8)
      same(mergeProgress(mergeProgress(a, b), c), mergeProgress(a, mergeProgress(b, c)))
    }
  })

  it('is idempotent', () => {
    for (let seed = 1; seed <= 50; seed += 1) {
      const a = sample(seed, 10)
      const once = mergeProgress(a, a)
      same(once, mergeProgress(once, once))
      // And merging a set into itself must not change it.
      same(once, mergeProgress(once, a))
    }
  })

  it('survives a device with a wrong clock', () => {
    // A skewed clock loses to a later real write rather than pinning the value
    // forever — the magnitude decides, and the honest device eventually exceeds
    // it. What must never happen is a crash or a lost key.
    const skewed = [{ key: 'museum:a', t: 9_999_999_999 }]
    const normal = [{ key: 'museum:a', t: 100 }]
    same(mergeProgress(skewed, normal), skewed)
    same(mergeProgress(normal, skewed), skewed)
  })
})
