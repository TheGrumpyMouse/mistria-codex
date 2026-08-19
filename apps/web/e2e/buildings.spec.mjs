/**
 * The building pages' load-bearing facts, each with the negative that proves
 * the test: the mill must show its quest and NO tesserae (nothing states one),
 * an unread cost must be a sentence rather than an empty table, and a
 * material's item page must offer the construction tick.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { BASE, dismissTour, launch, makeChecker } from './helpers.mjs'

const { check, watch, finish } = makeChecker()
const browser = await launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } })
watch(page)
await dismissTour(page)

const go = async (hash) => {
  await page.goto(`${BASE}#${hash}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(800)
  return (await page.locator('main').innerText()).replace(/\s+/g, ' ')
}

// ── The index ──
const index = await go('/buildings')
check('the buildings index lists the greenhouse', index.includes('Greenhouse'))
check('and points at the carpenter for blueprints', /at the Carpenter/.test(index))

// ── A full costed building: tiers, materials, gates, blueprints ──
const coop = await go('/building/coop')
check('the coop shows three stages', coop.includes('Stage 3'))
check('with material counts', /Wood\s*×75/.test(coop), coop.slice(0, 400))
check('a later stage states its Ranching gate', /Ranching/.test(coop))
check('and each stage names its blueprints', /Blueprint/.test(coop))
check('the coop states its capacity', /Houses up to 4 animals/.test(coop))

// ── The greenhouse: quest-gated, with its own page's material table ──
// The Carpenter's table states no materials for it; the Greenhouse page does,
// which is where these numbers were read from.
const greenhouse = await go('/building/greenhouse')
check('the greenhouse states its price', /50000t/.test(greenhouse))
check('and its materials', /Glass\s*×20/.test(greenhouse), greenhouse.slice(0, 400))
check('the large tier scales them', /Glass\s*×40/.test(greenhouse))
check('and its carpenter-upgrade gate', /finish/.test(greenhouse))

// ── The mill: a quest is the cost, and no tesserae figure exists ──
const mill = await go('/building/mill')
check('the mill names its restoration quest', /Mill Restoration Project/.test(mill))
check('and lists what the quest asks for', (mill.match(/×\d+/g) ?? []).length >= 2, mill)
check('and prints no tesserae figure — none is stated', !/\d+t\b/.test(mill), mill)

// ── An item page offers the construction tick, keyed per stage ──
// The pair proves it is a join, not a constant: the greenhouse takes HARD
// wood, so it must appear on Hard Wood's page and not on plain Wood's.
const wood = await go('/item/basic_wood')
check('Wood’s page lists the coop under Needed for', /Coop — Stage/.test(wood))
check('but not the greenhouse — it takes Hard Wood', !/Greenhouse — Stage/.test(wood))
const hardWood = await go('/item/hard_wood')
check('Hard Wood’s page lists the greenhouse', /Greenhouse — Stage/.test(hardWood))

// ── Every blueprint links back to what it builds ──
// Drawn from the shipped data rather than one fixture, so a building that
// gains a blueprint is covered without anyone editing this file. The
// precondition is asserted too: an empty list would pass a broken loop.
const dist = fileURLToPath(new URL('../dist/data/', import.meta.url))
const meta = JSON.parse(readFileSync(`${dist}meta.json`, 'utf8'))
const shipped = JSON.parse(
  readFileSync(`${dist}v/${meta.dataVersion}/buildings.json`, 'utf8'),
)
const blueprintIds = shipped.flatMap((b) => b.tiers.flatMap((t) => t.blueprint_item_ids))
check('the dataset states blueprints to test', blueprintIds.length >= 18, `${blueprintIds.length}`)
for (const blueprintId of blueprintIds) {
  const text = await go(`/item/${blueprintId}`)
  check(`item/${blueprintId} names what it builds`, /blueprint for the /i.test(text))
}

await page.close()
await browser.close()
finish()
