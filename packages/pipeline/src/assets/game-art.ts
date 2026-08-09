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
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, relative, sep } from 'node:path'
import process, { argv, env } from 'node:process'
import { pathToFileURL } from 'node:url'
import { consola } from 'consola'
import { gameRoot, num, readToml, type Table, table } from '../extract/toml.js'
import { ASSETS_DIR, ASSETS_MANIFEST, DATA_DIR, REPO_ROOT, SOURCES_DIR } from '../lib/paths.js'
import { readJsonFile } from '../lib/read-json.js'
import { writeJson } from '../lib/write-json.js'
import { type CropRect, cropPng } from './crop.js'
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
  family: 'item' | 'ui' | 'cosmetic'
  sprite: string
  /**
   * The manifest key and filename stem, when one sprite yields more than one
   * asset. Defaults to `sprite`, which is right for every want but the fish
   * frames — four crops of one strip would otherwise collide on one key and
   * the last written would silently win.
   */
  name?: string
  iconKeys: string[]
  /**
   * True when the sprite name was worked out from a naming convention rather
   * than read from a field.
   *
   * The difference decides what a miss means. An `icon_sprite` is the game
   * telling us the filename, so an install that does not have it means we
   * misread something and the run must stop. A derived name is our guess at
   * the convention, so a miss is a record with no art — the ordinary case this
   * whole fallback exists for, and stopping on it would make one unusual
   * wardrobe entry break every other sprite's copy.
   */
  derived?: true
  /** Take a rectangle out of the source rather than the whole file. */
  crop?: CropRect
}

/**
 * One window over all four silhouettes, and it must stay one window.
 *
 * The files are 388×97 strips of four 97×97 frames, and inside that shared
 * canvas each fish is drawn at its **true relative size** — 12×5 pixels for a
 * small one up to 31×16 for a giant, all centred on roughly the same point. So
 * the same rectangle over each turns four sprites into a size chart, which is
 * the entire reason the app shows them. Cropping each to its own content, or
 * letting the icon box scale each to fit, would make all four the same size and
 * throw away the only thing they say.
 *
 * The rectangle is the union of the four fish plus a margin of water, centred
 * on where they sit rather than on the frame — they swim left of centre.
 */
const FISH_SHADOW_WINDOW: CropRect = { x: 6, y: 33, width: 64, height: 32 }

const FISH_SIZES = ['small', 'medium', 'large', 'giant'] as const

/**
 * The in-water silhouettes: every frame of the swim cycle, at every size.
 *
 * The `_0_swim` file is the level swimming pose — the other numbered files are
 * the same shape pitched up or down — and it is an **animation strip**, not a
 * picture. Its sibling `.meta.toml` says so: `frame_size = [97, 97]`,
 * `frame_len = 4`, `duration = 0.1`. The tail wags across those four frames,
 * which is the difference between a fish and a blob.
 *
 * The count and the frame width are **read from that file, never assumed**. A
 * hardcoded four would be a guess that happens to be right today, and the
 * failure mode — cropping past the end of a shorter strip, or silently
 * dropping frames of a longer one — is exactly the kind that looks fine until
 * someone notices the fish has stopped swimming.
 *
 * No meta, or a meta that does not describe a strip: one frame, the same
 * still we shipped before. Never a guessed second frame.
 */
async function fishSilhouetteWants(sprites: Map<string, string>): Promise<GameWant[]> {
  const wants: GameWant[] = []

  for (const size of FISH_SIZES) {
    const sprite = `spr_fish_silhouette_${size}_0_swim`
    const path = sprites.get(sprite)
    if (path === undefined) continue

    const { frames, frameWidth } = await animationShape(path)
    for (let frame = 0; frame < frames; frame += 1) {
      wants.push({
        family: 'ui',
        sprite,
        // Frame 0 keeps the unsuffixed key it has always had, so a bundle
        // packed before this change still resolves a still silhouette. A
        // missing sprite is normal; a missing *frame* must be too.
        name: frame === 0 ? sprite : `${sprite}_f${frame}`,
        iconKeys: [frame === 0 ? `ui/fish_shadow_${size}` : `ui/fish_shadow_${size}_${frame}`],
        crop: { ...FISH_SHADOW_WINDOW, x: FISH_SHADOW_WINDOW.x + frame * frameWidth },
      })
    }
  }

  return wants
}

/** `frame_len` and `frame_size` off a sprite's sibling `.meta.toml`. */
async function animationShape(pngPath: string): Promise<{ frames: number; frameWidth: number }> {
  const still = { frames: 1, frameWidth: 0 }
  let doc: Table
  try {
    doc = await readToml(pngPath.replace(/\.png$/, '.meta.toml'))
  } catch {
    return still
  }

  const asset = table(doc.asset_properties)
  const frames = num(asset?.frame_len)
  const frameSize = asset?.frame_size
  const frameWidth = Array.isArray(frameSize) ? num(frameSize[0]) : null
  if (frames === null || frameWidth === null || frames < 1 || frameWidth < 1) return still
  return { frames, frameWidth }
}

/**
 * Chrome the wiki hosts all but one of.
 *
 * The five `quest/*` icons already in the manifest are the wiki's copies of the
 * game's own journal subicons — same artwork, same set. The wiki simply never
 * uploaded the festival one, so seven festival quests drew a scroll glyph next
 * to six siblings drawing their real icon, which reads as a missing file rather
 * than a style. Taken from the install because that is where it exists.
 *
 * `quest/cooking_challenge` stays a gap: the install has no subicon for it, and
 * picking a neighbouring one because it is nearby would be inventing an answer.
 */
const UI_ICONS: GameWant[] = [
  {
    family: 'ui',
    sprite: 'spr_ui_journal_quests_festival_subicon',
    iconKeys: ['quest/festival'],
  },
]

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

/**
 * The wardrobe names no sprite anywhere, but the install names it the same way
 * every time: `spr_ui_item_wearable_<cosmetic id>`.
 *
 * A cosmetic is not an item — it lives in `player_assets.toml`, outside the
 * `ItemId` enum — so `sources/game/items.json` will never hold it and the
 * extractor drops the rendering keys it does have (`lut` is a palette, not an
 * icon). Our record id *is* the game's table key, which is what makes the
 * convention safe to lean on. The `_merged` variant is the one exception the
 * install ships: a couple of pieces are drawn from layered parts and only the
 * flattened frame is a usable icon.
 */
const cosmeticSprites = (id: string): string[] => [
  `spr_ui_item_wearable_${id}`,
  `spr_ui_item_wearable_${id}_merged`,
]

async function collectWants(
  covered: Set<string>,
  sprites: Map<string, string>,
): Promise<GameWant[]> {
  interface DataItem {
    id: string
    category: string
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
    const stated = spriteById.get(record.id) ?? spriteById.get(record.variant_ids?.[0] ?? '')
    const derived =
      record.category === 'cosmetic'
        ? cosmeticSprites(record.id).find((name) => sprites.has(name))
        : undefined
    const sprite = stated ?? derived

    if (sprite === null || sprite === undefined) {
      unsourced += 1
      continue
    }
    const want = bySprite.get(sprite) ?? {
      sprite,
      iconKeys: [],
      family: record.category === 'cosmetic' ? ('cosmetic' as const) : ('item' as const),
      ...(stated == null ? { derived: true as const } : {}),
    }
    want.iconKeys.push(record.icon_key)
    bySprite.set(sprite, want)
  }
  if (unsourced > 0) {
    consola.info(`assets:game — ${unsourced} uncovered records name no game sprite either`)
  }

  return [
    ...bySprite.values(),
    ...(await fishSilhouetteWants(sprites)),
    ...UI_ICONS.filter((want) => !want.iconKeys.every((key) => covered.has(key))),
  ].sort((a, b) => nameOf(a).localeCompare(nameOf(b)))
}

/** The manifest key stem: the override when a sprite yields several assets. */
const nameOf = (want: GameWant): string => want.name ?? want.sprite

export async function copyGameArt({ dryRun = false } = {}): Promise<number> {
  const root = await gameRoot()
  const manifest = await readManifestOrEmpty()

  // Wiki-sourced art always wins; this step only fills what it left open.
  const covered = new Set(
    manifest.assets.filter((a) => a.origin !== 'game_files').flatMap((a) => a.icon_keys),
  )
  // Indexed before collecting, because a derived name is only a want if the
  // install actually has it — the convention is checked, never assumed.
  const sprites = await indexSprites(root)
  const wants = await collectWants(covered, sprites)
  consola.info(`assets:game — ${wants.length} sprites wanted from the install`)
  if (dryRun) {
    for (const want of wants.slice(0, 20)) consola.log(`would copy ${want.sprite}`)
    return 0
  }

  const missing = wants.filter((w) => w.derived !== true && !sprites.has(w.sprite))
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
    // Cropped before anything measures it, so the manifest's dimensions, hash
    // and byte count all describe what is actually on disk.
    const raw = await readFile(sourcePath)
    const body = want.crop === undefined ? raw : cropPng(raw, want.crop)
    const size = pngSize(body)
    if (size === null) throw new Error(`assets:game — ${want.sprite}.png is not a PNG`)

    const file = `${want.family}/${nameOf(want)}.png`
    const target = join(ASSETS_DIR, file)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, body)

    const gameRelative = relative(root, sourcePath).split(sep).join('/')
    entries.push({
      key: `${want.family}/${nameOf(want)}`,
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

  await removeOrphans(manifest.assets, entries)
  return entries.length
}

/**
 * Delete game-sourced files this run no longer wants.
 *
 * The wiki fetcher has always pruned its own; this step did not, and the day
 * the wiki gained art for something the install had been covering, eighteen
 * files stayed on disk with no manifest entry — which the licensing check
 * correctly calls an error, because an unmanifested sprite is art nothing
 * credits and a takedown would miss.
 *
 * Only ever its own: `origin: 'game_files'` and named by the previous run.
 * Touching a file this step did not create would let a bug here delete the
 * wiki's library.
 */
async function removeOrphans(previous: AssetEntry[], current: AssetEntry[]): Promise<void> {
  const keep = new Set(current.map((entry) => entry.file))
  for (const entry of previous) {
    if (entry.origin !== 'game_files' || keep.has(entry.file)) continue
    await rm(join(ASSETS_DIR, entry.file), { force: true })
    // Either the wiki gained art for it, or nothing wants it any more. Both
    // end the same way: an unmanifested file on disk is art nothing credits.
    consola.warn(`assets:game — removed ${entry.file}, no longer wanted`)
  }
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
