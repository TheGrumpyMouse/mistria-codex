/**
 * Sorting the findable lists, on the map and on the calendar.
 *
 * The thing worth asserting is not that a sort exists but that it means
 * something. "Season" and "weather" do not order by their value — every row on
 * these screens already matches the chosen season and weather, so that would
 * put everything first. They order by how much the window narrows, which is the
 * difference between a thing that is gone in a fortnight and a thing that is
 * there all year.
 *
 * That makes the ordering checkable against what the row itself says: the tag
 * on the right of each row is the reason it is where it is. If the two ever
 * disagree, the list looks shuffled — which is the failure this spec exists to
 * catch.
 */
import { BASE, dismissTour, launch, makeChecker } from './helpers.mjs'

const { check, watch, finish } = makeChecker()
const browser = await launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } })
watch(page)
await dismissTour(page)

const go = async (hash) => {
  await page.goto(`${BASE}#${hash}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(900)
}
const sortBy = async (label) => {
  await page.getByRole('button', { name: label, exact: true }).first().click()
  await page.waitForTimeout(300)
}
/**
 * Every row of one named group on the map's "what you can get here".
 *
 * Expanded first, deliberately. A group previews eight rows, and on the Beach
 * all eight fish happen to be weather-tagged — so a check for "tagged above
 * untagged" over the preview would pass without ever meeting an untagged row.
 * The ordering only means something across the whole group.
 */
const groupRows = async (heading) => {
  const group = page
    .locator('main section > ul > li')
    .filter({ has: page.locator('> p', { hasText: heading }) })
    .first()
  const more = group.getByRole('button', { name: /Show \d+ more/ })
  if ((await more.count()) > 0) {
    await more.click()
    await page.waitForTimeout(200)
  }
  return (await group.locator('ul li').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim())
}

/**
 * One collapsed kind group on the calendar, opened.
 *
 * `> ul > li` and not `ul li`: the museum block above is also a `<details>`
 * with a "Fish" summary inside it, and a descendant search from the wrong one
 * returned all 464 rows on the page. The museum block nests its lists inside
 * per-place divs, so the direct-child path can only match a real kind group.
 */
const calendarGroup = async (heading) => {
  const details = page
    .locator('main summary')
    .filter({ hasText: new RegExp(`^${heading}\\b`) })
    .last()
    .locator('xpath=..')
  // Set `open` rather than clicking. A click toggles, so calling this twice
  // closed the group the second time — and a closed `<details>` still has its
  // rows in the DOM, so every one came back as empty text and the assertion
  // that read them passed on a list of blanks.
  await details.evaluate((el) => {
    el.open = true
  })
  await page.waitForTimeout(250)
  const rows = await details.locator('> ul > li').allInnerTexts()
  return rows.map((t) => t.replace(/\s+/g, ' ').trim())
}

// ── The map offers all three, and they are not the same order ──
await go('/map?region=the_beach')
const controls = await page.locator('main').innerText()
check('the map offers a sort', controls.includes('Sort'))

await sortBy('Name')
const byName = await groupRows('Fish')
await sortBy('Weather')
const byWeather = await groupRows('Fish')
await sortBy('Season')
const bySeason = await groupRows('Fish')

check(
  'sorting by name is alphabetical',
  byName.join('|') === [...byName].sort().join('|'),
  byName[0],
)
check('weather and name are different orders', byWeather.join('|') !== byName.join('|'))
check('season and weather are different orders', bySeason.join('|') !== byWeather.join('|'))

// ── Weather: the rows the weather brings, above the rows that are there anyway ──
// A tagged row names a weather; an untagged one is available in whatever falls.
// Every tagged row must precede every untagged one, or the order is arbitrary.
const tagged = byWeather.map((row) =>
  /not in |\bclear\b|\brain\b|\bstorm\b|\bwind\b|\bsnow\b|\bblizzard\b/.test(row),
)
check(
  'every weather-tagged fish sorts above every untagged one',
  tagged.lastIndexOf(true) < tagged.indexOf(false) || !tagged.includes(false),
  byWeather.slice(0, 4).join(' // '),
)
check(
  'there really are tagged and untagged rows to separate',
  tagged.includes(true) && tagged.includes(false),
)

// ── Season: narrowest window first, "all year" last ──
const allYearAt = bySeason.findIndex((row) => row.includes('all year'))
check(
  'all-year rows sink below the seasonal ones',
  allYearAt === -1 || bySeason.slice(allYearAt).every((row) => row.includes('all year')),
  bySeason.slice(0, 3).join(' // '),
)

// Calendar order, not the alphabet: spring before fall. Sorting the season
// names as text would run fall, spring, summer, winter and read as a data bug.
await go('/map?region=the_beach')
await sortBy('Season')
const forage = await groupRows('Forage')
const firstSpring = forage.findIndex((r) => / spring$/.test(r))
const firstFall = forage.findIndex((r) => / fall$/.test(r))
check(
  'single-season rows run in calendar order',
  firstSpring === -1 || firstFall === -1 || firstSpring < firstFall,
  `spring at ${firstSpring}, fall at ${firstFall}`,
)

// ── The choice is a preference: it survives a reload and crosses screens ──
await sortBy('Name')
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(900)
check(
  'the sort survives a reload',
  (await page
    .getByRole('button', { name: 'Name', exact: true })
    .first()
    .getAttribute('aria-pressed')) === 'true',
)

await sortBy('Weather')
await go('/?season=fall&day=12&weather=rain&time=600')
check(
  'the calendar honours the same preference',
  (await page
    .getByRole('button', { name: 'Weather', exact: true })
    .first()
    .getAttribute('aria-pressed')) === 'true',
)

// ── The calendar's rows carry the tags that explain the order ──
// Without them a reordered list looks shuffled: every row already matches the
// chosen instant, so the reason one is above another is only on the row.
const calendarRows = await calendarGroup('Fish')
check(
  'the calendar lists fish for this instant',
  calendarRows.length > 0 && calendarRows.length < 200,
  `${calendarRows.length} rows`,
)
check(
  'every calendar row says how wide its window is',
  calendarRows.every((row) => /all year|spring|summer|fall|winter/.test(row)),
  calendarRows[0],
)

// The window is the *whole* window, not the slice this instant satisfies —
// otherwise every row on a fall day would read "fall" and the tag would be a
// restatement of the date rather than a fact about the fish.
check(
  'a fall day still shows things that are there all year',
  calendarRows.some((row) => row.includes('all year')),
  `${calendarRows.filter((r) => r.includes('all year')).length} all-year rows`,
)

// And the sort still reaches them: name order is alphabetical here too.
await sortBy('Name')
// The row reads "<name> <places> <tags>", so the name is everything up to the
// first place separator — enough to compare an ordering by.
const named = (await calendarGroup('Fish')).map((row) => row.split(' Mistria')[0].split(' · ')[0])
check(
  'the calendar sorts by name too',
  named.length > 1 &&
    named.every((n) => n !== '') &&
    named.join('|') === [...named].sort().join('|'),
  named.slice(0, 4).join(', '),
)

await page.close()
await browser.close()
finish()
