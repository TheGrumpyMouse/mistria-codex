/**
 * Phone-sized checks: the bottom nav, the corner controls, the back journeys
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
check('bottom nav has five entries', (await phone.locator('nav.fixed.inset-x-0 a').count()) === 5)
check('corner buttons present', (await phone.locator('a[aria-label="Map"]').count()) === 1)

// — search -> item -> Back keeps the query —
await go('/search')
await phone.locator('input[type="search"]').fill('heather')
await phone.waitForTimeout(600)
await phone.locator('a[href*="/item/heather"]').first().tap()
await phone.waitForTimeout(800)
await phone.getByRole('button', { name: 'Back' }).tap()
await phone.waitForTimeout(800)
check('back returns to search with the query', phone.url().includes('q=heather'), phone.url())

// — item -> where -> Back -> item —
await phone.locator('a[href*="/item/heather"]').first().tap()
await phone.waitForTimeout(800)
await phone.getByRole('link', { name: /Where can I get this/ }).tap()
await phone.waitForTimeout(800)
await phone.getByRole('button', { name: 'Back' }).tap()
await phone.waitForTimeout(800)
check('back from the where page lands on the item', /\/item\/heather(?!\/where)/.test(phone.url()))

// — settings corner becomes a close —
await go('/museum')
await phone.locator('a[aria-label="Settings"]').tap()
await phone.waitForTimeout(700)
check('settings opens', phone.url().includes('/settings'))
const close = phone.locator('button[aria-label="Close settings"]')
check('corner icon is now a close', await close.isVisible())
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
