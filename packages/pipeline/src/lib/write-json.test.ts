import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ProseLeakError, writeJson } from './write-json.js'

let dir: string

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mistria-writejson-'))
})
afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
})

/**
 * The denylist is defence in depth — the primary control is that the Cargo
 * fetcher never asks for `Items.description`. These tests exist because the
 * other routes in (game-file extraction, a hand-edited curated file) have no
 * such control.
 */
describe('prose denylist', () => {
  it('refuses a top-level description', async () => {
    await expect(
      writeJson(join(dir, 'a.json'), [{ id: 'apple', description: 'A crisp red apple.' }]),
    ).rejects.toBeInstanceOf(ProseLeakError)
  })

  it('refuses a description nested anywhere', async () => {
    await expect(
      writeJson(join(dir, 'b.json'), { a: { b: [{ c: { flavour_text: 'oh no' } }] } }),
    ).rejects.toBeInstanceOf(ProseLeakError)
  })

  it('refuses localisation under either spelling', async () => {
    await expect(writeJson(join(dir, 'c.json'), { localization: {} })).rejects.toBeInstanceOf(
      ProseLeakError,
    )
    await expect(writeJson(join(dir, 'd.json'), { localisation: {} })).rejects.toBeInstanceOf(
      ProseLeakError,
    )
  })

  it('names the offending key so the failure explains itself', async () => {
    await expect(writeJson(join(dir, 'e.json'), { tooltip: 'x' })).rejects.toThrow(/tooltip/)
  })

  it('allows our own blurb, which is the sanctioned alternative', async () => {
    await expect(
      writeJson(join(dir, 'f.json'), [{ id: 'apple', blurb: 'Sells for 45t. Fall tree fruit.' }]),
    ).resolves.toBeGreaterThan(0)
  })
})

/**
 * Byte-stable output is what makes the CI check "regenerate and
 * `git diff --exit-code`" possible, and that check is the only thing that makes
 * a committed, generated `data/` directory trustworthy.
 */
describe('determinism', () => {
  it('sorts object keys at every depth', async () => {
    await writeJson(join(dir, 'sorted.json'), { z: 1, a: { y: 2, b: { n: 3, m: 4 } } })
    const text = await readFile(join(dir, 'sorted.json'), 'utf8')
    expect(text).toBe(
      '{\n  "a": {\n    "b": {\n      "m": 4,\n      "n": 3\n    },\n    "y": 2\n  },\n  "z": 1\n}\n',
    )
  })

  it('produces identical bytes for inputs differing only in key order', async () => {
    await writeJson(join(dir, 'one.json'), { b: 1, a: 2 })
    await writeJson(join(dir, 'two.json'), { a: 2, b: 1 })
    expect(await readFile(join(dir, 'one.json'), 'utf8')).toBe(
      await readFile(join(dir, 'two.json'), 'utf8'),
    )
  })

  it('preserves array order, which is meaningful', async () => {
    await writeJson(join(dir, 'arr.json'), [3, 1, 2])
    expect(JSON.parse(await readFile(join(dir, 'arr.json'), 'utf8'))).toEqual([3, 1, 2])
  })

  it('minifies when asked, for the shipped bundle', async () => {
    await writeJson(join(dir, 'min.json'), { a: 1, b: 2 }, { pretty: false })
    expect(await readFile(join(dir, 'min.json'), 'utf8')).toBe('{"a":1,"b":2}')
  })
})
