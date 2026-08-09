/**
 * Sprites, where sprites exist.
 *
 * The app draws a hued tile with a letter or a glyph whenever the atlas has no
 * art for a key, and that fallback is deliberate and permanent — which is
 * exactly why it hides regressions. A join that silently stops resolving, an
 * interface that drops `icon_key`, a key built from the wrong prefix: every one
 * of them degrades to something that looks designed. Nothing throws, nothing
 * logs, and the sweep spec passes because the page still renders.
 *
 * So these assertions are specific: on this surface, this element must be a
 * real sprite. `ItemIcon` renders a sprite as a `.sprite` span with a
 * background-image and a glyph as a bordered tile without one, so "did the art
 * arrive" is a DOM question with a straight answer.
 */
import { BASE, dismissTour, launch, makeChecker } from './helpers.mjs'

const { check, watch, finish } = makeChecker()
const browser = await launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
watch(page)
await dismissTour(page)

const go = async (hash) => {
  await page.goto(`${BASE}#${hash}`, { waitUntil: 'networkidle' })
  // The atlas is fetched separately from the data and lands a beat later.
  await page.waitForTimeout(800)
}

/** How many real sprites are inside `selector` — glyph tiles do not count. */
const spritesIn = (selector) =>
  page.locator(`${selector} .sprite`).evaluateAll(
    (nodes) =>
      nodes.filter((n) => {
        const image = getComputedStyle(n).backgroundImage
        return image !== '' && image !== 'none'
      }).length,
  )

/**
 * Is the record's own icon — the first one in the header — a sprite?
 *
 * Not a count: the header also carries the tesserae coin when the record has a
 * price, so "one sprite" is true of an item with no art and a price, and false
 * of a free item that has art. The identity of the first icon is the question.
 */
const headerIsSprite = () =>
  page
    .locator('header [role="img"]')
    .first()
    .evaluate((node) => {
      const sprite = node.querySelector('.sprite')
      if (sprite === null) return false
      const image = getComputedStyle(sprite).backgroundImage
      return image !== '' && image !== 'none'
    })

// ── The 48 that used to draw a glyph ──
// One per root cause, so a regression says which join broke rather than just
// "some icons are missing": a bare cargo filename, a curly apostrophe in a
// wiki row, a wardrobe piece the wiki never had, and the one wrong filename.
for (const [id, why] of [
  ['scrap_metal_legplates', 'bare filename in the cargo cell'],
  ['head_beekeeper_hat', 'curly apostrophe in the wiki row'],
  ['dress_mermaid_wedding_gown', 'no wiki row at all — from the install'],
  ['rabbit_horn', 'cargo names a file the wiki does not host'],
]) {
  await go(`/item/${id}`)
  check(`item/${id} draws its sprite (${why})`, await headerIsSprite())
}

// ── Surfaces that named a thing and drew nothing ──
// Balor's Wagon is one of the eight shops with real art, so this asserts the
// sprite arrived and not merely that some icon did.
await go('/item/acorn')
check('sold-by rows draw the shop sprite', (await spritesIn('section:has-text("Sold by")')) >= 1)

await go('/museum?wing=fish')
check('museum wing chips draw their sprite', (await spritesIn('main')) >= 4)
const setHeadings = await page.locator('section h2 button .sprite').evaluateAll((n) => n.length)
check('museum set headings draw a wing sprite', setHeadings >= 1, `${setHeadings} headings`)

// A story quest has real art; a cooking challenge has none anywhere and must
// still render, as the scroll glyph. Both are the quest page's own header icon,
// which did not exist at all before this pass.
await go('/quest/greet_the_townsfolk')
check('a story quest header draws its sprite', await headerIsSprite())
await go('/quest/omelet_challenge')
check(
  'a quest kind with no art still draws a glyph',
  (await page.locator('header [role="img"]').count()) === 1,
)

await go('/item/apiary')
check(
  'the machine section draws its input and output sprites',
  (await spritesIn('section:has-text("What it does")')) >= 2,
)

await go('/board?view=villagers')
check('villager group headings draw a face', (await spritesIn('section h2')) >= 1)

// ── The fallback-prefix bug ──
// `MineList` and `FoundHereList` both used to hardcode `item/` no matter what
// they were drawing. A monster is the case that exposes it: with the bug the
// key is `item/<id>`, which matches no sprite and no glyph, so the tile falls
// all the way through to two letters. Not conditional — if the mines page ever
// stops listing monsters, that is itself worth failing on rather than skipping.
await go('/mines')
const monsterChips = page.locator('main a[href*="/monster/"]')
const monsterCount = await monsterChips.count()
check('the mines list monsters at all', monsterCount > 0, `${monsterCount} chips`)
check(
  'every monster chip draws its sprite, not initials',
  (await spritesIn('main a[href*="/monster/"]')) === monsterCount,
)

// The biome heading itself: `mine/*` art does not exist, so this is the pickaxe
// glyph — and before this pass it was the letters "TU".
await go('/mines')
check('a biome heading draws an icon', (await page.locator('section h2 [role="img"]').count()) > 0)

// ── The glyph is still the answer where there is no art ──
// Not a nice-to-have: a stall drawing a *wrong* sprite would be worse than a
// stall drawing a store, and this is what tells the two apart.
// Apple Juice is sold by the Inn (which has art) and Darcy's Stall (which has
// none), so one row proves both halves.
await go('/item/apple_juice')
const soldBy = page.locator('section:has-text("Sold by")').first()
// Counted per row, not as two totals. A row now carries a second icon when the
// line has a price, so "as many icons as rows" stopped being the same question
// as "every row has an icon" — and it was the second one that mattered.
const soldByRows = await soldBy
  .locator('li')
  .evaluateAll((rows) => rows.map((row) => row.querySelectorAll('[role="img"]').length))
check('the sold-by list has rows to check', soldByRows.length > 0, `${soldByRows.length} rows`)
check(
  'every sold-by row renders an icon, art or not',
  soldByRows.every((icons) => icons >= 1),
  soldByRows.join(','),
)

// ── The fish shadow, which is a measurement and not a decoration ──
// The four silhouettes are drawn at true relative size in one shared canvas,
// so the sizes are only honest while every one renders in the same box. An
// icon component would fit each to its own box and quietly say a minnow is as
// big as a tuna.
const shadowBox = async (id) => {
  await go(`/item/${id}`)
  const el = page.locator('[role="img"][aria-label*="shadow"]').first()
  if ((await el.count()) === 0) return null
  const box = await el.boundingBox()
  return box === null ? null : { w: Math.round(box.width), h: Math.round(box.height) }
}
const koi = await shadowBox('koi') // medium
const tuna = await shadowBox('tuna') // large
check('a fish page draws its shadow on water', koi !== null, JSON.stringify(koi))
check(
  'every shadow is the same box, so the fish inside are comparable',
  koi !== null && tuna !== null && koi.w === tuna.w && koi.h === tuna.h,
  `${JSON.stringify(koi)} vs ${JSON.stringify(tuna)}`,
)
check('the shadow is not squashed into an icon tile', (koi?.w ?? 0) >= 120, `${koi?.w}px wide`)
await go('/item/koi')
check(
  'the size is still stated in words',
  (await page.locator('main').innerText()).includes('medium shadow in the water'),
)

// The panel holds exactly one fish. It used to hold one fish over a water crop
// that had caught four pale pond-edge lobes, which read as four more.
const shadowPanel = page.locator('[role="img"][aria-label*="shadow"]').first()
check(
  'the panel draws one silhouette, not a row of them',
  (await shadowPanel.locator('span').count()) === 1,
)
check(
  'the water behind it is the flat water colour, not a tile',
  await shadowPanel.evaluate((el) => {
    const style = getComputedStyle(el)
    return style.backgroundImage === 'none' && style.backgroundColor !== 'rgba(0, 0, 0, 0)'
  }),
)

// It swims. The game's own meta.toml says four frames at 0.1s, and a still
// silhouette would be a picture of a fish rather than a fish.
const framePos = () =>
  shadowPanel
    .locator('span')
    .first()
    .evaluate((el) => getComputedStyle(el).backgroundPosition)
const observed = new Set()
for (let i = 0; i < 12; i += 1) {
  observed.add(await framePos())
  await page.waitForTimeout(60)
}
check('the shadow animates through its swim cycle', observed.size === 4, `${observed.size} frames`)

// ── Map: weather filter, and the tag that only appears when it means something ──
await go('/map?region=the_beach')
const beach = await page.locator('main').innerText()
check(
  'the map offers a weather filter',
  beach.includes('Any weather') && beach.includes('Blizzard'),
)
check('a weather-gated row is tagged', /not in wind|rain \/ storm|blizzard/.test(beach))

// All-weather things carry no tag — the owner's call, and the reason the tag
// is worth reading at all. The Clam is available in every weather its seasons
// allow, so its row must say nothing about weather.
const clamRow = (await page.locator('main a[href$="/item/clam"]').first().innerText()).replace(
  /\s+/g,
  ' ',
)
check('an all-weather row carries no weather tag', !/not in| \/ /.test(clamRow), clamRow)

// Winter cannot rain, so offering Rain beside Winter would be a dead end.
await go('/map?region=the_beach&season=winter')
const winter = await page.locator('main').innerText()
check(
  'the season narrows which weathers are offered',
  !winter.includes('Rain'),
  'no Rain in winter',
)
check('winter weathers are still offered', winter.includes('Blizzard') && winter.includes('Snow'))

// The filter is in the URL and actually narrows.
//
// Counting rendered rows would prove nothing — each group previews eight and
// hides the rest behind "Show N more", so the visible count is the same 36
// whatever the filter does. The group headings carry the real totals.
const totals = async () =>
  (await page.locator('main section p').allInnerTexts())
    .flatMap((t) => [...t.matchAll(/·\s*(\d+)/g)].map((m) => Number(m[1])))
    .reduce((sum, n) => sum + n, 0)

await go('/map?region=the_beach')
const allFound = await totals()
await go('/map?region=the_beach&weather=blizzard')
const inBlizzard = await totals()
check(
  'filtering by weather narrows the list',
  inBlizzard > 0 && inBlizzard < allFound,
  `${inBlizzard} of ${allFound}`,
)

await page.close()
await browser.close()
finish()
