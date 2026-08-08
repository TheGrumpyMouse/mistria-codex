/**
 * Download the sprites, once, politely.
 *
 * `pnpm assets:fetch`. **Never runs in CI** — `assets/game/` is committed for
 * exactly the same reason `sources/` is: so a build is hermetic and wiki.gg is
 * left alone. A cold pass is roughly 1,250 files at one request a second, about
 * twenty minutes. It happens once.
 *
 * Everything here is fetched from public community endpoints, never from a game
 * install, so anyone cloning this repository can reproduce the asset set without
 * owning ripped copies of the files.
 */
import { createHash } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { argv, env } from 'node:process'
import { pathToFileURL } from 'node:url'
import { consola } from 'consola'
import { fetchBinary, fetchJson } from '../lib/http.js'
import { ASSETS_DIR, ASSETS_MANIFEST, BUILD_DIR, CACHE_DIR, CURATED_DIR } from '../lib/paths.js'
import { readJsonFile } from '../lib/read-json.js'
import { writeJson } from '../lib/write-json.js'
import { collectInventory, type InventoryEntry } from './inventory.js'
import {
  type AssetEntry,
  ATTRIBUTION_TEXT,
  MANIFEST_COMMENT,
  readManifestOrEmpty,
} from './manifest.js'
import { filePageUrl } from './names.js'
import { type PngSize, pngSize } from './png.js'

const sha256 = (buffer: Buffer): string => createHash('sha256').update(buffer).digest('hex')

/**
 * The date, without a time.
 *
 * A timestamp would rewrite every `fetched_at` on every run and turn a
 * three-sprite update into a 1,133-line diff, which is the fastest way to make a
 * register nobody reads.
 */
const today = (): string =>
  (env.SOURCE_DATE_EPOCH === undefined
    ? new Date()
    : new Date(Number(env.SOURCE_DATE_EPOCH) * 1000)
  )
    .toISOString()
    .slice(0, 10)

interface WikiConfig {
  endpoint: string
  throttleMs: number
}

/**
 * Is the file on disk the one the manifest describes?
 *
 * Checked by hash rather than by existence, because the failure worth catching
 * is the half-written file from an interrupted run. That file exists, so an
 * existence check calls it done and the app ships a truncated sprite.
 */
async function isIntact(path: string, expected: string): Promise<boolean> {
  try {
    return sha256(await readFile(path)) === expected
  } catch {
    return false
  }
}

/**
 * Rebuild a manifest entry from a sprite already on disk.
 *
 * Null when there is no such file, or when what is there is not a PNG — in which
 * case it gets re-fetched rather than described.
 */
async function adopt(entry: InventoryEntry, wiki: WikiConfig): Promise<AssetEntry | null> {
  let body: Buffer
  try {
    body = await readFile(join(ASSETS_DIR, entry.file))
  } catch {
    return null
  }

  const size = pngSize(body)
  if (size === null) return null
  return describe(entry, body, size, wiki)
}

/** A file the wiki names but does not have. The record keeps its drawn glyph. */
export interface AssetGap {
  source_file: string
  wanted_by: string[]
}

export interface FetchResult {
  fetched: number
  kept: number
  removed: number
  assets: AssetEntry[]
}

export async function fetchAssets({ dryRun = false } = {}): Promise<FetchResult> {
  const wiki = await readJsonFile<WikiConfig>(join(CURATED_DIR, 'vocab', 'wiki.json'))
  const inventory = await collectInventory()
  const previous = new Map((await readManifestOrEmpty()).assets.map((a) => [a.key, a]))

  consola.info(`assets: ${inventory.length} wanted`)

  const assets: AssetEntry[] = []
  const wanted: InventoryEntry[] = []
  let kept = 0

  for (const entry of inventory) {
    const known = previous.get(entry.key)

    // Unchanged and intact: keep the existing record verbatim, including its
    // original fetch date. Only the icon_keys are refreshed, because a new item
    // can start pointing at a sprite we already have.
    if (known !== undefined && (await isIntact(join(ASSETS_DIR, entry.file), known.sha256))) {
      assets.push({ ...known, icon_keys: entry.iconKeys })
      kept += 1
      continue
    }

    // **The directory is the checkpoint, not the manifest.** A run interrupted
    // at file 900 leaves 900 sprites on disk and no manifest; without this, the
    // next run has nothing to compare against and downloads all 900 again. The
    // file is either complete or absent — `fetch` buffers the whole body before
    // anything is written — so adopting what is already here is safe, and it
    // makes a long polite fetch resumable for free.
    const adopted = await adopt(entry, wiki)
    if (adopted !== null) {
      assets.push({ ...adopted, icon_keys: entry.iconKeys })
      kept += 1
      continue
    }

    wanted.push(entry)
  }

  if (dryRun) {
    for (const entry of wanted) {
      consola.log(`would fetch ${entry.sourceFile} -> assets/game/${entry.file}`)
    }
    return { fetched: 0, kept, removed: 0, assets }
  }

  // Resolve every URL before downloading anything, so a bad name is reported at
  // the start with the full list rather than partway through with one name.
  const { resolved, missing } =
    wanted.length === 0
      ? { resolved: new Map<string, string>(), missing: [] }
      : await resolveUrls(
          wanted.map((e) => e.sourceFile),
          wiki,
        )

  // A name we have never had, that the wiki does not have either, is the wiki's
  // own data disagreeing with itself — `Items.icon` says `Rabbit horns.png` and
  // the file is `Rabbit horn.png`. That is a gap: the record keeps its drawn
  // glyph and the name is written down. Correcting it here would be inventing a
  // filename, and a plural that happens to be right once is a habit that will be
  // wrong later.
  //
  // A name that *is* in the manifest and has gone missing is different — the
  // wiki renamed something we already ship — and that throws.
  const renamed = missing.filter((name) =>
    [...previous.values()].some((a) => a.source_file === name),
  )
  if (renamed.length > 0) {
    throw new Error(
      `the wiki has renamed ${renamed.map((m) => `"${m}"`).join(', ')}, which we already ship. ` +
        'Find the new name rather than dropping the sprite.',
    )
  }

  const gaps: AssetGap[] = []
  for (const name of missing) {
    const entry = wanted.find((e) => e.sourceFile === name)
    if (entry !== undefined) gaps.push({ source_file: name, wanted_by: entry.iconKeys })
  }
  if (gaps.length > 0) {
    consola.warn(
      `assets: the wiki names ${gaps.length} file(s) it does not have — ` +
        `${gaps.map((g) => g.source_file).join(', ')} (recorded in build/asset-gaps.json)`,
    )
    await writeJson(join(BUILD_DIR, 'asset-gaps.json'), { gaps })
  }

  const gapNames = new Set(gaps.map((g) => g.source_file))

  let fetched = 0
  for (const entry of wanted) {
    const url = resolved.get(entry.sourceFile)

    // Only a *recorded* gap may be skipped. Anything else means the resolver
    // answered under a key we are not looking for — MediaWiki normalises titles
    // on the way back — and skipping it silently is how eighteen villager
    // portraits went missing with no error anywhere. Silence is the bug.
    if (url === undefined) {
      if (gapNames.has(entry.sourceFile)) continue
      throw new Error(
        `no URL came back for "${entry.sourceFile}" (wanted by ${entry.iconKeys.join(', ')}), ` +
          'and it is not a recorded gap. The name we asked for is probably not the name the ' +
          'wiki normalised it to — canonicalise it in buildInventory.',
      )
    }

    assets.push(await download(entry, url, wiki))
    fetched += 1
    if (fetched % 100 === 0) consola.info(`assets: ${fetched}/${wanted.length} fetched`)
  }

  const removed = await pruneOrphans(assets, argv.includes('--prune'))

  assets.sort((a, b) => a.key.localeCompare(b.key))
  await writeJson(ASSETS_MANIFEST, {
    _comment: [...MANIFEST_COMMENT],
    attribution: ATTRIBUTION_TEXT,
    source: wiki.endpoint.replace(/\/index\.php$/, ''),
    assets,
  })

  return { fetched, kept, removed, assets }
}

/**
 * Ask the wiki where each file actually lives, fifty at a time.
 *
 * `Special:FilePath/X` works, but it is **three HTTP requests** — a 302 to
 * `Special:Redirect`, a 301 to `/images/X`, then the image — so a one-second
 * throttle is really three requests a second and wiki.gg rate-limited the run
 * within a minute. `action=query&prop=imageinfo` answers for fifty files in one
 * request and hands back the direct `/images/` URL, turning ~3,500 requests into
 * about 1,190.
 *
 * It also fails better. A file the wiki no longer has comes back explicitly
 * flagged `missing`, so **every rename is reported at once, before a single byte
 * is downloaded** — rather than one per run, twenty minutes apart.
 *
 * Never cached: the whole point is to see the wiki as it is right now.
 */
async function resolveUrls(
  names: string[],
  wiki: WikiConfig,
): Promise<{ resolved: Map<string, string>; missing: string[] }> {
  const api = wiki.endpoint.replace(/\/index\.php$/, '/api.php')

  // Resolution is checkpointed to disk after every batch. Without it, a rate
  // limit in batch twelve throws away the eleven batches before it, and the
  // retry re-asks the wiki everything it already answered — which is both slower
  // and ruder each time it happens.
  const cachePath = join(CACHE_DIR, 'image-urls.json')
  const known = await readCheckpoint(cachePath)

  const resolved = new Map<string, string>()
  const missing: string[] = []
  const unknown: string[] = []

  for (const name of names) {
    const cached = known[name]
    if (cached === undefined) unknown.push(name)
    else if (cached === null) missing.push(name)
    else resolved.set(name, cached)
  }

  // The API answers for fifty files at a time, so the throttle can afford to be
  // generous: twenty-four requests either way.
  const throttleMs = Math.max(wiki.throttleMs, 3000)

  for (let at = 0; at < unknown.length; at += 50) {
    const batch = unknown.slice(at, at + 50)
    const titles = batch.map((name) => `File:${name}`).join('|')
    const url =
      `${api}?action=query&format=json&prop=imageinfo&iiprop=url` +
      `&titles=${encodeURIComponent(titles)}`

    interface Page {
      title: string
      missing?: string
      imageinfo?: { url: string }[]
    }
    const response = await fetchJson<{ query?: { pages?: Record<string, Page> } }>(url, {
      throttleMs,
      useCache: false,
    })

    for (const page of Object.values(response.query?.pages ?? {})) {
      const name = page.title.replace(/^File:/, '')
      const direct = page.imageinfo?.[0]?.url ?? null
      known[name] = direct
      if (direct === null) missing.push(name)
      else resolved.set(name, direct)
    }

    await writeJson(cachePath, known)
    consola.info(`assets: resolved ${Math.min(at + 50, unknown.length)}/${unknown.length} URLs`)
  }

  return { resolved, missing: missing.sort() }
}

/** The URL checkpoint, or an empty one. `null` means the wiki has no such file. */
async function readCheckpoint(path: string): Promise<Record<string, string | null>> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as Record<string, string | null>
  } catch {
    return {}
  }
}

/**
 * One sprite.
 *
 * A **body that is not a PNG** throws rather than being written: it means the
 * wiki served an error page with a 200, which would otherwise land on disk as a
 * sprite and only be noticed when a player saw a broken image.
 */
async function download(entry: InventoryEntry, url: string, wiki: WikiConfig): Promise<AssetEntry> {
  const body = await fetchBinary(url, { throttleMs: wiki.throttleMs })

  const size = pngSize(body)
  if (size === null) {
    throw new Error(
      `"${entry.sourceFile}" came back as ${body.length} bytes that are not a PNG. ` +
        'The wiki served an error page with a 200; do not write it to disk.',
    )
  }

  const path = join(ASSETS_DIR, entry.file)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, body)

  return describe(entry, body, size, wiki)
}

/** The manifest record for a sprite, wherever the bytes came from. */
function describe(
  entry: InventoryEntry,
  body: Buffer,
  size: PngSize,
  wiki: WikiConfig,
): AssetEntry {
  return {
    key: entry.key,
    family: entry.family,
    file: entry.file,
    source_file: entry.sourceFile,
    source_url: filePageUrl(wiki.endpoint.replace(/\/index\.php$/, ''), entry.sourceFile),
    fetched_at: today(),
    sha256: sha256(body),
    bytes: body.length,
    width: size.width,
    height: size.height,
    icon_keys: entry.iconKeys,
  }
}

/**
 * Delete files nothing wants any more.
 *
 * Without this the directory only ever grows, and an unlisted file is a validate
 * error by design — so a renamed item would leave a sprite behind that fails the
 * build with no obvious cause.
 */
async function pruneOrphans(assets: AssetEntry[], force: boolean): Promise<number> {
  const { readdir } = await import('node:fs/promises')
  const wanted = new Set(assets.map((a) => a.file))
  let removed = 0

  let families: string[]
  try {
    families = (await readdir(ASSETS_DIR, { withFileTypes: true }))
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
  } catch {
    return 0
  }

  const orphans: string[] = []
  for (const family of families) {
    for (const file of await readdir(join(ASSETS_DIR, family))) {
      const relative = `${family}/${file}`
      if (!wanted.has(relative)) orphans.push(relative)
    }
  }

  // **A big prune is a bug, not a tidy-up.** Twenty portraits once left the
  // repository this way: an interrupted run produced a short inventory, the
  // prune removed everything missing from it, and the manifest was rewritten to
  // match — so disk and register agreed, validate passed, and the loss showed up
  // only in a diff nobody read. Removing a handful of renamed files is routine;
  // removing a tenth of the library means the inventory came back wrong.
  const limit = Math.max(20, Math.floor(assets.length * 0.1))
  if (!force && orphans.length > limit) {
    throw new Error(
      `refusing to remove ${orphans.length} of ${assets.length + orphans.length} assets — ` +
        'that is not a rename, it is an inventory that came back short. Check the enrichers ' +
        `ran, then re-run with --prune if the removal really is intended. First few: ` +
        orphans.slice(0, 5).join(', '),
    )
  }

  for (const relative of orphans) {
    await rm(join(ASSETS_DIR, relative))
    consola.warn(`assets: removed orphan ${relative}`)
    removed += 1
  }

  return removed
}

async function main(): Promise<void> {
  const dryRun = argv.includes('--dry-run')
  const result = await fetchAssets({ dryRun })
  const bytes = result.assets.reduce((sum, a) => sum + a.bytes, 0)

  consola.success(
    `assets: ${result.fetched} fetched, ${result.kept} already had, ` +
      `${result.removed} orphans removed — ${result.assets.length} files, ` +
      `${(bytes / 1024).toFixed(0)} KB`,
  )
}

const entry = argv[1]
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  main().catch((err: unknown) => {
    consola.error(err instanceof Error ? err.message : err)
    process.exitCode = 1
  })
}
