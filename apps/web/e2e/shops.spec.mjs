/**
 * The shop pages' one hard rule, checked from both sides: a product line and a
 * recipe-scroll line are two different statements (the Inn sells the Lemon Pie
 * at 650 AND the recipe at 400), and a null price renders as nothing rather
 * than as a number that was never stated. Every positive has the negative that
 * proves the test — absence looks exactly like a rendering that quietly broke.
 */
import { BASE, dismissTour, launch, makeChecker } from './helpers.mjs'

const { check, watch, finish } = makeChecker()
const browser = await launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } })
watch(page)
await dismissTour(page)

const go = async (id) => {
  await page.goto(`${BASE}#/shop/${id}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(800)
  return (await page.locator('main').innerText()).replace(/\s+/g, ' ')
}
const sectionText = async (title) => {
  const section = page.locator('section').filter({ hasText: title }).first()
  return (await section.innerText()).replace(/\s+/g, ' ')
}

// ── The index groups by what the data states ──
await page.goto(`${BASE}#/shops`, { waitUntil: 'networkidle' })
await page.waitForTimeout(800)
const index = (await page.locator('main').innerText()).replace(/\s+/g, ' ')
check('the shops index renders its groups', index.includes('Saturday Market'))
check('the market gate is stated once, over the group', /market opens once you/.test(index))
check('the challenge boards are listed', index.includes('challenge board'))
check('the souvenir stall is listed', index.includes('Souvenir Stall'))

// ── The dish and its recipe stay two lines with two prices (§2c) ──
await go('inn')
const stock = await sectionText('Stock')
const taught = await sectionText('Recipes taught')
check('the Inn sells the Lemon Pie as a product at 650', /Lemon Pie.*?650t/.test(stock), stock)
check('and teaches its recipe at 400', /Lemon Pie.*?400t/.test(taught))
check('the product section does not carry the scroll price', !/Lemon Pie\s*400t/.test(stock))

// ── Gates: a Saturday stall states its day and its bridge; a town shop neither ──
const darcys = await go('darcys_stall')
check('a market stall says Saturdays', darcys.includes('Saturdays only'))
check('and names the bridge quest as its gate', /opens once you finish/.test(darcys))
const general = await go('general_store')
check(
  'a town shop says neither',
  !general.includes('Saturdays only') && !/opens once you finish/.test(general),
)
check('but does group its seed stock by season', general.includes('Spring'))

// ── A null price renders nothing, and the gap note owns the hole ──
// Merri's stall is part-priced: Starry Flooring states no price while the
// Bakery Bread Basket beside it states 400t — the pair proves a null renders
// as absence, not as 0 or a dash, on the one screen where both shapes sit.
const merris = await go('merris_stall')
check(
  'a null-priced line renders no figure',
  merris.includes('Starry Flooring') && !/Starry Flooring \d+t/.test(merris),
)
check('while a priced neighbour shows its own', /Bakery Bread Basket 400t/.test(merris))
check('and the part-priced stall says so', /Not recorded yet:.*price/i.test(merris))

// ── The challenge boards: quests as the stock ──
const stillwell = await go('stillwell')
check('Stillwell’s board explains itself', /nothing is for sale/i.test(stillwell))
const stillwellRecipes = (stillwell.match(/recipe:/g) ?? []).length
check(
  'each Stillwell challenge shows its recipe',
  stillwellRecipes >= 10,
  `${stillwellRecipes} chips`,
)
const taliferro = await go('taliferro')
const taliferroRecipes = (taliferro.match(/recipe:/g) ?? []).length
check('Taliferro’s challenges show theirs too', taliferroRecipes >= 10, `${taliferroRecipes} chips`)
check('and state what each asks you to bring', /bring:/.test(taliferro))

// ── The souvenir stall groups by festival ──
const souvenir = await go('souvenir_stall')
check('the souvenir stall names its festivals', /Festival/.test(souvenir))
const festivalHeadings = await page.locator('main section h2, main section h3').allInnerTexts()
check(
  'goods sit under at least three festival headings',
  festivalHeadings.filter((h) => /festival/i.test(h)).length >= 3,
  festivalHeadings.join(' | '),
)

// ── An unknown id is a 404, not a blank ──
const nowhere = await go('no_such_shop')
check('an unknown shop 404s politely', nowhere.includes('Not found'))

await page.close()
await browser.close()
finish()
