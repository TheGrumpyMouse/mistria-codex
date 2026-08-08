/**
 * The desktop sweep: every screen renders, the flagship journeys hold, and
 * this round's data (furniture, market stalls, machines, fish shadows) is
 * actually reachable. Assertions live on visible text, not implementation.
 */
import { BASE, dismissTour, launch, makeChecker } from './helpers.mjs'

const { check, watch, finish } = makeChecker()
const browser = await launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
watch(page)
await dismissTour(page)

const go = async (hash) => {
  await page.goto(`${BASE}#${hash}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(500)
}
const text = async () => (await page.locator('body').innerText()).replace(/\s+/g, ' ')

// — Calendar —
await go('/')
let t = await text()
check('calendar renders with findables', /\d+ things findable now/.test(t))
check(
  'no unknown badges on the calendar',
  !t.includes('time unknown') && !t.includes('place unknown'),
)

// museum-today section: nothing donated on a fresh profile, so it must show
check('calendar: For the museum section', /For the museum · \d+ still needed/.test(t))
await page.locator('details', { hasText: 'For the museum' }).first().click()
await page.waitForTimeout(200)
t = await text()
check('museum section nests kinds', t.includes('still needed, findable now'))

// place-aware filter: a location word narrows and force-opens groups
const dayFilter = page.locator('input[aria-label="Filter what is findable"]')
await dayFilter.fill('beach fish')
await page.waitForTimeout(300)
t = await text()
check('filter by place + kind narrows', t.includes('The Beach') && t.includes('Fish'))
await dayFilter.fill('')
await page.waitForTimeout(200)

// — Search & Browse —
await go('/search')
await page.locator('input[type="search"]').fill('basic wood chest')
await page.waitForTimeout(400)
t = await text()
check('search finds furniture', t.includes('Basic Wood Chest'))

await go('/browse?c=furniture')
t = await text()
check(
  'browse has a Furniture category with set chips',
  t.includes('Furniture') && t.includes('Basic Chest'),
)
check('the first set renders rows', (await page.locator('a[href*="/item/"]').count()) >= 1)
await page.getByRole('button', { name: /Artifact Replica/ }).click()
await page.waitForTimeout(400)
check(
  'switching sets swaps the rows',
  (await page.locator('a[href*="/item/"]').count()) > 50 && page.url().includes('s='),
)

// — Furniture item page —
await go('/item/basic_wood_chest')
t = await text()
check('chest page: variants line', t.includes('15') && t.includes('colours'))
check('chest page: woodcrafting recipe', t.includes('How it’s made') && t.includes('Basic Wood'))

// — Market stall furniture: something Merri actually stocks —
await go('/item/haunted_attic_bed')
t = await text()
check(
  'stall furniture: sold by Merri’s Stall on Saturdays',
  /Merri.s Stall/.test(t) && t.includes('Saturdays'),
)

// — Wardrobe: browse group, priced record, stall that used to be empty —
await go('/browse?c=cosmetic')
t = await text()
check('browse has a Wardrobe category', t.includes('Wardrobe'))
check('wardrobe rows render', (await page.locator('a[href*="/item/"]').count()) >= 1)

await go('/item/dress_maid')
t = await text()
check(
  'wardrobe item: slot and price in the subtitle',
  /worn on the top/.test(t) && t.includes('500t'),
)
check('wardrobe item: colour count', t.includes('Comes in') && t.includes('6'))
check(
  'wardrobe item: sold by Louis on Saturdays',
  /Louis.* Stall/.test(t) && t.includes('Saturdays'),
)
check('wardrobe item: no "No source recorded"', !t.includes('No source recorded'))

// Vera's stall was empty before the wardrobe landed; her hair is the proof.
await go('/item/hair_afro_puffs')
t = await text()
check('Vera stocks her hairstyles', /Vera.s Stall/.test(t), t.slice(0, 120))

// — Apiary chain —
await go('/item/honey')
t = await text()
check('honey: apiary window, not a bug', t.includes('From an apiary') && !t.includes('Bug net'))
check('honey: any time, no unknown badge', t.includes('any time') && !t.includes('time unknown'))
await go('/item/apiary')
t = await text()
check('apiary page: what it does', t.includes('What it does') && t.includes('What comes out'))
check(
  'apiary page: crafting recipe shipped',
  t.includes('How it’s made') && t.includes('Iron Ingot'),
)

// — Fish shadow —
await go('/item/rainbow_trout')
t = await text()
check('fish page: shadow line', /Shows a \w+ shadow in the water/.test(t))

// — Market stall stock reaches sold_by —
await go('/item/espresso')
t = await text()
check('espresso sold at Darcy’s stall', /Darcy.s Stall/.test(t))

// — Museum: fold, remember, totals —
await go('/museum')
t = await text()
check('museum renders totals', /\d+ of \d+ donated/.test(t))
const firstSet = page.locator('section h2 button').first()
const setLabel = (await firstSet.innerText()).trim().split('\n')[0]
await firstSet.click()
await page.waitForTimeout(200)
check('set collapses', (await firstSet.getAttribute('aria-expanded')) === 'false', setLabel)
await go('/')
await go('/museum')
check(
  'collapse survives leaving and returning',
  (await page.locator('section h2 button').first().getAttribute('aria-expanded')) === 'false',
)
await page.getByRole('button', { name: 'Expand all' }).click()
await page.waitForTimeout(200)
check(
  'expand all reopens',
  (await page.locator('section h2 button').first().getAttribute('aria-expanded')) === 'true',
)

// — Map: focus a region, filter its yield by season and name —
await go('/map?region=the_beach')
t = await text()
check('map region shows its yield', t.includes('What you can get here'))
const before = await page.locator('section li').count()
await page.getByRole('button', { name: 'Winter' }).click()
await page.waitForTimeout(300)
check('map: winter chip narrows the list', page.url().includes('season=winter'))
await page.locator('input[aria-label="Filter what this place yields"]').fill('crab')
await page.waitForTimeout(300)
t = await text()
check(
  'map: name filter narrows further',
  (await page.locator('section li').count()) <= before,
  `before=${before}`,
)

// — Quest gates from the game —
await go('/quest/apiaries_and_terrariums')
t = await text()
check('the apiary story quest exists', t.includes('Apiaries and Terrariums'))

// — About copy matches the badge removal —
await go('/about')
t = await text()
check(
  'about: no unknown-badge doctrine',
  t.includes('place inferred') && !t.includes('time unknown'),
)

await page.close()
await browser.close()
finish()
