/**
 * `pnpm assets:game` — sprites the wiki does not host, from the game install.
 *
 * The wiki path stays primary: everything it hosts is fetched by
 * `assets:fetch` and this step never replaces a wiki-sourced sprite. What it
 * covers is the art the wiki has no file for at all — the 1.0 items its
 * Items table predates, the furniture set (no cargo table carries furniture
 * art; checked live 2026-08-08), and the fish silhouettes the game shows in
 * the water. Every item names its own `icon_sprite` in its TOML, so the
 * mapping is exact, never guessed.
 *
 * Policy: this is the one script that reads `MISTRIA_GAME_DIR` for images,
 * under the owner's decision of 2026-08-08 (see docs/DATA-POLICY.md). The
 * output obeys every existing rule — files land only under `assets/game/`,
 * every one is manifested (marked `origin: "game_files"`) and credited in
 * ATTRIBUTION.md, and `git rm -r assets/game` remains the whole takedown. A
 * clone without a game install simply keeps drawn glyphs for these records,
 * exactly like a clone that never ran `assets:fetch`.
 *
 * Never runs in CI. Deterministic given the same install and inputs.
 */
import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, relative, sep } from 'node:path'
import process, { argv, env } from 'node:process'
import { pathToFileURL } from 'node:url'
import { consola } from 'consola'
import { gameRoot } from '../extract/toml.js'
import { ASSETS_DIR, ASSETS_MANIFEST, DATA_DIR, REPO_ROOT, SOURCES_DIR } from '../lib/paths.js'
import { readJsonFile } from '../lib/read-json.js'
import { writeJson } from '../lib/write-json.js'
import {
  type AssetEntry,
  ATTRIBUTION_TEXT,
  MANIFEST_COMMENT,
  readManifestOrEmpty,
} from './manifest.js'
import { pngSize } from './png.js'

const sha256 = (buffer: Buffer): string => createHash('sha256').update(buffer).digest('hex')

const today = (): string =>
  (env.SOURCE_DATE_EPOCH === undefined
    ? new Date()
    : new Date(Number(env.SOURCE_DATE_EPOCH) * 1000)
  )
    .toISOString()
    .slice(0, 10)

/** One sprite to copy: the game's sprite name, and who wants it. */
interface GameWant {
  family: 'item' | 'ui'
  sprite: string
  iconKeys: string[]
}

/**
 * The in-water silhouettes, one per shadow size the fish facet records. The
 * `_0_swim` frame is the level swimming pose — the other angles are the same
 * shape rotated.
 */
const FISH_SILHOUETTES: GameWant[] = ['small', 'medium', 'large', 'giant'].map((size) => ({
  family: 'ui',
  sprite: `spr_fish_silhouette_${size}_0_swim`,
  iconKeys: [`ui/fish_shadow_${size}`],
}))

/** Every PNG under `animations/`, indexed by basename. ~30k files, one walk. */
async function indexSprites(root: string): Promise<Map<string, string>> {
  const base = join(root, 'animations')
  const index = new Map<string, string>()

  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) await walk(path)
      else if (entry.name.endsWith('.png')) {
        index.set(entry.name.replace(/\.png$/, ''), path)
      }
    }
  }
  await walk(base)
  return index
}

async function collectWants(covered: Set<string>): Promise<GameWant[]> {
  interface DataItem {
    id: string
    icon_key: string | null
    variant_ids?: string[]
  }
  interface GameItem {
    id: string
    icon_sprite: string | null
  }

  const items = await readJsonFile<DataItem[]>(join(DATA_DIR, 'items.json'))
  const game = await readJsonFile<{ items: GameItem[] }>(join(SOURCES_DIR, 'game', 'items.json'))
  const spriteById = new Map(game.items.map((item) => [item.id, item.icon_sprite] as const))

  // One want per sprite, however many records point at it.
  const bySprite = new Map<string, GameWant>()
  let unsourced = 0
  for (const record of items) {
    if (record.icon_key === null || covered.has(record.icon_key)) continue
    // A collapsed furniture group's canonical member is its first variant.
    const sprite = spriteById.get(record.id) ?? spriteById.get(record.variant_ids?.[0] ?? '')
    if (sprite === null || sprite === undefined) {
      unsourced += 1
      continue
    }
    const want = bySprite.get(sprite) ?? { family: 'item' as const, sprite, iconKeys: [] }
    want.iconKeys.push(record.icon_key)
    bySprite.set(sprite, want)
  }
  if (unsourced > 0) {
    consola.info(`assets:game — ${unsourced} uncovered records name no game sprite either`)
  }

  return [...bySprite.values(), ...FISH_SILHOUETTES].sort((a, b) =>
    a.sprite.localeCompare(b.sprite),
  )
}

export async function copyGameArt({ dryRun = false } = {}): Promise<number> {
  const root = await gameRoot()
  const manifest = await readManifestOrEmpty()

  // Wiki-sourced art always wins; this step only fills what it left open.
  const covered = new Set(
    manifest.assets.filter((a) => a.origin !== 'game_files').flatMap((a) => a.icon_keys),
  )
  const wants = await collectWants(covered)
  consola.info(`assets:game — ${wants.length} sprites wanted from the install`)
  if (dryRun) {
    for (const want of wants.slice(0, 20)) consola.log(`would copy ${want.sprite}`)
    return 0
  }

  const sprites = await indexSprites(root)
  const missing = wants.filter((w) => !sprites.has(w.sprite))
  if (missing.length > 0) {
    // An icon_sprite the install cannot produce is a misread, not a gap.
    throw new Error(
      `assets:game — ${missing.length} sprite(s) named by the files are not in the install: ` +
        missing
          .slice(0, 5)
          .map((m) => m.sprite)
          .join(', '),
    )
  }

  const entries: AssetEntry[] = []
  for (const want of wants) {
    const sourcePath = sprites.get(want.sprite)
    if (sourcePath === undefined) continue
    const body = await readFile(sourcePath)
    const size = pngSize(body)
    if (size === null) throw new Error(`assets:game — ${want.sprite}.png is not a PNG`)

    const file = `${want.family}/${want.sprite}.png`
    const target = join(ASSETS_DIR, file)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, body)

    const gameRelative = relative(root, sourcePath).split(sep).join('/')
    entries.push({
      key: `${want.family}/${want.sprite}`,
      family: want.family,
      file,
      source_file: gameRelative,
      // Not a fetchable URL, deliberately: these bytes come from an owned
      // install, and the scheme says so anywhere the value surfaces.
      source_url: `game://${gameRelative}`,
      fetched_at: today(),
      sha256: sha256(body),
      bytes: body.length,
      width: size.width,
      height: size.height,
      icon_keys: [...new Set(want.iconKeys)].sort(),
      origin: 'game_files',
    })
  }

  // Replace the previous game-sourced set wholesale; wiki entries untouched.
  const assets = [...manifest.assets.filter((a) => a.origin !== 'game_files'), ...entries].sort(
    (a, b) => a.key.localeCompare(b.key),
  )
  await writeJson(ASSETS_MANIFEST, {
    _comment: [...MANIFEST_COMMENT],
    attribution: ATTRIBUTION_TEXT,
    source: manifest.source,
    assets,
  })

  return entries.length
}

async function main(): Promise<void> {
  try {
    process.loadEnvFile(join(REPO_ROOT, '.env'))
  } catch {
    /* no .env */
  }
  const copied = await copyGameArt({ dryRun: argv.includes('--dry-run') })
  consola.success(`assets:game — ${copied} sprites copied from the install and manifested`)
}

const entry = argv[1]
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  main().catch((err: unknown) => {
    consola.error(err instanceof Error ? err.message : err)
    process.exitCode = 1
  })
}
