import { execFile } from 'node:child_process'
import type { Dirent } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { extname, join, relative } from 'node:path'
import { promisify } from 'node:util'
import { ASSETS_MANIFEST, CURATED_DIR, DATA_DIR, REPO_ROOT } from '../lib/paths.js'
import { PROSE_KEY_DENYLIST } from '../lib/write-json.js'
import { error, type Finding } from './report.js'

const execFileAsync = promisify(execFile)

/**
 * Fields allowed to hold more than a few words, because we wrote them.
 * Everything else being short is the tell: **long strings are the signature of
 * copied prose**, whether from the game or the wiki.
 */
const LONG_STRING_ALLOWLIST = new Set(['blurb', 'notes', 'note', 'reason'])
const MAX_STRING_LENGTH = 200

/**
 * Where an image may live.
 *
 * Our own art anywhere in this list; **the game's art only in `assets/game/`,
 * and only if the manifest names it.** That second condition is checked
 * separately below, in both directions — a file with no entry and an entry with
 * no file are both errors, because either drift turns the register into a lie
 * and a register nobody can trust is worse than none.
 */
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico'])
const IMAGE_ALLOWED_PREFIXES = [
  join('apps', 'web', 'src', 'assets'),
  // The app's own static root — the favicon and anything else we drew. Packed
  // atlases land under `public/assets/` and are skipped as build output below.
  join('apps', 'web', 'public'),
  join('assets', 'game'),
  join('curated', 'maps'),
  join('docs', 'assets'),
]

const GAME_ART_PREFIX = join('assets', 'game')

/**
 * Text files that could be a wiki page someone pasted in while writing a parser.
 *
 * JSON is deliberately **not** here. `sources/wiki/cargo/items.json` legitimately
 * holds `[[File:…]]` in its `icon` cells — that is the cell's real content, and
 * scanning it would fail the build on correct data.
 */
const WIKITEXT_SCAN_EXTENSIONS = new Set(['.txt', '.wiki', '.md'])

/**
 * Wikitext markers, and how many it takes to mean "this is a pasted page".
 *
 * Documentation talks *about* wikitext — CLAUDE.md names `[[File:…]]` three
 * times explaining that eighteen icon cells lack it. So presence alone cannot
 * be the test, and the threshold is set by measurement rather than taste: the
 * three cosmetics pages that prompted this carried 253, 538 and 595 markers,
 * and the wordiest real document in the repository carries 4. Anywhere in that
 * gap works; 10 leaves both sides a wide margin.
 *
 * A wikitable opener at the start of a line is on its own conclusive — no prose
 * document has ever begun a line with `{|` — so it short-circuits the count.
 */
const WIKITEXT_MARKERS = /\{\{|\[\[File:|\[\[Image:/g
const WIKITABLE_OPENER = /^\{\|/m
const WIKITEXT_THRESHOLD = 10

/** `apps/web/public/assets` is packed build output, like `public/data`. */
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.cache'])
const SKIP_PATHS = [join('apps', 'web', 'public', 'assets')]

async function* walk(dir: string): AsyncGenerator<string> {
  let entries: Dirent[]
  try {
    entries = await readdir(dir, { withFileTypes: true, encoding: 'utf8' })
  } catch {
    return
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) yield* walk(full)
    else yield full
  }
}

function scanValue(value: unknown, path: string, file: string, findings: Finding[]): void {
  if (Array.isArray(value)) {
    for (const [i, v] of value.entries()) scanValue(v, `${path}[${i}]`, file, findings)
    return
  }
  if (value === null || typeof value !== 'object') return

  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (PROSE_KEY_DENYLIST.test(key)) {
      findings.push(
        error(
          'licensing:prose-key',
          `"${key}" at ${path} holds in-game or wiki prose and must not be committed. ` +
            'See docs/DATA-POLICY.md.',
          file,
        ),
      )
    }

    if (
      typeof child === 'string' &&
      child.length > MAX_STRING_LENGTH &&
      !LONG_STRING_ALLOWLIST.has(key)
    ) {
      findings.push(
        error(
          'licensing:long-string',
          `"${key}" at ${path} is ${child.length} chars. Fields outside the allowlist must stay ` +
            `under ${MAX_STRING_LENGTH} — long strings are how copied prose gets in.`,
          file,
        ),
      )
    }

    scanValue(child, `${path}.${key}`, file, findings)
  }
}

/**
 * The only automated thing standing between good intentions and an accidental
 * licensing commit.
 *
 * It catches accidents, not judgement: nothing here can tell that a `blurb` is a
 * paraphrase of the in-game description. That rule is stated bluntly in
 * CLAUDE.md and CONTRIBUTING.md because it is the most tempting shortcut in the
 * project and no linter will ever catch it.
 */
export async function checkLicensing(): Promise<Finding[]> {
  const findings: Finding[] = []

  for (const dir of [DATA_DIR, CURATED_DIR]) {
    for await (const file of walk(dir)) {
      if (extname(file) !== '.json') continue
      const rel = relative(REPO_ROOT, file).replace(/\\/g, '/')

      let parsed: unknown
      try {
        parsed = JSON.parse(await readFile(file, 'utf8'))
      } catch {
        continue // the schema pass reports malformed JSON
      }
      scanValue(parsed, '$', rel, findings)
    }
  }

  const onDisk = new Set<string>()

  for await (const file of walk(REPO_ROOT)) {
    if (!IMAGE_EXTENSIONS.has(extname(file).toLowerCase())) continue
    const rel = relative(REPO_ROOT, file)
    if (SKIP_PATHS.some((prefix) => rel.startsWith(prefix))) continue

    if (rel.startsWith(GAME_ART_PREFIX)) {
      onDisk.add(relative(GAME_ART_PREFIX, rel).replace(/\\/g, '/'))
      continue
    }
    if (IMAGE_ALLOWED_PREFIXES.some((prefix) => rel.startsWith(prefix))) continue

    findings.push(
      error(
        'licensing:image',
        'image files may only live in our own asset directories, and game art only in ' +
          'assets/game/. Scattering it is what makes a takedown an archaeology project ' +
          'instead of one deletion. See docs/DATA-POLICY.md.',
        rel.replace(/\\/g, '/'),
      ),
    )
  }

  findings.push(...(await checkManifest(onDisk)))
  findings.push(...(await checkWikitext()))
  return findings
}

/**
 * No raw wiki page source, anywhere in the repository.
 *
 * The prose scan above walks JSON under `data/` and `curated/`, which is where
 * prose was expected to arrive. It is not where it actually arrived: three
 * cosmetics pages were pasted into `cos.txt`, `acc.txt` and `body.txt` at the
 * repo root while the price parser was being written, and committed. A `.txt`
 * at the root is outside every guard the project had — the prose scan skipped
 * it for not being JSON, the image check for not being an image — so verbatim
 * wiki sentences sat in a public repository whose own policy says *"page
 * wikitext is never committed"*.
 *
 * Parse the page, keep the facts, and let `sources/wiki/pages/` hold the
 * result. The input is scratch and does not belong in git.
 *
 * **Tracked files only**, which is the whole rule: pasting a page into a
 * scratch file to work out a parser is the normal way to write one, and
 * `.gitignore` already stops that file being committed. Failing the build on an
 * ignored working file would punish the correct workflow and teach people to
 * skip the check.
 */
async function checkWikitext(): Promise<Finding[]> {
  const findings: Finding[] = []
  const tracked = await trackedFiles()

  for await (const file of walk(REPO_ROOT)) {
    if (!WIKITEXT_SCAN_EXTENSIONS.has(extname(file).toLowerCase())) continue
    const rel = relative(REPO_ROOT, file)
    // `docs/` is gitignored and internal, so it cannot be committed anyway.
    if (SKIP_PATHS.some((prefix) => rel.startsWith(prefix)) || rel.startsWith('docs')) continue
    if (tracked !== null && !tracked.has(rel.replace(/\\/g, '/'))) continue

    let text: string
    try {
      text = await readFile(file, 'utf8')
    } catch {
      continue
    }

    const markers = text.match(WIKITEXT_MARKERS)?.length ?? 0
    if (!WIKITABLE_OPENER.test(text) && markers < WIKITEXT_THRESHOLD) continue

    findings.push(
      error(
        'licensing:wikitext',
        `this reads as raw wiki page source (${markers} wikitext markers). Page wikitext is ` +
          'never committed — parse it, keep the facts in sources/wiki/pages/, and leave the ' +
          'paste out of git. See docs/DATA-POLICY.md.',
        rel.replace(/\\/g, '/'),
      ),
    )
  }

  return findings
}

/**
 * Every path git tracks, or `null` when that cannot be determined.
 *
 * `null` rather than an empty set on purpose — an empty set is indistinguishable
 * from "git is missing" and would silently switch the check off. The caller
 * treats `null` as "scan everything", so a source tarball with no `.git` gets a
 * stricter check rather than no check.
 */
async function trackedFiles(): Promise<Set<string> | null> {
  try {
    const { stdout } = await execFileAsync('git', ['ls-files', '-z'], {
      cwd: REPO_ROOT,
      maxBuffer: 32 * 1024 * 1024,
    })
    const paths = stdout.split('\0').filter((p) => p !== '')
    return paths.length === 0 ? null : new Set(paths)
  } catch {
    return null
  }
}

/**
 * The manifest and the directory must describe each other exactly.
 *
 * Checked both ways round on purpose. **A file with no entry** is art that
 * entered the repository without going through `assets:fetch` — nothing records
 * where it came from, so `ATTRIBUTION.md` cannot credit it and a takedown would
 * miss it. **An entry with no file** is a register that claims to hold something
 * it does not, which is exactly as bad, because everything downstream trusts it.
 */
async function checkManifest(onDisk: Set<string>): Promise<Finding[]> {
  const findings: Finding[] = []

  let manifest: { assets?: { file?: string }[] }
  try {
    manifest = JSON.parse(await readFile(ASSETS_MANIFEST, 'utf8')) as typeof manifest
  } catch {
    // No manifest and no art is the normal state of a fresh clone before
    // `pnpm assets:fetch`; no manifest *and* art is not.
    for (const file of onDisk) {
      findings.push(
        error(
          'licensing:unmanifested',
          'game art with no assets/game/manifest.json to record where it came from.',
          `assets/game/${file}`,
        ),
      )
    }
    return findings
  }

  const listed = new Set(
    (manifest.assets ?? []).flatMap((a) => (a.file === undefined ? [] : [a.file])),
  )

  for (const file of onDisk) {
    if (listed.has(file)) continue
    findings.push(
      error(
        'licensing:unmanifested',
        'this file is not in assets/game/manifest.json, so nothing records where it came ' +
          'from or credits it. Fetch art with `pnpm assets:fetch`, never by hand.',
        `assets/game/${file}`,
      ),
    )
  }

  for (const file of listed) {
    if (onDisk.has(file)) continue
    findings.push(
      error(
        'licensing:missing-asset',
        `the manifest lists "${file}" but it is not on disk. Re-run \`pnpm assets:fetch\`.`,
        'assets/game/manifest.json',
      ),
    )
  }

  return findings
}
