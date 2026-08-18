/**
 * The building pages' load-bearing facts, each with the negative that proves
 * the test: the mill must show its quest and NO tesserae (nothing states one),
 * an unread cost must be a sentence rather than an empty table, and a
 * material's item page must offer the construction tick.
 */
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

// ── The greenhouse: the user's example, quest-gated, no materials ──
const greenhouse = await go('/building/greenhouse')
check('the greenhouse states its price', /50000t/.test(greenhouse))
check('and its carpenter-upgrade gate', /finish/.test(greenhouse))

// ── The mill: a quest is the cost, and no tesserae figure exists ──
const mill = await go('/building/mill')
check('the mill names its restoration quest', /Mill Restoration Project/.test(mill))
check('and lists what the quest asks for', (mill.match(/×\d+/g) ?? []).length >= 2, mill)
check('and prints no tesserae figure — none is stated', !/\d+t\b/.test(mill), mill)

// ── An item page offers the construction tick, keyed per stage ──
const wood = await go('/item/basic_wood')
check('Wood’s page lists the coop under Needed for', /Coop — Stage/.test(wood))
// The negative that proves it is a join, not a constant: the greenhouse
// states no materials, so nothing should claim it needs any.
check('and nothing claims the greenhouse needs materials', !/Greenhouse — Stage/.test(wood))

// ── A blueprint links back to what it builds ──
const blueprint = await go('/item/small_coop_black_blueprint')
check('a blueprint names its building', /blueprint for the Coop/i.test(blueprint))

await page.close()
await browser.close()
finish()
