import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

/**
 * Keys that carry in-game or wiki prose. Writing any of these is a hard error.
 *
 * This is defence in depth, not the primary control — the primary control is
 * that the Cargo fetcher never requests `Items.description` in the first place,
 * because not-fetching is a stronger guarantee than fetching-then-stripping.
 * This catches the other routes in: game-file extraction, a hand-edited curated
 * file, a helpful refactor.
 *
 * See docs/DATA-POLICY.md.
 */
const PROSE_KEY_DENYLIST =
  /^(description|desc|flavor_text|flavour_text|text|localization|localisation|tooltip|summary_text)$/i

export class ProseLeakError extends Error {
  constructor(
    readonly key: string,
    readonly path: string,
  ) {
    super(
      `Refusing to write "${key}" at ${path}: this key holds prose from the game or the wiki. ` +
        'Factual numbers are fine; descriptive text is not. See docs/DATA-POLICY.md.',
    )
    this.name = 'ProseLeakError'
  }
}

function assertNoProse(value: unknown, path = '$'): void {
  if (Array.isArray(value)) {
    for (const [i, v] of value.entries()) assertNoProse(v, `${path}[${i}]`)
    return
  }
  if (value === null || typeof value !== 'object') return

  for (const [key, child] of Object.entries(value)) {
    if (PROSE_KEY_DENYLIST.test(key)) throw new ProseLeakError(key, path)
    assertNoProse(child, `${path}.${key}`)
  }
}

/**
 * Recursively sort object keys so output is byte-stable.
 *
 * This is what makes the CI check "regenerate and `git diff --exit-code`"
 * possible, and that check is the only thing that makes a committed, generated
 * `data/` directory trustworthy. Without it, key order churns on every run and
 * the diff is noise.
 */
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value === null || typeof value !== 'object') return value

  const entries = Object.entries(value as Record<string, unknown>)
  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return Object.fromEntries(entries.map(([k, v]) => [k, sortKeys(v)]))
}

export interface WriteJsonOptions {
  /** Pretty (2-space) for `data/`, minified for the shipped bundle. */
  pretty?: boolean
}

/** Serialise deterministically, refusing prose. Returns the bytes written. */
export async function writeJson(
  path: string,
  value: unknown,
  { pretty = true }: WriteJsonOptions = {},
): Promise<number> {
  assertNoProse(value)
  const sorted = sortKeys(value)
  const text = pretty ? `${JSON.stringify(sorted, null, 2)}\n` : JSON.stringify(sorted)

  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, text, 'utf8')
  return Buffer.byteLength(text, 'utf8')
}

/** Exported for the validator, which re-checks files it did not write itself. */
export { assertNoProse, PROSE_KEY_DENYLIST }
