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
import { recolorPng, verifyLutIdentity } from './lut.js'
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
  family: 'item' | 'ui' | 'cosmetic' | 'animal' | 'pet'
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
  /**
   * Repaint the source through a palette strip before writing — the game's
   * own variant mechanism (`lut` + `lut_index` in the animal and pet TOMLs).
   * The strip layout is proven at run time by `verifyLutIdentity`; see
   * `lut.ts` for the whole argument.
   */
  recolor?: { lut: string; index: number }
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

/**
 * The install's Ranching UI icons, one per species — but the suffix varies by
 * how the species is drawn: sexed animals have `_basic_female`/`_basic_male`,
 * unsexed ones repeat the species (`_basic_duck`), and the two whose base
 * sprite carries no suffix at all (`_basic`) are the horse and alpaca. All
 * derived, so a miss is a glyph, never a stopped run.
 */
const animalSprites = (id: string): string[] => [
  `spr_ui_icon_animal_${id}_basic_female`,
  `spr_ui_icon_animal_${id}_basic_male`,
  `spr_ui_icon_animal_${id}_basic_${id}`,
  `spr_ui_icon_animal_${id}_basic`,
]

/**
 * One icon per pet kind, from the stated `ui_icon` of the kind's first variant
 * (sorted by key, so the choice is deterministic). The field is the game's,
 * but which variant fronts the kind is our call — hence `derived`.
 */
async function petWants(covered: Set<string>, sprites: Map<string, string>): Promise<GameWant[]> {
  interface PetRecord {
    id: string
    kind_key: string
    icon_key: string | null
  }
  interface PetsExtract {
    variants: { key: string; pet_kind: string | null; ui_icon: string | null }[]
  }

  let pets: PetRecord[]
  let extract: PetsExtract
  try {
    pets = await readJsonFile<PetRecord[]>(join(DATA_DIR, 'pets.json'))
    extract = await readJsonFile<PetsExtract>(join(SOURCES_DIR, 'game', 'pets.json'))
  } catch {
    return []
  }

  const wants: GameWant[] = []
  for (const pet of pets) {
    if (pet.icon_key === null || covered.has(pet.icon_key)) continue
    const stated = extract.variants
      .filter((v) => v.pet_kind === pet.kind_key && v.ui_icon !== null)
      .sort((a, b) => a.key.localeCompare(b.key))
      .map((v) => v.ui_icon as string)
      .find((sprite) => sprites.has(sprite))
    if (stated === undefined) continue
    wants.push({
      family: 'pet',
      sprite: stated,
      name: pet.kind_key,
      iconKeys: [pet.icon_key],
      derived: true,
    })
  }
  return wants
}

async function animalWants(
  covered: Set<string>,
  sprites: Map<string, string>,
): Promise<GameWant[]> {
  interface AnimalRecord {
    id: string
    icon_key: string | null
  }
  let animals: AnimalRecord[]
  try {
    animals = await readJsonFile<AnimalRecord[]>(join(DATA_DIR, 'animals.json'))
  } catch {
    return []
  }

  const wants: GameWant[] = []
  for (const animal of animals) {
    if (animal.icon_key === null || covered.has(animal.icon_key)) continue
    const sprite = animalSprites(animal.id).find((name) => sprites.has(name))
    if (sprite === undefined) continue
    wants.push({ family: 'animal', sprite, iconKeys: [animal.icon_key], derived: true })
  }
  return wants
}

/**
 * Dedicated per-variant icons, where the install draws them: the same suffix
 * dance as `animalSprites`, with the variant key in the middle — chicken gold
 * is `..._chicken_gold_female`, the fall duck `..._duck_fall_duck`, the
 * mistmare bare `..._horse_mistmare`.
 */
const animalVariantSprites = (id: string, variant: string): string[] => [
  `spr_ui_icon_animal_${id}_${variant}_female`,
  `spr_ui_icon_animal_${id}_${variant}_male`,
  `spr_ui_icon_animal_${id}_${variant}_${id}`,
  `spr_ui_icon_animal_${id}_${variant}`,
]

/**
 * One icon per colour variant, for both families — a dedicated sprite where
 * the install draws one, a palette recolour of the base icon everywhere else.
 *
 * The two paths are the extract's two stated paths: a variant with
 * `lut = "<n/a>"` has its own sprite (chicken gold, the mistmare) and a
 * variant with `lut` + `lut_index` is a repaint. Reading only one of them
 * loses the other's variants — 15 dedicated against 108 repaints on the
 * animals alone.
 */
async function variantWants(
  covered: Set<string>,
  sprites: Map<string, string>,
): Promise<GameWant[]> {
  interface VariantRecord {
    key: string
    icon_key: string | null
  }
  interface AnimalRecord {
    id: string
    variants: VariantRecord[]
  }
  interface PetRecord {
    kind_key: string
    variants: VariantRecord[]
  }
  interface RanchingExtract {
    animals: {
      id: string
      variants: { key: string; lut: string | null; lut_index: number | null }[]
    }[]
  }
  interface PetsExtract {
    variants: {
      key: string
      ui_icon: string | null
      lut: string | null
      lut_index: number | null
    }[]
  }

  const wants: GameWant[] = []

  try {
    const animals = await readJsonFile<AnimalRecord[]>(join(DATA_DIR, 'animals.json'))
    const extract = await readJsonFile<RanchingExtract>(join(SOURCES_DIR, 'game', 'ranching.json'))
    const extractByAnimal = new Map(extract.animals.map((a) => [a.id, a.variants]))

    for (const animal of animals) {
      const stated = new Map((extractByAnimal.get(animal.id) ?? []).map((v) => [v.key, v]))
      for (const variant of animal.variants) {
        if (variant.icon_key === null || covered.has(variant.icon_key)) continue
        const name = `${animal.id}_${variant.key}`

        const dedicated = animalVariantSprites(animal.id, variant.key).find((s) => sprites.has(s))
        if (dedicated !== undefined) {
          wants.push({
            family: 'animal',
            sprite: dedicated,
            name,
            iconKeys: [variant.icon_key],
            derived: true,
          })
          continue
        }

        const source = stated.get(variant.key)
        const base = animalSprites(animal.id).find((s) => sprites.has(s))
        if (
          source?.lut == null ||
          source.lut_index === null ||
          base === undefined ||
          !sprites.has(source.lut)
        ) {
          // Neither path can produce it — the record keeps its icon_key, the
          // coverage report shows the gap, the app draws a glyph.
          continue
        }
        wants.push({
          family: 'animal',
          sprite: base,
          name,
          iconKeys: [variant.icon_key],
          derived: true,
          recolor: { lut: source.lut, index: source.lut_index },
        })
      }
    }
  } catch {
    /* no animals dataset or no ranching extract — nothing to want */
  }

  try {
    const pets = await readJsonFile<PetRecord[]>(join(DATA_DIR, 'pets.json'))
    const extract = await readJsonFile<PetsExtract>(join(SOURCES_DIR, 'game', 'pets.json'))
    const statedByKey = new Map(extract.variants.map((v) => [v.key, v]))

    for (const pet of pets) {
      for (const variant of pet.variants) {
        if (variant.icon_key === null || covered.has(variant.icon_key)) continue
        const stated = statedByKey.get(variant.key)
        if (stated?.ui_icon == null) continue
        const name = `${pet.kind_key}_${variant.key}`

        if (stated.lut === null || stated.lut_index === null) {
          // A distinct dedicated icon, named by the files — a miss is a
          // misread, so no `derived` flag: the run must stop on it.
          wants.push({ family: 'pet', sprite: stated.ui_icon, name, iconKeys: [variant.icon_key] })
          continue
        }
        wants.push({
          family: 'pet',
          sprite: stated.ui_icon,
          name,
          iconKeys: [variant.icon_key],
          recolor: { lut: stated.lut, index: stated.lut_index },
        })
      }
    }
  } catch {
    /* no pets dataset — nothing to want */
  }

  return wants
}

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
    ...(await animalWants(covered, sprites)),
    ...(await petWants(covered, sprites)),
    ...(await variantWants(covered, sprites)),
    ...(await fishSilhouetteWants(sprites)),
    ...UI_ICONS.filter((want) => !want.iconKeys.every((key) => covered.has(key))),
  ].sort((a, b) => nameOf(a).localeCompare(nameOf(b)))
}

/** The manifest key stem: the override when a sprite yields several assets. */
const nameOf = (want: GameWant): string => want.name ?? want.sprite

/**
 * The run-time proof that the palette strips read the way lut.ts says they do.
 *
 * The chicken's `white` variant is the anchor: the files state it recolours
 * through `lut_index` of the chicken strip, and the drawn base icon *is* the
 * white chicken, so that repaint must be a near-identity. If the anchor pair
 * itself is missing — a patch renamed the sprite or dropped the variant — the
 * proof cannot run, and no recolour ships on the strength of an assumption.
 */
async function proveLutLayout(sprites: Map<string, string>): Promise<void> {
  interface RanchingExtract {
    animals: {
      id: string
      variants: { key: string; lut: string | null; lut_index: number | null }[]
    }[]
  }
  const extract = await readJsonFile<RanchingExtract>(
    join(SOURCES_DIR, 'game', 'ranching.json'),
  ).catch(() => null)
  const white = extract?.animals
    .find((a) => a.id === 'chicken')
    ?.variants.find((v) => v.key === 'white')
  const base = animalSprites('chicken').find((s) => sprites.has(s))
  const lutPath = white?.lut == null ? undefined : sprites.get(white.lut)

  if (
    white?.lut == null ||
    white.lut_index === null ||
    base === undefined ||
    lutPath === undefined
  ) {
    throw new Error(
      'assets:game — the white-chicken identity anchor is gone, so the palette-strip layout ' +
        'cannot be proven and no recoloured variant art was written. See lut.ts.',
    )
  }
  const basePath = sprites.get(base)
  if (basePath === undefined) throw new Error('assets:game — chicken base sprite vanished mid-run')
  verifyLutIdentity(
    await readFile(basePath),
    await readFile(lutPath),
    white.lut_index,
    'chicken_white (identity anchor)',
  )
}

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

  // Before any repaint is trusted, prove the strip layout on the pair the
  // game itself states is an identity — see lut.ts for why the white chicken.
  if (wants.some((want) => want.recolor !== undefined)) {
    await proveLutLayout(sprites)
  }

  const entries: AssetEntry[] = []
  for (const want of wants) {
    const sourcePath = sprites.get(want.sprite)
    if (sourcePath === undefined) continue
    // Cropped before anything measures it, so the manifest's dimensions, hash
    // and byte count all describe what is actually on disk.
    const raw = await readFile(sourcePath)
    let body = want.crop === undefined ? raw : cropPng(raw, want.crop)
    if (want.recolor !== undefined) {
      const lutPath = sprites.get(want.recolor.lut)
      if (lutPath === undefined) continue
      body = recolorPng(body, await readFile(lutPath), want.recolor.index, nameOf(want)).png
    }
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
      // install, and the scheme says so anywhere the value surfaces. A
      // recoloured sprite names the palette strip and index it was repainted
      // through, so the manifest states the whole derivation.
      source_url:
        want.recolor === undefined
          ? `game://${gameRelative}`
          : `game://${gameRelative}?lut=${want.recolor.lut}:${want.recolor.index}`,
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
