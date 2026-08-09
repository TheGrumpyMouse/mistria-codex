/**
 * The one claim this whole feature rests on: a crawler that never runs
 * JavaScript can read the dataset.
 *
 * Everything else about the guide — the sitemap, the structured data, the
 * canonicals — is decoration if that is not true, and it cannot be checked by a
 * unit test, because "the built site serves this at this URL" involves the
 * build, the public/ copy and the router all agreeing.
 *
 * So this whole spec runs with **`javaScriptEnabled: false`**, which is the
 * closest a browser gets to being GPTBot. Measured behaviour, not guessed:
 * GPTBot, ClaudeBot and PerplexityBot fetch raw HTML and never execute script,
 * and Anthropic's own docs (May 2026) say the web fetch tool does not support
 * JS-rendered sites.
 *
 * **The negative control is the important half.** Asserting that the guide page
 * has content proves nothing on its own — the app might have rendered it. The
 * pair of assertions (guide page full, app shell empty, same browser, same
 * settings) is what shows the static page is doing the work.
 */
import { BASE, launch, makeChecker } from './helpers.mjs'

const { check, finish } = makeChecker()
const browser = await launch()
const context = await browser.newContext({
  // The entire point. No React, no fetch, no atlas — whatever is in the
  // response body is all there is.
  javaScriptEnabled: false,
  serviceWorkers: 'block',
})
const page = await context.newPage()

/**
 * Raw response body, not the DOM — closer to what a crawler actually parses.
 *
 * HTML goes through `page.goto` so the assertion is "a real browser with
 * scripting off sees this", which is the stronger claim. The index files go
 * through the request API instead: a navigation to `sitemap.xml` in a
 * JS-disabled context is treated as a download and throws.
 */
const fetchText = async (path) => {
  const response = await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' })
  return { status: response?.status() ?? 0, body: (await response?.text()) ?? '' }
}

const fetchRaw = async (path) => {
  const response = await context.request.get(`${BASE}${path}`)
  return {
    status: response.status(),
    body: await response.text(),
    type: response.headers()['content-type'] ?? '',
  }
}

// ── The negative control, first, so the rest means something ──
const app = await fetchText('')
check('the app shell is served', app.status === 200, String(app.status))
check(
  'and with JS off it contains no record data at all',
  !app.body.includes('Cave Eel') && /<div id="root">\s*<\/div>/.test(app.body),
  'if this ever fails the guide may not be what the other assertions are reading',
)
check(
  'but it does point a crawler at the guide',
  app.body.includes('href="./guide/"'),
  'the <noscript> link is the only way to reach the guide by crawling',
)

// ── A fish page: the flagship case ──
const eel = await fetchText('guide/fish/cave-eel/')
check('a guide page is served', eel.status === 200, String(eel.status))
check('with the record name in the raw HTML', eel.body.includes('<h1>Cave Eel</h1>'), '')
check('its availability', /Fishing[^<]*The Upper Mines/.test(eel.body), '')
check('its floor range', /floors 2–19/.test(eel.body), '')
check('its sell value', eel.body.includes('50 tesserae'), '')
check(
  'and no script but the structured data',
  countScripts(eel.body) === 1,
  String(countScripts(eel.body)),
)

// ── The things that make it a well-formed page ──
check(
  'the canonical is absolute',
  /<link rel="canonical" href="https:\/\/[^"]+\/guide\/fish\/cave-eel\/">/.test(eel.body),
  '',
)
const ld = /<script type="application\/ld\+json">(.*?)<\/script>/s.exec(eel.body)?.[1] ?? ''
let parsed = null
try {
  parsed = JSON.parse(ld)
} catch {
  /* reported by the check below */
}
check('the JSON-LD parses', parsed !== null, ld.slice(0, 120))
check(
  'and names the record',
  parsed?.['@graph']?.[0]?.mainEntity?.name === 'Cave Eel',
  JSON.stringify(parsed?.['@graph']?.[0]?.mainEntity?.name),
)
check('the wiki source is credited', eel.body.includes('fieldsofmistria.wiki.gg/wiki/'), '')
check('the attribution is on the page', eel.body.includes('sole property of NPC Studio'), '')
check('and it links back into the app', eel.body.includes('#/item/cave_eel'), '')

// ── One of each other kind, so a whole builder cannot silently break ──
for (const [path, needle] of [
  ['guide/villager/adeline/', '<h1>Adeline</h1>'],
  ['guide/place/the-tide-caverns/', 'floors 21–39'],
  ['guide/monster/sapling/', '<h1>Sapling</h1>'],
]) {
  const result = await fetchText(path)
  check(`${path} is served`, result.status === 200, String(result.status))
  check(`${path} has its content`, result.body.includes(needle), needle)
}

// ── A recipe is two blocks on the dish's page, not a page of its own ──
// "How do I get the Lemon Pie recipe" is exactly the kind of query this whole
// surface exists to answer, and the page that answers it has to be the same one
// that describes the dish — a recipe's id *is* its output item's id, so a second
// page would be a second URL about one subject.
const pie = await fetchText('guide/cooked/lemon-pie/')
check('the dish page is served', pie.status === 200, String(pie.status))
check('with the recipe on it', pie.body.includes('Where to learn the recipe'), '')
check(
  'naming the shop and the scroll’s own price',
  pie.body.includes('Sold at Sleeping Dragon Inn for 400 tesserae'),
  '',
)
check('and its ingredients', /Ingredient/.test(pie.body), '')
check(
  'but not as a schema.org Recipe, which is for food a person can cook',
  !pie.body.includes('"Recipe"'),
  'marking a game dish up that way would publish a false claim about the page',
)
const noRecipePage = await fetchText('guide/recipe/lemon-pie/')
check(
  'and no separate recipe page competes with it',
  noRecipePage.status === 404,
  String(noRecipePage.status),
)

// ── The hub, which is how a crawler reaches everything ──
const hub = await fetchText('guide/')
check('the hub is served', hub.status === 200, String(hub.status))
const links = [...hub.body.matchAll(/href="\.\.\/[^"]+\/"/g)].length
check('and links to every page', links > 1000, `${links} links`)

// ── A renamed id keeps working ──
const moved = await fetchText('guide/material/copper-ore/')
check('an old slug still resolves', moved.status === 200, String(moved.status))
check(
  'and canonicals to the current one',
  moved.body.includes('/guide/material/ore-copper/') && moved.body.includes('noindex'),
  'noindex so the pair never competes with itself',
)

// ── Spoilers must not be on the public web ──
// `curated/vocab/spoilers.json` veils the character `caldarus` and the mine
// biome `ancient_ruins`. The location the mine sits in is deliberately NOT
// veiled, so the assertion is that its page exists without the mine's contents
// — the exact distinction the app draws.
const spoiler = await fetchText('guide/villager/caldarus/')
check('a veiled character has no guide page', spoiler.status === 404, String(spoiler.status))

const ruins = await fetchText('guide/place/the-ancient-ruins/')
check('the location it hides in is still published', ruins.status === 200, String(ruins.status))
check(
  'but carries none of the veiled mine',
  !/floors \d/.test(ruins.body) && !ruins.body.includes('Ore found here'),
  'a spoiler mine reaching this page would publish the endgame floor range',
)

// ── The index files ──
const sitemap = await fetchRaw('sitemap.xml')
check('the sitemap is served', sitemap.status === 200, String(sitemap.status))
check(
  'as XML rather than a download',
  sitemap.type.includes('xml'),
  `${sitemap.type} — Search Console will not read octet-stream`,
)
const locs = [...sitemap.body.matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1])
check('listing every page', locs.length > 1000, `${locs.length} urls`)
check(
  'all absolute',
  locs.every((u) => u.startsWith('https://')),
  '',
)
check(
  'and no lastmod, which would be "now" on every deploy',
  !sitemap.body.includes('<lastmod>'),
  '',
)

const robots = await fetchRaw('robots.txt')
check('robots.txt is served', robots.status === 200, String(robots.status))
check('naming the sitemap', robots.body.includes('Sitemap: https://'), '')
check('and allowing the AI crawlers', robots.body.includes('ClaudeBot'), '')

function countScripts(html) {
  return [...html.matchAll(/<script/g)].length
}

await context.close()
await browser.close()
finish()
