/**
 * The exploratory sweep: open everything, and fail on anything that looks
 * broken rather than on a named expectation.
 *
 * The other specs assert that particular features work. This one walks the
 * whole app — every static route, and a real record from every category the
 * shipped index knows about — and watches for the failures that have no
 * feature to attach to: a console error, a 404, a raw `snake_case` token
 * reaching the screen, an `undefined` or `[object Object]` in the text, a
 * screen that renders nothing at all. Those are the bugs that survive a
 * feature-by-feature suite, because no test was ever written for the screen
 * they happen to be on.
 *
 * Ids are drawn from the shipped data rather than hardcoded, so the sweep
 * automatically covers whatever the dataset grew since it was written.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { BASE, dismissTour, launch, makeChecker } from './helpers.mjs'

const { check, finish, problems } = makeChecker()

// —— the shipped index, for real ids ——
const dist = fileURLToPath(new URL('../dist/data/', import.meta.url))
const meta = JSON.parse(readFileSync(`${dist}meta.json`, 'utf8'))
const index = JSON.parse(readFileSync(`${dist}v/${meta.dataVersion}/index.json`, 'utf8'))

const byCategory = new Map()
for (const [id, entry] of Object.entries(index)) {
  // A veiled record deliberately renders as a chip, not as content.
  if (entry.s === 1 || entry.u === 1) continue
  byCategory.set(entry.c, [...(byCategory.get(entry.c) ?? []), id])
}
/** A few ids per category — first, middle and last, so it is not all "a". */
const sample = (ids, n = 3) => {
  const sorted = [...ids].sort()
  const picks = new Set([sorted[0], sorted[Math.floor(sorted.length / 2)], sorted.at(-1)])
  return [...picks].filter(Boolean).slice(0, n)
}

const ROUTE_FOR = {
  character: 'villager',
  monster: 'monster',
  location: 'place',
  quest: 'quest',
}

/** Text that means something rendered wrong, whatever screen it is on. */
const POISON = [
  'undefined',
  'NaN',
  '[object Object]',
  'Infinity',
  'null',
  'Couldn’t load',
  "Couldn't load",
]

/**
 * A raw internal token that reached the screen.
 *
 * Two words joined by an underscore is never English. Excluded: anything
 * inside a URL, which the text extraction does not include anyway.
 */
const RAW_TOKEN = /\b[a-z]+_[a-z_]+\b/

const browser = await launch()

async function sweep(label, viewport) {
  const page = await browser.newPage(viewport)
  await dismissTour(page)

  const seen = { console: [], http: [] }
  page.on('pageerror', (e) => seen.console.push(`${label} PAGEERROR ${e.message}`))
  page.on('console', (m) => {
    if (m.type() === 'error')
      seen.console.push(`${label} CONSOLE ${m.location()?.url ?? ''} ${m.text()}`)
  })
  page.on('response', (r) => {
    if (r.status() >= 400 && r.url().startsWith(BASE))
      seen.http.push(`${label} HTTP ${r.status()} ${r.url()}`)
  })

  const visit = async (hash) => {
    await page.goto(`${BASE}#${hash}`, { waitUntil: 'networkidle' })
    // Data screens paint in two passes; give the second one room.
    await page.waitForTimeout(650)
    return (await page.locator('main').innerText()).replace(/\s+/g, ' ').trim()
  }

  // —— every static screen ——
  const STATIC = [
    ['/', 'Calendar'],
    // The nav says "Board"; the screen calls itself what it is.
    ['/board', 'Request board'],
    ['/search', 'Search'],
    ['/museum', 'Museum'],
    ['/mines', 'Mines'],
    ['/browse', 'Browse'],
    ['/map', 'Map'],
    ['/settings', 'Settings'],
    ['/about', 'About'],
  ]
  for (const [hash, heading] of STATIC) {
    const text = await visit(hash)
    check(`${label} ${hash} renders`, text.length > 60, `${text.length} chars`)
    check(`${label} ${hash} has its heading`, text.includes(heading))
    const poison = POISON.find((p) => text.includes(p))
    check(`${label} ${hash} clean of broken values`, poison === undefined, poison ?? '')
  }

  // —— every browse category, and a sample of records from each ——
  for (const [category, ids] of [...byCategory].sort()) {
    const route = ROUTE_FOR[category] ?? 'item'
    const listText = await visit(`/browse?c=${category}`)
    check(`${label} browse/${category} lists rows`, listText.includes('Browse'))

    for (const id of sample(ids)) {
      const text = await visit(`/${route}/${id}`)
      check(`${label} ${route}/${id} renders`, text.length > 40, `${text.length} chars`)
      check(`${label} ${route}/${id} is not a 404 page`, !text.includes('Not found'))
      const poison = POISON.find((p) => text.includes(p))
      check(`${label} ${route}/${id} clean of broken values`, poison === undefined, poison ?? '')
      const raw = RAW_TOKEN.exec(text)
      check(`${label} ${route}/${id} shows no raw token`, raw === null, raw?.[0] ?? '')
    }
  }

  // —— the where-screen, for something with real availability ——
  const whereText = await visit('/item/heather/where')
  check(`${label} where screen renders`, whereText.includes('Where to get'))

  // —— an unknown id must land somewhere sane, not blow up ——
  const missing = await visit('/item/definitely_not_an_item')
  check(`${label} unknown id says so`, missing.includes('Not found'))

  await page.close()
  return seen
}

const desktop = await sweep('desktop', { viewport: { width: 1280, height: 900 } })
const mobile = await sweep('mobile', {
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
})

for (const seen of [desktop, mobile]) {
  problems.push(...seen.console, ...seen.http)
}
check('no console or page errors anywhere', desktop.console.length + mobile.console.length === 0)
check('no failed requests anywhere', desktop.http.length + mobile.http.length === 0)

await browser.close()
finish()
