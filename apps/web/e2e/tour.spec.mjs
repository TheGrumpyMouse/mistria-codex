/**
 * The first-run tour: opens once, walks the nav, closes for good, and comes
 * back only from Settings. Desktop shows all eight steps; a phone filters the
 * sidebar-only Browse anchor out and gets seven.
 */
import { BASE, launch, makeChecker } from './helpers.mjs'

const { check, watch, finish } = makeChecker()
const browser = await launch()

// ── desktop: fresh profile ──
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
watch(page)
await page.goto(`${BASE}#/`, { waitUntil: 'networkidle' })
await page.waitForTimeout(700)

const dialog = page.locator('[role="dialog"][aria-modal="true"]')
check('tour opens on first visit', await dialog.isVisible())
check('first step is the Calendar', (await dialog.innerText()).includes('Calendar'))

let steps = 0
for (; steps < 12; steps++) {
  if (!(await dialog.isVisible().catch(() => false))) break
  await page.getByRole('button', { name: /Next|Done/ }).click()
  await page.waitForTimeout(150)
}
check('desktop tour has 8 steps and closes on Done', steps === 8, `steps=${steps}`)

await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(600)
check('finishing sticks across reloads', !(await dialog.isVisible().catch(() => false)))

// settings replay + Escape
await page.goto(`${BASE}#/settings`, { waitUntil: 'networkidle' })
await page.waitForTimeout(500)
await page.getByRole('button', { name: 'Show the tour again' }).click()
await page.waitForTimeout(300)
check('settings replay reopens the tour', await dialog.isVisible())
await page.keyboard.press('Escape')
await page.waitForTimeout(200)
check('Escape closes and counts as done', !(await dialog.isVisible().catch(() => false)))
await page.close()

// ── phone: sidebar-only steps filtered out ──
const phone = await browser.newPage({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
})
watch(phone)
await phone.goto(`${BASE}#/`, { waitUntil: 'networkidle' })
await phone.waitForTimeout(700)
const mdialog = phone.locator('[role="dialog"][aria-modal="true"]')
check('mobile tour opens', await mdialog.isVisible())
let fits = true
let msteps = 0
for (; msteps < 12; msteps++) {
  if (!(await mdialog.isVisible().catch(() => false))) break
  const box = await mdialog.boundingBox()
  if (box === null || box.x < 0 || box.x + box.width > 390 || box.y < 0) fits = false
  await phone.getByRole('button', { name: /Next|Done/ }).tap()
  await phone.waitForTimeout(150)
}
check('mobile tour has 7 steps (no sidebar Browse)', msteps === 7, `steps=${msteps}`)
check('mobile card stays inside the viewport', fits)

await phone.close()
await browser.close()
finish()
