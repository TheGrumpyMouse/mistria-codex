/**
 * Build the bundle the PWA actually fetches, from `data/`.
 *
 * Two constraints from GitHub Pages shape this whole file:
 *
 * 1. **Pages sends fixed response headers.** There is no way to set
 *    `Cache-Control: immutable` on data files and `no-cache` on a manifest. So
 *    the version lives in the URL path (`v/<dataVersion>/`) — a new build is a
 *    new URL and can never be served stale — and the service worker owns cache
 *    policy instead of HTTP.
 * 2. **Pages serves from `/<repo>/`** unless a custom domain is attached. The
 *    base path therefore ships inside `meta.json` rather than being hardcoded,
 *    because a hardcoded `/data/...` works in dev and breaks in production.
 *
 * `dataVersion` is content-addressed, so a rebuild with no data change produces
 * the same version: no service-worker update, no spurious re-download.
 */
import { createHash } from 'node:crypto'
import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { argv, env } from 'node:process'
import { pathToFileURL } from 'node:url'
import {
  DATASETS,
  DAYS_PER_SEASON,
  type DatasetName,
  type Item,
  type Location,
  type Meta,
  type Quest,
  SCHEMA_VERSION,
  type Skill,
} from '@mistria/schema'
import { consola } from 'consola'
import { writeAppIcons } from '../assets/app-icon.js'
import { writeAttribution } from '../assets/attribution.js'
import { atlasVersion, packAssets } from '../assets/pack.js'
import { ASSETS_MANIFEST, DATA_DIR, SHIP_DIR } from '../lib/paths.js'
import { writeJson } from '../lib/write-json.js'
import { buildAvailabilityBundle } from './availability.js'
import { loadGameFacts, loadWeatherClasses, weatherOdds } from './game-facts.js'
import { buildRequestBoard } from './request-board.js'

const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex')

/**
 * Files the app cannot render without. Kept deliberately small: Workbox's
 * `precacheAndRoute` fails the *entire* service-worker install if a single entry
 * 404s, so everything else is warmed opportunistically instead.
 */
const PRECACHE: readonly string[] = ['index.json', 'availability.json', 'locations.json']

/**
 * Categories too big to list flat, which therefore ship a sub-group token.
 * Browse renders one group at a time for these; every other category is a
 * few hundred rows at most and reads fine whole.
 */
const GROUPED_CATEGORIES = new Set(['furniture', 'cosmetic'])

interface ShippedFile {
  name: string
  text: string
  records: number | null
}

export async function buildShip(): Promise<Meta> {
  const files: ShippedFile[] = []

  for (const name of Object.keys(DATASETS) as DatasetName[]) {
    const spec = DATASETS[name]
    let records: unknown[]
    try {
      records = JSON.parse(await readFile(join(DATA_DIR, spec.file), 'utf8')) as unknown[]
    } catch {
      records = []
    }

    // Furniture ships in its own shard. `items.json` is parsed on the main
    // thread by the one screen that needs a full record, and the 925 furniture
    // records would take it well past the 500KB parse budget — while a page
    // for an apple never needs a bookshelf. The display index still covers
    // everything, and `loadItemRecord` in the app picks the shard by the
    // index's category.
    if (name === 'items') {
      const items = records as { category?: string }[]
      const furniture = items.filter((r) => r.category === 'furniture')
      const rest = items.filter((r) => r.category !== 'furniture')
      files.push({ name: 'items.json', text: JSON.stringify(rest), records: rest.length })
      files.push({
        name: 'items_furniture.json',
        text: JSON.stringify(furniture),
        records: furniture.length,
      })
      continue
    }

    // Flatten `facets/fish.json` to `fish.json` — the shipped tree is flat so
    // the service worker's precache list stays simple.
    files.push({
      name: `${name}.json`,
      text: JSON.stringify(records),
      records: records.length,
    })
  }

  // A shipped form, like `availability.json` will be: the request board with
  // every name already resolved, so the screen does not download a megabyte of
  // items to print 193 of them. It joins the fingerprint like any other file, so
  // a change to it is a new dataVersion.
  const board = await buildBoardFile()
  if (board !== null) files.push(board)

  // The flat, integer-keyed form the Today query scans. See build/availability.ts.
  const availability = await buildAvailabilityFile()
  if (availability !== null) files.push(availability)

  // Just enough of every entity to paint a result row. Without it a screen that
  // shows twenty fish has to download a megabyte of items to learn their names.
  const index = await buildIndexFile()
  if (index !== null) files.push(index)

  // Content-addressed version over (filename, content hash) pairs, sorted so the
  // result cannot depend on iteration order.
  const fingerprint = files
    .map((f) => `${f.name}:${sha256(f.text)}`)
    .sort()
    .join('\n')
  const dataVersion = sha256(fingerprint).slice(0, 10)

  const versionDir = join(SHIP_DIR, 'v', dataVersion)
  await rm(SHIP_DIR, { recursive: true, force: true })

  const manifest: Meta['files'] = {}
  for (const file of files) {
    const bytes = await writeJson(join(versionDir, file.name), JSON.parse(file.text), {
      pretty: false,
    })
    manifest[file.name] = { bytes, sha256: sha256(file.text), records: file.records }
  }

  // Empty until the first id rename, but emitted from the first build so the
  // client's migration path is exercised rather than bolted on later. Once users
  // exist, a rename without this orphans their saved museum progress.
  await writeJson(
    join(versionDir, 'id_migrations.json'),
    { schemaVersion: SCHEMA_VERSION, migrations: [] },
    { pretty: false },
  )

  const basePath = `${(env.MISTRIA_BASE_PATH ?? '/mistria-codex/').replace(/\/$/, '')}/data/v/${dataVersion}/`

  // Game art is optional. A clone that has never run `pnpm assets:fetch` has no
  // `assets/game/`, and the app is built to render entirely from drawn glyphs in
  // that case — so a missing atlas is a state to record, not a build failure.
  const assets = await packIfPresent()

  // Optional, like the atlases: a clone whose `sources/` predates G1 ships with
  // no odds and no game version, and the app words the reverse-lookup card
  // without a frequency rather than inventing one.
  const game = await loadGameFacts().catch(() => null)
  const classes = await loadWeatherClasses().catch(() => ({}))

  const meta: Meta = {
    dataVersion,
    schemaVersion: SCHEMA_VERSION,
    builtAt: env.SOURCE_DATE_EPOCH
      ? new Date(Number(env.SOURCE_DATE_EPOCH) * 1000).toISOString()
      : new Date().toISOString(),
    // From the committed extract, not from the environment. The env var is only
    // set on a machine that owns the game, so reading it here reported `null`
    // on CI and on every clone — which is to say, on every build that ships.
    gameVersion: game?.version ?? env.MISTRIA_GAME_VERSION ?? null,
    commit: env.GITHUB_SHA ?? null,
    basePath,
    files: manifest,
    precache: [...PRECACHE],
    assets,
    weatherOdds: game === null ? {} : weatherOdds(game.weather, classes, DAYS_PER_SEASON),
    counts: Object.fromEntries(files.map((f) => [f.name.replace(/\.json$/, ''), f.records ?? 0])),
    coverage: {},
    sources: [
      {
        id: 'wiki_cargo',
        name: 'Fields of Mistria Wiki (wiki.gg)',
        license: 'CC BY-SA 4.0',
        url: 'https://fieldsofmistria.wiki.gg',
        fetchedAt: null,
        note: 'Facts only. No wiki prose is redistributed.',
      },
      {
        id: 'game_files',
        name: 'Fields of Mistria game data files',
        license: null,
        url: null,
        fetchedAt: null,
        note:
          game === null
            ? 'Not ingested in this build — see docs/game-file-extraction.md.'
            : `Ids, spawn rules and museum sets read from v${game.version}. No text, no art.`,
      },
      {
        id: 'manual',
        name: 'Hand-curated',
        license: 'MIT',
        url: null,
        fetchedAt: null,
        note: 'curated/ — locations, museum sets, schedules, maps.',
      },
    ],
  }

  // meta.json sits at a stable URL — it is the only file the service worker
  // revalidates, and how it discovers a new dataVersion.
  await writeJson(join(SHIP_DIR, 'meta.json'), meta, { pretty: false })

  return meta
}

/**
 * The display index: id -> name, icon and category, for everything.
 *
 * Named in `PRECACHE` because no screen can render a result without it, and it
 * is the reason none of them need `items.json`. Around 80KB against a megabyte.
 *
 * `a` — other names the thing goes by — is written only where a record has any,
 * which today is one character. An empty array on 1,251 entries would cost more
 * than the feature.
 */
async function buildIndexFile(): Promise<ShippedFile | null> {
  const read = async <T>(file: string): Promise<T[]> => {
    try {
      return JSON.parse(await readFile(join(DATA_DIR, file), 'utf8')) as T[]
    } catch {
      return []
    }
  }

  type IndexEntry = {
    n: string
    i: string | null
    c: string
    v: number | null
    /** Furniture and wardrobe only: the token Browse sub-groups the category by. */
    g?: string
    a?: string[]
    /** 1 when the record is a story spoiler — list rows veil the name. */
    s?: 1
    /** 1 when the wiki describes it and the game does not ship it yet. */
    u?: 1
    /**
     * Spoiler aliases: names that are themselves the reveal ("Seridia").
     * Searchable exactly like `a`, but a match is shown only because the user
     * typed it — the passive alias hint never prints these.
     */
    sa?: string[]
  }
  const entries: Record<string, IndexEntry> = {}
  const alsoKnownAs = (names: string[] | undefined): { a?: string[] } =>
    names !== undefined && names.length > 0 ? { a: names } : {}
  const spoilerMarks = (record: {
    spoiler?: true
    unreleased?: true
    spoiler_aliases?: string[]
  }): { s?: 1; u?: 1; sa?: string[] } => ({
    ...(record.spoiler === true ? { s: 1 as const } : {}),
    ...(record.unreleased === true ? { u: 1 as const } : {}),
    ...(record.spoiler_aliases !== undefined && record.spoiler_aliases.length > 0
      ? { sa: record.spoiler_aliases }
      : {}),
  })

  // Items carry their own category — fish, bug, cooked — which is what Browse
  // groups by. Everything else takes the name of its table.
  for (const item of await read<{
    id: string
    name: string
    icon_key: string | null
    category: string
    subcategory: string | null
    sell_value: number | null
    also_known_as?: string[]
    spoiler?: true
    unreleased?: true
    spoiler_aliases?: string[]
  }>('items.json')) {
    entries[item.id] ??= {
      n: item.name,
      i: item.icon_key,
      c: item.category,
      v: item.sell_value,
      // The sub-group token, for the two categories big enough to need a
      // second level: 925 furniture and 360 wardrobe rows. Nothing else pays
      // for the field.
      ...(GROUPED_CATEGORIES.has(item.category) && item.subcategory !== null
        ? { g: item.subcategory }
        : {}),
      ...alsoKnownAs(item.also_known_as),
      ...spoilerMarks(item),
    }
  }

  for (const [file, category] of [
    ['characters.json', 'character'],
    ['monsters.json', 'monster'],
    ['locations.json', 'location'],
    // Quests are searchable — "what was that quest called" is a real query —
    // and their route renders giver, rewards and, for the seals, the price.
    ['quests.json', 'quest'],
  ] as const) {
    for (const record of await read<{
      id: string
      name: string
      icon_key: string | null
      also_known_as?: string[]
      /** Locations only, and hand-curated: "The Farm" is also "Farm". */
      aliases?: string[]
      spoiler?: true
      unreleased?: true
      spoiler_aliases?: string[]
    }>(file)) {
      entries[record.id] ??= {
        n: record.name,
        i: record.icon_key,
        c: category,
        v: null,
        // A location's curated `aliases` are the same idea as `also_known_as`
        // under an older name, and search should not care which field a name
        // arrived in. Its own display name is dropped — it is already `n`, and
        // matching it twice would only make the row look like an alias hit.
        ...alsoKnownAs(
          [...(record.also_known_as ?? []), ...(record.aliases ?? [])].filter(
            (name) => name !== record.name,
          ),
        ),
        ...spoilerMarks(record),
      }
    }
  }

  const count = Object.keys(entries).length
  if (count === 0) return null
  return { name: 'index.json', text: JSON.stringify(entries), records: count }
}

/** The flattened availability index, or null before the data exists. */
async function buildAvailabilityFile(): Promise<ShippedFile | null> {
  const read = async <T>(file: string): Promise<T[]> => {
    try {
      return JSON.parse(await readFile(join(DATA_DIR, file), 'utf8')) as T[]
    } catch {
      return []
    }
  }

  const items = await read<Item>('items.json')
  if (items.length === 0) return null

  const locations = await read<Location>('locations.json')

  const skills = await read<{ perks: { id: string; name: string }[] }>('skills.json')
  const quests = await read<{ id: string; name: string }>('quests.json')
  const bundle = buildAvailabilityBundle(
    items,
    locations.map((l) => l.id),
    {
      perks: new Map(skills.flatMap((s) => s.perks.map((p) => [p.id, p.name] as const))),
      quests: new Map(quests.map((q) => [q.id, q.name] as const)),
    },
  )

  return {
    name: 'availability.json',
    text: JSON.stringify(bundle),
    records: bundle.rules.length,
  }
}

/**
 * The flattened request board, or null when the datasets it joins are absent.
 *
 * Null rather than an empty file: a board with no requests in it is a claim
 * that nobody asks for anything, and the screen should say "not built yet"
 * instead of "nothing to collect".
 */
async function buildBoardFile(): Promise<ShippedFile | null> {
  const read = async <T>(file: string): Promise<T[]> => {
    try {
      return JSON.parse(await readFile(join(DATA_DIR, file), 'utf8')) as T[]
    } catch {
      return []
    }
  }

  const quests = await read<Quest>('quests.json')
  const items = await read<Item>('items.json')
  if (quests.length === 0 || items.length === 0) return null

  const board = buildRequestBoard(
    quests,
    items,
    await read<{ id: string; name: string }>('characters.json'),
    await read<Location>('locations.json'),
    await read<Skill>('skills.json'),
  )

  return {
    name: 'request_board.json',
    text: JSON.stringify(board),
    records: board.requests.length,
  }
}

/** Pack the atlases and regenerate the credit file, if there is art to pack. */
async function packIfPresent(): Promise<Meta['assets']> {
  const { access } = await import('node:fs/promises')
  try {
    await access(ASSETS_MANIFEST)
  } catch {
    return null
  }

  const packed = await packAssets()
  // Regenerated here rather than by `assets:fetch`, so the credit file is part
  // of the same determinism check as everything else and cannot drift from what
  // the repository actually holds.
  await writeAttribution()

  // The installable icon — the framed house mark — lands in the same
  // gitignored output as the atlases, so a takedown removes it with everything
  // else and the app falls back to the committed favicon.svg.
  await writeAppIcons()

  return {
    version: atlasVersion(packed),
    sheets: packed.sheets.map((s) => s.file),
    portraits: Object.keys(packed.portraits).length,
    bytes: packed.bytes,
  }
}

async function main(): Promise<void> {
  const meta = await buildShip()
  const total = Object.values(meta.files).reduce((sum, f) => sum + f.bytes, 0)
  consola.success(
    `Shipped ${Object.keys(meta.files).length} files at v${meta.dataVersion} ` +
      `(${(total / 1024).toFixed(1)} KB) -> ${meta.basePath}`,
  )
  if (meta.assets !== null) {
    consola.info(
      `Atlases: ${meta.assets.sheets.length} sheets (${(meta.assets.bytes / 1024).toFixed(0)} KB) ` +
        `+ ${meta.assets.portraits} portraits, v${meta.assets.version}`,
    )
  }
}

const entry = argv[1]
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  main().catch((err: unknown) => {
    consola.error(err)
    process.exitCode = 1
  })
}
