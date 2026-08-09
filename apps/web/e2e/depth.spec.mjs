/**
 * Two things the app derives rather than prints, on screens where being wrong
 * is silent.
 *
 * **Floor ranges.** A mine's name does not say how deep it is, and five places
 * in this app are floors rather than fields. The join is `mines.json` →
 * `locations.json`, so the failure mode is not an error — it is the name on its
 * own, which looks exactly like a place that has no depth. Every assertion here
 * therefore pairs a mine with a non-mine.
 *
 * **The update controls.** Settings can now ask the server whether this is the
 * newest build. Run with the service worker blocked, so the manifest half of
 * the check is what answers and the result is deterministic.
 */
import { BASE, dismissTour, launch, makeChecker } from './helpers.mjs'

const { check, watch, finish } = makeChecker()
const browser = await launch()
const context = await browser.newContext({
  viewport: { width: 1280, height: 1000 },
  // The check under test is app logic. A live worker would answer the manifest
  // request from its own stale-while-revalidate copy.
  serviceWorkers: 'block',
})
const page = await context.newPage()
watch(page)
await dismissTour(page)

const go = async (hash) => {
  await page.goto(`${BASE}#${hash}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(800)
  return (await page.locator('main').innerText()).replace(/\s+/g, ' ')
}

// ── The mine's own page ──
const caverns = await go('/place/the_tide_caverns')
check('a mine biome page renders', caverns.includes('The Tide Caverns'), caverns)
check('and its subtitle states the floors', /floors 21–39/.test(caverns), caverns)
// The heading stays the name: it is what every other screen links to, and it
// is what a screen reader announces as the destination.
check(
  'the range is not in the heading',
  !(await page.locator('h1').innerText()).includes('floors'),
  await page.locator('h1').innerText(),
)

// The negative case, and the one that proves the join rather than the string.
const narrows = await go('/place/the_narrows')
check('a surface place renders', narrows.includes('The Narrows'), narrows)
check('and says nothing about floors', !narrows.includes('floors'), narrows)

// The parent is deliberately unranged — deriving 1–99 from its five children
// would be an inference, and a wrong one, since 20/40/60/80/100 are not in it.
const mines = await go('/place/the_mines')
check('the parent mine page renders', mines.includes('The Mines'), mines)
check('and claims no floor range of its own', !/floors \d/.test(mines), mines)

// ── A monster's home ──
const sapling = await go('/monster/blue_sapling')
check('a monster page names its biome', sapling.includes('The Tide Caverns'), sapling)
check('and now says how deep that is', /floors 21–39/.test(sapling), sapling)

// ── Search ──
await page.goto(`${BASE}#/search?q=tide+caverns`, { waitUntil: 'networkidle' })
await page.waitForTimeout(600)
const results = (await page.locator('main').innerText()).replace(/\s+/g, ' ')
check('the place turns up in search', results.includes('The Tide Caverns'), results)
check('carrying its depth', /floors 21–39/.test(results), results)

// ── The calendar, which is where most place names are actually read ──
await page.goto(`${BASE}#/`, { waitUntil: 'networkidle' })
await page.waitForTimeout(900)
// A query force-opens the groups it matches, so this does not depend on which
// section happens to be expanded.
await page.locator('input[type="search"], input[type="text"]').first().fill('cave eel')
await page.waitForTimeout(600)
const calendar = (await page.locator('main').innerText()).replace(/\s+/g, ' ')
check('a cave fish is findable from the calendar', calendar.includes('Cave Eel'), calendar)
check('and its row names the floors', /floors 1–19/.test(calendar), calendar)

// ── Settings: the update controls ──
const settings = await go('/settings')
check('settings has an Updates section', settings.includes('Updates'), settings)
check('naming the app version', /App \d+\.\d+/.test(settings), settings)
check('and the data version', /Data [0-9a-f]{6,}/.test(settings), settings)

const checkButton = page.getByRole('button', { name: 'Check for updates' })
check('the check control is there', (await checkButton.count()) === 1)
await checkButton.click()
await page.waitForTimeout(1500)
const afterCheck = (await page.locator('main').innerText()).replace(/\s+/g, ' ')
// Served from `dist` at the version it was built with, so the honest answer is
// "current". The point is that it answers at all rather than staying blank.
check(
  'and it reports a result rather than nothing',
  /This is the newest version\.|A new version is ready\./.test(afterCheck),
  afterCheck,
)

// The reset is destructive, so it must take two taps. Assert the arming, never
// the second tap — that one wipes the cache the rest of the suite is using.
const reset = page.getByRole('button', { name: /Re-download the offline files/ })
check('the reset control is there', (await reset.count()) === 1)
await reset.click()
await page.waitForTimeout(300)
check(
  'and it arms rather than firing on the first tap',
  (await page.getByRole('button', { name: /Tap again to re-download/ }).count()) === 1,
)

await context.close()
await browser.close()
finish()
