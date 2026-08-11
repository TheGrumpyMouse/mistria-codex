/**
 * `pnpm extract` — the game's own files into `sources/game/`.
 *
 * Tier one, exactly like `sources/wiki/`: generated, committed, never
 * hand-edited. Committed so that CI stays hermetic and nobody else needs to own
 * the game to build this project — which is the same reason the wiki snapshots
 * are committed, and the reason this script is never run in CI.
 *
 * Read docs/game-file-extraction.md before running it. The two rules that
 * matter: nothing here writes into the game folder, and no localisation string
 * ever comes out of it.
 */
import { join } from 'node:path'
import process, { argv } from 'node:process'
import { pathToFileURL } from 'node:url'
import { consola } from 'consola'
import { REPO_ROOT, SOURCES_DIR } from '../lib/paths.js'
import { writeJson } from '../lib/write-json.js'
import { extractArtifacts, type GameArtifactsExtract } from './artifacts.js'
import { extractCosmetics, type GameCosmeticsExtract } from './cosmetics.js'
import { extractFestivals, type GameFestivalsExtract } from './festivals.js'
import { extractItems, type GameItemsExtract } from './items.js'
import { extractMachines, type GameMachinesExtract } from './machines.js'
import { extractMonsters, type GameMonstersExtract } from './monsters.js'
import { extractQuests, type GameQuestsExtract } from './quests.js'
import { extractSchedules, type GameSchedulesExtract } from './schedules.js'
import { extractSpawns, type GameSpawnsExtract } from './spawns.js'
import { extractStores, type GameStoresExtract } from './stores.js'
import { gameRoot, gameVersion } from './toml.js'
import { extractUnlocks, type GameUnlocksExtract } from './unlocks.js'
import { extractWorld, type GameWorldExtract } from './world.js'

export const GAME_DIR = join(SOURCES_DIR, 'game')

export interface GameExtract {
  items: GameItemsExtract
  spawns: GameSpawnsExtract
  world: GameWorldExtract
  artifacts: GameArtifactsExtract
  machines: GameMachinesExtract
  quests: GameQuestsExtract
  stores: GameStoresExtract
  cosmetics: GameCosmeticsExtract
  unlocks: GameUnlocksExtract
  monsters: GameMonstersExtract
  festivals: GameFestivalsExtract
  schedules: GameSchedulesExtract
}

export async function extractGame(): Promise<GameExtract> {
  const root = await gameRoot()
  const version = gameVersion()

  const [items, spawns, world, artifacts, machines, quests, stores, cosmetics] = await Promise.all([
    extractItems(root, version),
    extractSpawns(root, version),
    extractWorld(root, version),
    extractArtifacts(root, version),
    extractMachines(root, version),
    extractQuests(root, version),
    extractStores(root, version),
    extractCosmetics(root, version),
  ])
  const [unlocks, monsters, festivals, schedules] = await Promise.all([
    extractUnlocks(root, version),
    extractMonsters(root, version),
    extractFestivals(root, version),
    extractSchedules(root, version),
  ])

  return {
    items,
    spawns,
    world,
    artifacts,
    machines,
    quests,
    stores,
    cosmetics,
    unlocks,
    monsters,
    festivals,
    schedules,
  }
}

export async function writeGameExtract(extract: GameExtract): Promise<void> {
  await Promise.all([
    writeJson(join(GAME_DIR, 'items.json'), extract.items),
    writeJson(join(GAME_DIR, 'spawns.json'), extract.spawns),
    writeJson(join(GAME_DIR, 'world.json'), extract.world),
    writeJson(join(GAME_DIR, 'artifacts.json'), extract.artifacts),
    writeJson(join(GAME_DIR, 'machines.json'), extract.machines),
    writeJson(join(GAME_DIR, 'quests.json'), extract.quests),
    writeJson(join(GAME_DIR, 'stores.json'), extract.stores),
    writeJson(join(GAME_DIR, 'cosmetics.json'), extract.cosmetics),
    writeJson(join(GAME_DIR, 'unlocks.json'), extract.unlocks),
    writeJson(join(GAME_DIR, 'monsters.json'), extract.monsters),
    writeJson(join(GAME_DIR, 'festivals.json'), extract.festivals),
    writeJson(join(GAME_DIR, 'schedules.json'), extract.schedules),
  ])
}

async function main(): Promise<void> {
  const extract = await extractGame()

  const named = extract.items.items.filter((i) => i.name !== null).length
  const timed = extract.spawns.bugs.filter((b) => b.hours !== null).length
  const sets = extract.world.museum.reduce((n, w) => n + w.sets.length, 0)
  const donatable = extract.world.museum.reduce(
    (n, w) => n + w.sets.reduce((m, s) => m + s.items.length, 0),
    0,
  )
  const birthdays = extract.world.npcs.filter((n) => n.birthday !== null).length

  if (!argv.includes('--dry-run')) await writeGameExtract(extract)

  consola.success(
    `${extract.items.items.length} items (${named} named) from ` +
      `${extract.items.files.length} files at v${extract.items.gameVersion}`,
  )
  consola.info(
    `fish ${extract.spawns.fish.length} · bugs ${extract.spawns.bugs.length} ` +
      `(${timed} with an hour window) · forageables ${extract.spawns.forageables.length} · ` +
      `crops ${extract.spawns.crops.length}`,
  )
  consola.info(
    `museum ${sets} sets / ${donatable} items · npcs ${extract.world.npcs.length} ` +
      `(${birthdays} with a birthday) · rooms ${extract.world.locations.length}`,
  )
  consola.info(
    `artifact pools ${Object.keys(extract.artifacts.poolByRoom).length} rooms · ` +
      `loot ${Object.keys(extract.artifacts.lootRarity).length} · ` +
      `perks ${extract.artifacts.perks.length} · seals ${extract.artifacts.seals.length} ` +
      `(${extract.artifacts.sealOfferings.length} offerings)`,
  )
  consola.info(
    `machines ${extract.machines.factories.length} — ` +
      extract.machines.factories.map((f) => `${f.id} (${f.requests.length} requests)`).join(' · '),
  )
  consola.info(
    `quests: ${extract.quests.storyQuests.length} story · ` +
      `${extract.quests.requestGates.length} gated requests`,
  )
  const stockLines = extract.stores.stores.reduce(
    (n, s) => n + s.categories.reduce((m, c) => m + c.entries.length, 0),
    0,
  )
  consola.info(`stores: ${extract.stores.stores.length} sections · ${stockLines} stock entries`)
  const priced = extract.cosmetics.cosmetics.filter((c) => c.price_override !== null).length
  consola.info(
    `cosmetics: ${extract.cosmetics.cosmetics.length} (${priced} priced in the files, ` +
      'the rest from the wiki)',
  )
  const statted = extract.monsters.variants.filter((v) => v.hp !== null).length
  consola.info(
    `monsters: ${extract.monsters.variants.length} variants from ` +
      `${extract.monsters.files.length} families (${statted} with stated hp)`,
  )
  const implemented = extract.festivals.festivals.filter((f) => f.implemented === true).length
  consola.info(
    `festivals: ${extract.festivals.festivals.length} (${implemented} implemented) · ` +
      `letter quest chain: ${extract.unlocks.letterQuests.length} starts`,
  )
  const plain = extract.schedules.files.filter((f) => f.unread_requirement_keys.length === 0)
  consola.info(
    `schedules: ${extract.schedules.files.length} files ` +
      `(${plain.length} with fully-stated conditions) across ` +
      `${new Set(extract.schedules.files.flatMap((f) => f.npcs.map((n) => n.npc))).size} npcs`,
  )
  const { letters, quests, festivals, museumRewards, wishingWell, chickenStatue } = extract.unlocks
  const grants = [
    ...letters,
    ...quests,
    ...festivals,
    ...museumRewards,
    ...wishingWell,
    ...chickenStatue,
  ]
  const taught = grants.filter((g) => g.recipe !== null).length
  consola.info(
    `unlocks: ${grants.length} grants (${taught} teach a recipe) — ` +
      `letters ${letters.length} · quests ${quests.length} · festivals ${festivals.length} · ` +
      `museum ${museumRewards.length} · well ${wishingWell.length} · statue ${chickenStatue.length}`,
  )
  // Empty is the expected state. Anything here is a way the game hands you
  // something that no reader collects — the exact hole `crafting_scroll` sat in.
  if (extract.unlocks.unreadGrantKeys.length > 0) {
    consola.warn(
      `unlocks: ${extract.unlocks.unreadGrantKeys.length} unrecognised grant key(s) — ` +
        `${extract.unlocks.unreadGrantKeys.join(', ')}. Each is a grant nobody is reading.`,
    )
  }
  if (argv.includes('--dry-run')) consola.warn('--dry-run: nothing written')
}

const entry = argv[1]
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  // `.env` at the repo root holds MISTRIA_GAME_DIR. It is gitignored and
  // different on every machine. Absent is fine — the variables may be exported
  // in the shell instead, and gameRoot() says what to set if they are not.
  // The path is explicit because pnpm runs this with the package as cwd.
  try {
    process.loadEnvFile(join(REPO_ROOT, '.env'))
  } catch {
    /* no .env */
  }

  main().catch((err: unknown) => {
    consola.error(err instanceof Error ? err.message : err)
    process.exitCode = 1
  })
}
