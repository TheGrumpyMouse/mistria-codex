/**
 * The post-redeploy self-heal: a session holding a stale meta.json 404s on a
 * versioned file, re-reads the manifest past the service worker, and retries
 * at the version the server actually has. See `lib/data.ts`.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { BASE, dismissTour, launch, makeChecker } from './helpers.mjs'

const { check, watch, finish, problems } = makeChecker()
const metaPath = fileURLToPath(new URL('../dist/data/meta.json', import.meta.url))
const realMeta = JSON.parse(readFileSync(metaPath, 'utf8'))

const browser = await launch()
// Block the service worker so page.route sees every fetch — the heal under
// test is app logic, and the SW would answer from its own scope.
const context = await browser.newContext({
  viewport: { width: 1280, height: 900 },
  serviceWorkers: 'block',
})
const page = await context.newPage()
watch(page)
await dismissTour(page)

// The deliberate 404s on the stale version dir are expected noise.
const expected = (line) => line.includes('/data/v/deadbeef00/')
page.on('console', () => {})

await page.route('**/data/meta.json*', async (route) => {
  if (route.request().url().includes('fresh=')) {
    await route.continue()
    return
  }
  await route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ ...realMeta, dataVersion: 'deadbeef00' }),
  })
})

await page.goto(`${BASE}#/villager/adeline`, { waitUntil: 'networkidle' })
await page.waitForTimeout(1200)
const t = (await page.locator('body').innerText()).replace(/\s+/g, ' ')
check('stale version heals: villager page renders', t.includes('Adeline'))
check('gift preferences loaded after the heal', t.includes('Loves'))
check('no stuck loading state', !t.includes('Loading'))

await page.goto(`${BASE}#/museum`, { waitUntil: 'networkidle' })
await page.waitForTimeout(800)
const m = (await page.locator('body').innerText()).replace(/\s+/g, ' ')
check('later screens use the adopted version', /\d+ of \d+ donated/.test(m))

// Filter the expected 404 noise out of the problem list before reporting.
for (let i = problems.length - 1; i >= 0; i--) {
  if (expected(problems[i])) problems.splice(i, 1)
}

await browser.close()
finish()
