/**
 * Real journeys: several screens, one intention, state carried between them.
 *
 * The sweep proves screens render and the feature specs prove features work.
 * This proves the app holds together *across* screens — a tick made on the
 * museum showing on the item page, a filter surviving the back button, a
 * setting outliving a reload. Every bug this catches is one that only exists
 * in the seam between two screens, which is exactly where a per-screen suite
 * cannot look.
 */
import { BASE, dismissTour, launch, makeChecker } from './helpers.mjs'

const { check, watch, finish } = makeChecker()
const browser = await launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
watch(page)
await dismissTour(page)

const go = async (hash) => {
  await page.goto(`${BASE}#${hash}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(600)
}
const body = async () => (await page.locator('body').innerText()).replace(/\s+/g, ' ')

// ── 1. A donation ticked in the museum is a donation on the item's page ──
await go('/museum?wing=fish')
const firstRow = page.locator('section li').first()
const itemName = (await firstRow.innerText()).split('\n')[0].trim()
const itemHref = await firstRow.locator('a[href*="/item/"]').first().getAttribute('href')
const itemId = itemHref.split('/item/')[1]
await firstRow.locator('input[type="checkbox"]').check()
await page.waitForTimeout(300)
check('museum: ticking marks it donated', await firstRow.locator('input').isChecked(), itemName)

await go(`/item/${itemId}`)
let t = await body()
check('item page reflects the museum tick', t.includes('Donated'), itemId)
const banner = page.locator('label input[type="checkbox"]').first()
check('item page checkbox is checked', await banner.isChecked())

// untick from the item page, and the museum must agree
await banner.uncheck()
await page.waitForTimeout(300)
await go('/museum?wing=fish')
check(
  'unticking on the item page clears it in the museum',
  !(await page.locator('section li').first().locator('input[type="checkbox"]').isChecked()),
)

// ── 2. Progress survives a reload, because it is on the device ──
await page.locator('section li').first().locator('input[type="checkbox"]').check()
await page.waitForTimeout(300)
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(800)
check(
  'a tick survives a reload',
  await page.locator('section li').first().locator('input[type="checkbox"]').isChecked(),
)

// ── 3. Settings counts what has been recorded ──
await go('/settings')
t = await body()
check('settings reports recorded progress', /\d+ thing/.test(t), t.slice(0, 200))

// ── 4. Text size is applied, and outlives a reload ──
await page.getByRole('button', { name: 'Large' }).click()
await page.waitForTimeout(200)
const large = await page.evaluate(() => document.documentElement.dataset.text)
check('text size applies immediately', large === 'large', String(large))
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(600)
check(
  'text size survives a reload',
  (await page.evaluate(() => document.documentElement.dataset.text)) === 'large',
)
await page.getByRole('button', { name: 'Small' }).click()
await page.waitForTimeout(200)

// ── 5. A spoiler stays hidden until asked for, then stays revealed ──
await go('/browse?c=character')
t = await body()
check('a spoiler villager is veiled in browse', t.includes('Hidden'))
await go('/villager/caldarus')
t = await body()
check('the spoiler page asks first', t.includes('Story spoiler ahead') || t.includes('spoiler'))
const reveal = page.getByRole('button', { name: /Show|Reveal/ }).first()
if (await reveal.isVisible().catch(() => false)) {
  await reveal.click()
  await page.waitForTimeout(400)
  check('revealing shows the name', (await body()).includes('Caldarus'))
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(700)
  check('the reveal is remembered', (await body()).includes('Caldarus'))
}

// ── 6. Board: filter, open a request, come back to the same filter ──
await go('/board')
await page.locator('input[type="search"]').fill('heather')
await page.waitForTimeout(400)
check('board filter is in the URL', page.url().includes('q=heather'))
// A board row links to the thing wanted and the villager who wants it —
// there is no quest link here by design.
const wanted = page.locator('main a[href*="/item/"]').first()
check('board rows link to the wanted item', await wanted.isVisible())
await wanted.click()
await page.waitForTimeout(700)
check('a board row opens the item', page.url().includes('/item/'))
await page.goBack()
await page.waitForTimeout(700)
check('back restores the board filter', page.url().includes('q=heather'), page.url())

// and the other view of the same question still answers
await go('/board?view=villagers&q=heather')
check('the villager view lists who wants it', (await body()).includes('Adeline'))

// ── 7. The calendar answers a different day differently ──
await go('/?season=spring&day=3&year=1&weather=clear&time=600')
const spring = await body()
const springCount = /(\d+) things findable now/.exec(spring)?.[1]
await go('/?season=winter&day=3&year=1&weather=clear&time=600')
const winter = await body()
const winterCount = /(\d+) things findable now/.exec(winter)?.[1]
check(
  'changing season changes what is findable',
  springCount !== undefined && winterCount !== undefined && springCount !== winterCount,
  `spring ${springCount}, winter ${winterCount}`,
)

// ── 8. Search reaches every kind of record, not just items ──
await go('/search')
for (const [query, expect] of [
  ['adeline', 'Adeline'],
  ['the beach', 'Beach'],
  ['maid dress', 'Maid Dress'],
  ['basic wood chest', 'Basic Wood Chest'],
]) {
  await page.locator('input[type="search"]').fill(query)
  await page.waitForTimeout(400)
  check(`search finds “${query}”`, (await body()).includes(expect))
}

// ── 9. An item's "needed for" tick is its own domain, not the museum's ──
await go('/item/heather')
const needBoxes = page.locator('section input[type="checkbox"]')
if ((await needBoxes.count()) > 0) {
  await needBoxes.first().check()
  await page.waitForTimeout(300)
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(800)
  check(
    'a needed-for tick persists',
    await page.locator('section input[type="checkbox"]').first().isChecked(),
  )
}

await page.close()
await browser.close()
finish()
