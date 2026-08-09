/**
 * The item page's two answers: where a thing comes from, and what a shop wants
 * for it.
 *
 * Both were folded together from data the page already had and was not
 * rendering, and both fail *quietly* when they break — a weather line that
 * stops appearing looks like a fish with no weather, and a missing upgrade gate
 * looks like an item you can buy today. Nothing throws, so the assertions here
 * are specific: named fixtures, and the negative case beside the positive one.
 */
import { BASE, dismissTour, launch, makeChecker } from './helpers.mjs'

const { check, watch, finish } = makeChecker()
const browser = await launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } })
watch(page)
await dismissTour(page)

const go = async (id) => {
  await page.goto(`${BASE}#/item/${id}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(800)
  return (await page.locator('main').innerText()).replace(/\s+/g, ' ')
}
/** Just the "Where to find it" section, so a match cannot come from elsewhere. */
const whereText = async (id) => {
  await go(id)
  const section = page.locator('section').filter({ hasText: 'Where to find it' }).first()
  return (await section.innerText()).replace(/\s+/g, ' ')
}
const soldByText = async (id) => {
  await go(id)
  const section = page.locator('section').filter({ hasText: 'Sold by' }).first()
  return (await section.innerText()).replace(/\s+/g, ' ')
}

// ── One section, not two ──
// "Where to find it" and a "Where can I get this? →" link one line below it
// asked the same question. The link is gone and its screen folded in.
const halibut = await go('halibut')
check('the item page has a Where to find it section', halibut.includes('Where to find it'))
check('the duplicate link is gone', !halibut.includes('Where can I get this'))
check(
  'the folded-in map came with it',
  (await page.locator('main svg').count()) > 0,
  `${await page.locator('main svg').count()} svg`,
)

// ── Weather, which this page never used to show ──
const halibutWhere = await whereText('halibut')
check('a weather-gated fish names its weather', /Needs Rain or Storm/.test(halibutWhere))
check(
  'and states how often that weather falls, from the shipped counts',
  /\d+–\d+ days of every fall/.test(halibutWhere),
  halibutWhere,
)

// The negative case, and the one that proves the gating test rather than the
// rendering. A rule's weather is already intersected with what its seasons
// allow, so a fall fish that bites in anything ships as all four weathers —
// comparing against all six would tag four fifths of the dataset.
const troutWhere = await whereText('rainbow_trout')
check(
  'a fish that bites in any fall weather says nothing about weather',
  !troutWhere.includes('Needs'),
  troutWhere,
)
check('and it is a fall fish, so there was something to get wrong', troutWhere.includes('fall'))

// ── The inference hedge sits on the places, not beside them ──
check(
  'an inferred place says what it was inferred from',
  /places inferred from its ocean habitat/.test(halibutWhere),
  halibutWhere,
)
check(
  'the hedge is drawn on the place links themselves',
  (await page.locator('section a[href*="/place/"].unverified').count()) >= 3,
)
// The old floating chip read as a fact about the window rather than a
// qualifier on the places.
check('the standalone chip is gone', !/·\s*place inferred\s*·/.test(halibutWhere))

// A window whose places are sourced must NOT be hedged, or the hedge means
// nothing. The moth's seven places come from the game's own room table.
const mothWhere = await whereText('brightbulb_moth')
check('a sourced place carries no hedge', !mothWhere.includes('inferred'), mothWhere)
// And its window still wraps midnight, rendered rather than unpicked.
check('a night window renders both ends as written', mothWhere.includes('20:00–02:00'), mothWhere)

// ── A window the flat rules index does not have ──
// Eleven items are only ever produced by a machine and have no row in it.
// Reading from the index instead would have blanked this section.
const honeyWhere = await whereText('honey')
check(
  'a machine-only item still says where it comes from',
  honeyWhere.includes('apiary'),
  honeyWhere,
)

// ── Shops: the whole line, not just the name ──
const innCounter = await soldByText('inn_counter')
check('a shop line states that shop’s own price', /1000t/.test(innCounter), innCounter)
check(
  'an upgrade-gated line says which upgrade',
  /Not stocked until you finish “Upgrade the Inn”/.test(innCounter),
  innCounter,
)
check(
  'and the gating quest is a link, not just words',
  (await page.locator('section a[href*="/quest/upgrade_the_inn"]').count()) === 1,
)

// The number that used to be lost. A skill gate falling through to a bare label
// rendered all five fishing rods as the same requirement.
const rod = await soldByText('fishing_rod_copper')
check('a skill gate keeps its level', /reach Fishing level 8/.test(rod), rod)

// Two levels of gate, and they are different statements: a stall that does not
// exist yet is not the same as a line inside a shop that is open.
const berries = await soldByText('berries_and_cream')
check(
  'a Saturday stall says it has to be built first',
  /The stall opens once you finish “Repair the Bridge”/.test(berries),
  berries,
)
check('and still says which day it trades', /Saturdays only/.test(berries))

// A perk gate, worded as something you do rather than a bare noun.
const sod = await soldByText('sod')
check('a perk gate reads as a sentence', /take the Steady Supplies perk/.test(sod), sod)

// ── The page stops contradicting itself ──
// "No source recorded" was printed directly above a shop selling the thing at a
// stated price, on 482 items.
const inn = await go('inn_counter')
check('a sold-only item does not claim no source', !inn.includes('No source recorded'), inn)
check('it points at the shop instead', /but it is sold, below/.test(inn), inn)

// The genuine empty state survives for something with neither — asserted
// positively, because "does not say it is sold" is also true of a 404.
const empty = await go('abyssal_chest')
check(
  'an item with no source and no shop still says so plainly',
  empty.includes('No source recorded'),
  empty,
)
check('and that fixture really is on a rendered item page', empty.includes('Abyssal Chest'), empty)

// ── A dish and its recipe are two things ──
//
// The Inn sells the Lemon Pie at 650 and the recipe for it at 400, at the same
// counter, and both rows resolve to `lemon_pie`. The page has to answer both
// questions without merging them — and until now it answered the second with
// "No source recorded" three sections up.
const madeText = async (id) => {
  await go(id)
  const section = page.locator('section').filter({ hasText: 'How it’s made' }).first()
  return (await section.innerText()).replace(/\s+/g, ' ')
}

const lemonPie = await go('lemon_pie')
check('a cooked dish still says where the dish itself comes from', lemonPie.includes('Sold by'))
// The heading is styled uppercase, so match it the way it renders.
check(
  'and separately, where the recipe comes from',
  /where to learn the recipe/i.test(lemonPie),
  lemonPie.slice(0, 200),
)

const lemonPieMade = await madeText('lemon_pie')
check(
  'the recipe names the shop that teaches it, at the scroll’s own price',
  /Sold at Sleeping Dragon Inn — 400t/.test(lemonPieMade),
  lemonPieMade,
)
check(
  'the crafting level is shown, which no page ever did before',
  /needs Cooking level 20/.test(lemonPieMade),
  lemonPieMade,
)

const lemonPieSold = await soldByText('lemon_pie')
check(
  'the dish keeps the dish price, not the scroll’s',
  /650t/.test(lemonPieSold) && !/400t/.test(lemonPieSold),
  lemonPieSold,
)

// The post is the game's milestone reward system, and the gate is the fact.
const bakedPotato = await madeText('baked_potato')
check(
  'a posted recipe names its sender and what earns it',
  /Arrives in the post from Nora/.test(bakedPotato) && /ship a Potato/.test(bakedPotato),
  bakedPotato,
)

// An inference must never render like a stated source. No scroll for this
// recipe exists anywhere in the game files, so the level is the only gate left.
const brazier = await madeText('cavern_floor_brazier')
check(
  'a level-only recipe says so and says it is inferred',
  /inferred/.test(brazier) && /Woodcrafting level 10/.test(brazier),
  brazier,
)

// The furniture half: 925 records shipped with no source at all because the
// wiki's furniture table has no column for one.
const brazierWhere = await whereText('cavern_floor_brazier')
check(
  'furniture found in a mine chest says so, where it used to say nothing at all',
  /chest/i.test(brazierWhere) && !/No source recorded/.test(brazierWhere),
  brazierWhere,
)

await page.close()
await browser.close()
finish()
