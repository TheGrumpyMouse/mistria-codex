/**
 * Reading the game's own data files.
 *
 * The game ships its content as TOML under `assets/fiddle/`, one table per
 * entity keyed by the internal snake_case name — which is exactly the key this
 * whole dataset uses. See docs/game-file-extraction.md for how to unpack it.
 *
 * Two things this module exists to enforce:
 *
 * **The install path is never committed.** It comes from `MISTRIA_GAME_DIR` and
 * differs on every machine. Nothing here writes into it, and nothing reads
 * outside it — `resolveIn` refuses a path that escapes the root, so a bad vocab
 * entry cannot turn the extractor into a file reader.
 *
 * **Sentinels are not values.** The game writes `false` for "no restriction"
 * and `"<..>"` for "derive this from the name at runtime". Both look like data
 * to a naive reader and neither is: `weather = false` means *any* weather, and
 * storing it as the boolean would tell the app a fish bites in no weather at
 * all. Every accessor below distinguishes absent, sentinel, and value.
 */
import { readdir, readFile, stat } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { env } from 'node:process'
import { parse } from 'smol-toml'

/** `"<..>"` — the game's "work this out from the name" sentinel. */
export const DERIVE = '<..>'
/** `"<n/a>"` — the game's "this entity has none of these" sentinel. */
export const NOT_APPLICABLE = '<n/a>'

export class GameFilesError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GameFilesError'
  }
}

/**
 * Where the unpacked `assets/` folder lives on this machine.
 *
 * Deliberately not defaulted. A default would let a machine without the game
 * silently extract nothing and overwrite a good snapshot with an empty one —
 * the failure mode `sources/` exists to prevent.
 */
export async function gameRoot(): Promise<string> {
  const dir = env.MISTRIA_GAME_DIR
  if (dir === undefined || dir.trim() === '') {
    throw new GameFilesError(
      'MISTRIA_GAME_DIR is not set. Point it at the unpacked assets folder — the one ' +
        'containing fiddle/ — and set MISTRIA_GAME_VERSION to the build it came from. ' +
        'See docs/game-file-extraction.md.',
    )
  }

  const root = resolve(dir.trim())
  const fiddle = join(root, 'fiddle')
  const found = await stat(fiddle).catch(() => null)
  if (found === null || !found.isDirectory()) {
    throw new GameFilesError(
      `${root} has no fiddle/ directory. MISTRIA_GAME_DIR must point at the unpacked ` +
        'assets folder, not the install root and not the zip.',
    )
  }
  return root
}

/**
 * The build the extract came from, stamped onto every numeric id.
 *
 * Required rather than defaulted: a numeric id is an enum ordinal assigned at
 * compile time, so it is meaningless without the version it was read at, and a
 * guessed version is worse than none.
 */
export function gameVersion(): string {
  const version = env.MISTRIA_GAME_VERSION?.trim()
  if (version === undefined || version === '') {
    throw new GameFilesError(
      'MISTRIA_GAME_VERSION is not set. Numeric ids are enum ordinals assigned at ' +
        'compile time — they mean nothing without the build they were read from.',
    )
  }
  return version
}

/** Join under `root`, refusing anything that escapes it. */
export function resolveIn(root: string, ...parts: string[]): string {
  const path = resolve(root, ...parts)
  const rel = relative(root, path)
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new GameFilesError(`Refusing to read ${path}: outside MISTRIA_GAME_DIR.`)
  }
  return path
}

/**
 * Every `.toml` under a directory, sorted, with POSIX-style relative paths.
 *
 * Sorted because the extract is committed and CI diffs it — directory order is
 * not stable across filesystems, and unsorted output would churn every run on
 * a different machine. POSIX separators for the same reason.
 */
export async function tomlFiles(root: string, subdir: string): Promise<string[]> {
  const base = resolveIn(root, subdir)
  const out: string[] = []

  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) await walk(path)
      else if (entry.name.endsWith('.toml')) out.push(relative(base, path).split(sep).join('/'))
    }
  }

  await walk(base)
  return out.sort()
}

export type Table = Record<string, unknown>

/** Parse one file, naming it if the parser objects. */
export async function readToml(path: string): Promise<Table> {
  const source = await readFile(path, 'utf8')
  try {
    return parse(source) as Table
  } catch (cause) {
    throw new GameFilesError(
      `${path}: ${cause instanceof Error ? cause.message : String(cause)}. The game uses ` +
        'TOML freely — fix the parser rather than skipping the file, because a skipped ' +
        'file is a whole category quietly missing.',
    )
  }
}

/** Top-level tables, in file order, skipping scalar keys and `[default]`. */
export function entries(
  doc: Table,
  { skip = ['default'] }: { skip?: string[] } = {},
): [string, Table][] {
  const out: [string, Table][] = []
  for (const [key, value] of Object.entries(doc)) {
    if (skip.includes(key)) continue
    if (value === null || typeof value !== 'object' || Array.isArray(value)) continue
    out.push([key, value as Table])
  }
  return out
}

/** The `[default]` table a file's entries inherit from, or an empty one. */
export function defaults(doc: Table): Table {
  const table = doc.default
  return table !== null && typeof table === 'object' && !Array.isArray(table)
    ? (table as Table)
    : {}
}

/** Read a field, falling back to the file's `[default]`. */
export const field = (table: Table, base: Table, key: string): unknown =>
  table[key] !== undefined ? table[key] : base[key]

/** A string, or null for absent, empty, or either sentinel. */
export function str(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (trimmed === '' || trimmed === DERIVE || trimmed === NOT_APPLICABLE) return null
  return trimmed
}

/** A finite number, or null. Never coerces a numeric string — a formula is not a value. */
export const num = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null

/** A boolean, or null. `false` is a real answer here, so absence must be distinct. */
export const bool = (value: unknown): boolean | null => (typeof value === 'boolean' ? value : null)

/**
 * A list of strings.
 *
 * The game writes a one-element list as a bare string (`water_type = "river"`)
 * and "unrestricted" as `false`. Both arrive here; `false` becomes null, which
 * every caller must read as *all* rather than *none*.
 */
export function strList(value: unknown): string[] | null {
  if (value === false || value === undefined || value === null) return null
  if (typeof value === 'string') {
    const one = str(value)
    return one === null ? null : [one]
  }
  if (!Array.isArray(value)) return null
  const out = value.map(str).filter((v): v is string => v !== null)
  return out.length > 0 ? out : null
}

/** A two-number range, or null. Used for the game's `[from, to]` hour windows. */
export function range(value: unknown): [number, number] | null {
  if (!Array.isArray(value) || value.length !== 2) return null
  const from = num(value[0])
  const to = num(value[1])
  return from === null || to === null ? null : [from, to]
}

/** A nested table, or null. */
export function table(value: unknown): Table | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Table)
    : null
}
