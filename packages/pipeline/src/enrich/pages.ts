/**
 * Run every wiki-page enricher.
 *
 * Cargo covers the big tables; everything else lives on ordinary pages that
 * have to be parsed one at a time. Running them together means one command
 * refreshes the whole page tier, and the weekly refresh PR carries a single
 * coherent snapshot rather than a mix of dates.
 *
 * Never run in CI. `sources/` is committed so builds are hermetic and the wiki
 * is left alone.
 */
import { argv } from 'node:process'
import { pathToFileURL } from 'node:url'
import { consola } from 'consola'
import { enrichCalendar } from './calendar.js'
import { enrichCharacters } from './characters.js'
import { enrichCosmetics } from './cosmetics.js'
import { enrichItemNames } from './item-names.js'
import { enrichMapShapes } from './map-shapes.js'
import { enrichMaps } from './maps.js'
import { enrichMonsters } from './monsters.js'
import { enrichMuseum } from './museum.js'
import { enrichPlaces } from './places.js'
import { enrichQuests } from './quests.js'
import { enrichSchedules } from './schedules.js'
import { enrichShops } from './shops.js'
import { enrichSkills } from './skills.js'
import { enrichWaters } from './waters.js'

async function main(): Promise<void> {
  const useCache = !argv.includes('--no-cache')

  const museum = await enrichMuseum({ useCache })
  const skills = await enrichSkills({ useCache })
  const calendar = await enrichCalendar({ useCache })
  const shops = await enrichShops({ useCache })
  const quests = await enrichQuests({ useCache })
  const waters = await enrichWaters({ useCache })
  const places = await enrichPlaces({ useCache })
  const schedules = await enrichSchedules({ useCache })
  const monsters = await enrichMonsters({ useCache })
  const itemNames = await enrichItemNames({ useCache })
  const characters = await enrichCharacters({ useCache })
  const maps = await enrichMaps({ useCache })
  const cosmetics = await enrichCosmetics({ useCache })
  const shapes = await enrichMapShapes()

  consola.success(
    `pages: ${museum.sets.length} museum sets · ${skills.perks.length} perks · ` +
      `${calendar.festivals.length} festivals · ` +
      `${shops.reduce((n, s) => n + s.stock.length, 0)} stock rows · ` +
      `${quests.quests.length} quests · ${waters.waters.length} water bodies · ` +
      `${places.places.length} places · ${schedules.schedules.length}/${schedules.checked.length} schedules · ` +
      `${monsters.monsters.length} monsters · ${itemNames.names.length} internal names · ` +
      `${characters.characters.filter((c) => c.portrait !== null).length} villager portraits · ` +
      `${maps.markers.length} map markers · ` +
      `${cosmetics.cosmetics.filter((c) => c.price !== null).length} cosmetic prices · ` +
      `${shapes.regions.length} region shapes`,
  )
}

const entry = argv[1]
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  main().catch((err: unknown) => {
    consola.error(err instanceof Error ? err.message : err)
    process.exitCode = 1
  })
}
