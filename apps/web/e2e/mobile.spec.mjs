/**
 * Phone-sized checks: the bottom nav and its More menu, the back journeys
 * the thumb actually makes, and the settings close control.
 */
import { BASE, dismissTour, launch, makeChecker } from './helpers.mjs'

const { check, watch, finish } = makeChecker()
const browser = await launch()
const phone = await browser.newPage({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
})
watch(phone)
await dismissTour(phone)

const go = async (hash) => {
  await phone.goto(`${BASE}#${hash}`, { waitUntil: 'networkidle' })
  await phone.waitForTimeout(600)
}

// — chrome —
await go('/')
check(
  'bottom nav has four links and the More button',
  (await phone.locator('nav.fixed.inset-x-0 a').count()) === 4 &&
    (await phone.locator('nav.fixed.inset-x-0 button[aria-expanded]').count()) === 1,
)
check(
  'the map is a nav entry, not a corner button',
  (await phone.locator('a[aria-label="Map"]').count()) === 0 &&
    (await phone.locator('nav.fixed.inset-x-0 a', { hasText: 'Map' }).count()) === 1,
)

// — search -> item -> Back keeps the query —
await go('/search')
await phone.locator('input[type="search"]').fill('heather')
await phone.waitForTimeout(600)
await phone.locator('a[href*="/item/heather"]').first().tap()
await phone.waitForTimeout(800)
await phone.getByRole('button', { name: 'Back' }).tap()
await phone.waitForTimeout(800)
check('back returns to search with the query', phone.url().includes('q=heather'), phone.url())

// — item -> place -> Back -> item —
//
// This used to hop item -> /item/$id/where -> back. That screen was folded into
// the item page, so the hop it tested no longer exists; the place link inside
// "Where to find it" is the same two-screen journey through the same section,
// and it exercises the thing the fold actually produced.
await phone.locator('a[href*="/item/heather"]').first().tap()
await phone.waitForTimeout(800)
const placeLink = phone.locator('main a[href*="/place/"]').first()
check('the item page offers a place to tap', (await placeLink.count()) === 1)
await placeLink.tap()
await phone.waitForTimeout(800)
check('tapping a place leaves the item', /\/place\//.test(phone.url()), phone.url())
await phone.getByRole('button', { name: 'Back' }).tap()
await phone.waitForTimeout(800)
check('back from the place lands on the item', /\/item\/heather$/.test(phone.url()), phone.url())

// — the More menu opens, lists its destinations, and closes on navigation —
await go('/museum')
const more = phone.getByRole('button', { name: 'More' })
await more.tap()
await phone.waitForTimeout(300)
const menu = phone.locator('#more-menu')
check('More opens its menu', await menu.isVisible())
check(
  'the menu holds board, mines, browse and settings',
  (await menu.locator('a', { hasText: 'Board' }).count()) === 1 &&
    (await menu.locator('a', { hasText: 'Mines' }).count()) === 1 &&
    (await menu.locator('a', { hasText: 'Browse' }).count()) === 1 &&
    (await menu.locator('a', { hasText: 'Settings' }).count()) === 1,
)
await menu.locator('a', { hasText: 'Settings' }).tap()
await phone.waitForTimeout(700)
check('settings opens from the menu', phone.url().includes('/settings'))
check('navigating closed the menu', (await phone.locator('#more-menu').count()) === 0)

// — settings shows a corner close —
const close = phone.locator('button[aria-label="Close settings"]')
check('the corner shows a close control', await close.isVisible())
await close.tap()
await phone.waitForTimeout(800)
check('close returns to the museum', phone.url().includes('/museum'), phone.url())

// — deep link straight into settings: close falls back home —
const fresh = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true })
await dismissTour(fresh)
await fresh.goto(`${BASE}#/settings`, { waitUntil: 'networkidle' })
await fresh.waitForTimeout(700)
await fresh.locator('button[aria-label="Close settings"]').tap()
await fresh.waitForTimeout(800)
check('deep-linked close lands home', !fresh.url().includes('/settings'), fresh.url())
await fresh.close()

// — browse door on mobile search —
await go('/search')
const door = phone.locator('a', { hasText: 'Browse all items' })
check('mobile search shows the browse door', await door.isVisible())

await phone.close()
await browser.close()
finish()
