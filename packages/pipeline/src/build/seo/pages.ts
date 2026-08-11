/**
 * Which records get a guide page, and what goes on it.
 *
 * Two jobs, kept in one file because they are the same decision seen twice: the
 * gate says a record has enough facts to be worth a URL, and the builders are
 * what those facts turn into.
 *
 * **The gate is the quality control for the whole surface.** Publishing 3,096
 * pages when 1,285 of them are a name and a price is the textbook thin-content
 * pattern, and it drags the ones that are worth reading down with it. So
 * furniture and cosmetics are excluded by category, and everything else must
 * clear `hasSubstance()` — which is why the ~139 animal-cosmetic `misc` rows
 * (an alpaca beret with no availability, no price and no use) do not get one.
 *
 * **Nothing here writes HTML.** Pages are described as data and `render.ts`
 * turns them into markup, so escaping lives in one function rather than in
 * every builder. See the note at the top of that file.
 */
import type {
  AvailabilityWindow,
  Habitat,
  Rarity,
  Season,
  SpawnMethod,
  TimeBlock,
  Weather,
} from '@mistria/schema'
import type { PageInput, Section } from './render.js'

// ---------------------------------------------------------------------------
// The records, as this module needs to see them
//
// Structural types rather than the schema's, because the guide reads a handful
// of fields off six datasets and importing six full entity types would couple
// it to every future field on all of them.
// ---------------------------------------------------------------------------

interface Common {
  id: string
  name: string
  wiki_page?: string | null
  former_ids?: string[]
  data_gaps?: string[]
  spoiler?: true
  unreleased?: true
}

export interface ItemRecord extends Common {
  category: string
  subcategory: string | null
  sell_value: number | null
  buy_value: number | null
  availability: AvailabilityWindow[]
  used_in_recipe_ids: string[]
  museum: { donatable: boolean; wing: string | null; set_id: string | null } | null
  is_craftable: boolean
  tags: string[]
}

export interface CharacterRecord extends Common {
  birthday: { season: Season; day: number } | null
  occupation: string | null
  affiliation: string | null
  romanceable: boolean | null
  is_vendor: boolean
  family: { character_id: string | null; relation: string }[]
}

export interface MonsterRecord extends Common {
  biome_ids: string[]
  hp: number | null
  damage: number | null
  essence: number | null
  drops: { item_id: string; chance: number | null }[]
}

export interface AnimalRecord extends Common {
  building: 'coop' | 'barn'
  matures_days: number | null
  products: {
    item_id: string
    sex: 'male' | 'female' | null
    days_to_produce: number | null
    hearts_required: number | null
    quality: string | null
  }[]
  breeding: { treat_item_id: string | null } | null
  purchase: { price: number } | null
}

export interface PlaceRecord extends Common {
  kind: string
  parent_id: string | null
  habitats: string[]
}

export interface MineRecord extends Common {
  location_id: string | null
  floors: { min: number; max: number }
  monster_ids: string[]
  ore_item_ids: string[]
  fish_item_ids: string[]
}

export interface QuestRecord extends Common {
  kind: string
  giver_character_id: string | null
  repeatable: boolean
  rewards: { item_ids: string[]; tesserae: number | null; renown: number | null } | null
}

/**
 * A recipe, which is **not** a page of its own.
 *
 * Its id is its output item's id, so a recipe page would be a second document
 * about the same subject at a second URL — the duplicate-content pattern the
 * inclusion gate exists to avoid. It renders as two blocks on the item's page
 * instead: how the thing is made, and where the recipe is learned.
 */
export interface RecipeRecord extends Common {
  kind: string
  output: { item_id: string | null; quantity: number }
  ingredients: { item_id: string | null; tag: string | null; quantity: number }[]
  station: string | null
  station_level: number | null
  skill: { id: string; level: number } | null
  craft_minutes: number | null
  sources: {
    method: string
    source_id: string | null
    character_id: string | null
    price: number | null
    currency: string
    confidence: string
  }[]
}

export interface Dataset {
  items: ItemRecord[]
  characters: CharacterRecord[]
  monsters: MonsterRecord[]
  /** Pets get no page — colours and three shared jobs is a thin document. */
  animals: AnimalRecord[]
  places: PlaceRecord[]
  mines: MineRecord[]
  quests: QuestRecord[]
  recipes: RecipeRecord[]
  /** Names only — neither gets a page, but a recipe source names both. */
  shops: Common[]
  festivals: Common[]
}

export interface GuidePage {
  /** Path segments below the site root, e.g. `['guide','fish','cave-eel']`. */
  segments: string[]
  input: PageInput
  /** The record this page is for — carried so validation can name it. */
  source: { dataset: string; id: string }
  /** Old slugs that should resolve here. */
  aliases: string[][]
}

// ---------------------------------------------------------------------------
// Vocabulary
//
// A local copy of what `apps/web/src/lib/labels.ts` does for the app. It cannot
// be imported — the pipeline does not depend on the web app, and inverting that
// to share one map would make the data build depend on the UI. Both are driven
// by the same closed enums in `@mistria/schema`, so a new token fails the
// exhaustiveness check here rather than rendering raw.
// ---------------------------------------------------------------------------

const titleCase = (token: string): string =>
  token.replace(/_/g, ' ').replace(/\b[a-z]/g, (c) => c.toUpperCase())

const METHOD_LABEL: Record<SpawnMethod, string> = {
  fishing: 'Fishing',
  diving: 'Diving',
  fish_trap: 'Fish trap',
  fish_bait: 'Bait',
  bug_net: 'Bug net',
  rock_break: 'Breaking rocks',
  foraging: 'Foraging',
  dig_spot: 'Digging',
  tree_shake: 'Shaking trees',
  mine_drop: 'Mining',
  monster_drop: 'Monster drop',
  crop_harvest: 'Harvesting',
  ranching: 'Ranching',
  apiary: 'Apiary',
  terrarium: 'Terrarium',
  shop: 'Bought from a shop',
  crafting: 'Crafting',
  cooking: 'Cooking',
  quest_reward: 'Quest reward',
  festival: 'Festival',
  mail: 'Mail',
  chest: 'Treasure chest',
  wishing_well: 'The Wishing Well',
  chicken_statue: 'The Chicken Statue',
  museum: 'The museum’s replicator',
  cutscene: 'Given during the story',
}

const HABITAT_LABEL: Record<Habitat, string> = {
  ocean: 'the ocean',
  river: 'rivers',
  pond: 'ponds',
  beach: 'the beach',
  mine_water: 'water in the mines',
  overworld: 'outdoors',
  forest: 'forest',
  mountain: 'mountains',
  cave: 'caves',
  indoor: 'indoors',
  farm: 'the farm',
}

const TIME_LABEL: Record<TimeBlock, string> = {
  morning: 'morning',
  day: 'day',
  evening: 'evening',
  night: 'night',
}

/** The `<p class="kind">` line and the `<title>` middle. Ours, not the game's. */
const CATEGORY_KIND: Record<string, string> = {
  fish: 'Fish',
  bug: 'Insect',
  forageable: 'Forageable',
  crop: 'Crop',
  fruit: 'Fruit',
  artifact: 'Artifact',
  material: 'Material',
  ranching_product: 'Ranching product',
  cooked: 'Cooked dish',
  tool: 'Tool',
  weapon: 'Weapon',
  equipment: 'Equipment',
  seed: 'Seed',
  ingot: 'Ingot',
  gem: 'Gem',
  ore: 'Ore',
  junk: 'Junk',
  misc: 'Item',
}

/** Categories that never get a page. See the thin-content note at the top. */
const EXCLUDED_CATEGORIES = new Set(['furniture', 'cosmetic'])

const list = (values: string[]): string =>
  values.length <= 1
    ? (values[0] ?? '')
    : `${values.slice(0, -1).join(', ')} and ${values[values.length - 1]}`

const SEASON_ORDER: Season[] = ['spring', 'summer', 'fall', 'winter']

/** "spring, summer, fall and winter" collapses to "all year" — it is the same claim, shorter. */
function seasonText(seasons: Season[]): string {
  if (seasons.length >= 4) return 'all year'
  const ordered = SEASON_ORDER.filter((s) => seasons.includes(s))
  return `in ${list(ordered)}`
}

// ---------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------

/** A spoiler or an unreleased record is never published. See `validate/seo.ts`. */
export const isPublishable = (record: Common): boolean =>
  record.spoiler !== true && record.unreleased !== true

/**
 * Enough facts to be worth a URL.
 *
 * A page whose only content is its own title is worse than no page: it is a
 * thin result for the reader and a quality signal against every other page on
 * the site. The four tests are the four reasons someone looks a thing up.
 */
export const hasSubstance = (item: ItemRecord): boolean =>
  item.availability.length > 0 ||
  item.sell_value !== null ||
  item.used_in_recipe_ids.length > 0 ||
  item.museum?.donatable === true

/**
 * The URL slug for an id.
 *
 * **A presentation of the id, never a second key.** Nothing in `data/` gains a
 * slug field and nothing joins on one — it is derived here, at render time, and
 * `buildPages` asserts the result is collision-free. Same discipline as
 * `ctx.idFor`: the mapping lives behind one function so it can only change in
 * one place.
 */
export const slugFor = (id: string): string => id.replace(/_/g, '-')

// ---------------------------------------------------------------------------
// URL helpers
// ---------------------------------------------------------------------------

/**
 * How to climb back to the site root from a page `depth` segments down.
 *
 * Relative, because per apps/web/CLAUDE.md a leading `/` works in dev and 404s
 * on Pages — and the guide has the same problem one directory deeper. The
 * canonical is the only absolute URL on the page, because a canonical must be.
 */
const upTo = (depth: number): string => (depth === 0 ? './' : '../'.repeat(depth))

export interface UrlContext {
  /** Absolute, with a trailing slash: `https://host/mistria-codex/`. */
  siteUrl: string
  /** Absolute URL of the social image, or null when no art has been packed. */
  ogImage: string | null
}

const canonicalOf = (ctx: UrlContext, segments: string[]): string =>
  `${ctx.siteUrl}${segments.join('/')}/`

// ---------------------------------------------------------------------------
// Availability, the part that has to stay honest
// ---------------------------------------------------------------------------

interface Lookup {
  placeName: (id: string) => string
  itemName: (id: string) => string
  characterName: (id: string) => string
  /**
   * Any record's display name, or null when nothing of that id is known.
   *
   * The three above all resolve against the same index and differ only in what
   * the call site means. This one is for a reference whose *table* depends on a
   * sibling field — a recipe source's `source_id`, which is a shop, a quest, a
   * festival or a mine — where "not found" has to be distinguishable so the
   * sentence can fall back rather than print a slug.
   */
  recordName: (id: string) => string | null
  /** A guide path for an id, or null when that record has no page. */
  pathOf: (id: string) => string[] | null
}

/**
 * One window, as one sentence.
 *
 * **One list item per window, never merged.** The array is an OR and each
 * window is an AND of its constraints — a bug can be spring-in-town-at-night
 * *and* all-season-in-the-mines-any-time, and flattening those two into one row
 * states something that is not true of either.
 *
 * The two nulls are kept apart, as everywhere else in this project: a
 * `not_applicable` weather (mines have none) prints nothing, while an unknown
 * one is left to the record's `data_gaps` to report. Never "any weather" —
 * that would turn "we have not looked" into a claim.
 */
function describeWindow(window: AvailabilityWindow, lookup: Lookup): string {
  const parts: string[] = [METHOD_LABEL[window.method]]

  const where =
    window.locations.length > 0
      ? list(window.locations.map(lookup.placeName))
      : window.habitats.length > 0
        ? list(window.habitats.map((h) => HABITAT_LABEL[h as Habitat] ?? titleCase(h)))
        : null
  if (where !== null) parts.push(`in ${where}`)

  if (window.depth !== null) parts.push(`floors ${window.depth.min}–${window.depth.max}`)

  parts.push(seasonText(window.seasons as Season[]))

  // Only when a source stated it. `weather_precision: 'not_applicable'` is a
  // fact about the place, not a constraint worth printing.
  if (window.weather !== null && window.weather.length > 0 && window.weather.length < 6) {
    parts.push(`when it is ${list((window.weather as Weather[]).map((w) => w))}`)
  }

  if (window.time_blocks !== null && window.time_blocks.length > 0) {
    parts.push(`during ${list((window.time_blocks as TimeBlock[]).map((t) => TIME_LABEL[t]))}`)
  } else if (window.time !== null && window.time.length > 0) {
    parts.push(`between ${list(window.time.map((t) => `${t.from} and ${t.to}`))}`)
  }

  if (window.rarity !== null) parts.push(`${window.rarity as Rarity}`)
  if (window.chance !== null) parts.push(`${Math.round(window.chance * 100)}% chance`)
  if (window.min_year !== null) parts.push(`from year ${window.min_year}`)

  // An inference must never read like a fact — the app draws these pins hollow
  // and the sentence has to carry the same hedge.
  if (window.confidence === 'inferred') parts.push('(inferred, not stated by a source)')

  return `${parts.join(' · ')}.`
}

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

/**
 * The `<meta name="description">` and the JSON-LD `description`.
 *
 * Assembled from named facts rather than reusing `describeWindow`, which was
 * the first thing tried and read as machine output — `Fishing · in The Upper
 * Mines · floors 2–19 · all year · uncommon` is a table row, not a sentence,
 * and the `·` separators land verbatim in the search snippet.
 *
 * Search engines truncate around 155-160 characters, so the parts are added
 * in descending order of usefulness and the result is cut on a sentence
 * boundary rather than mid-word.
 */
function metaDescription(parts: (string | null)[]): string {
  const text = parts.filter((p): p is string => p !== null && p !== '').join(' ')
  if (text.length <= 160) return text
  const cut = text.slice(0, 160)
  const stop = cut.lastIndexOf('. ')
  return stop > 60 ? cut.slice(0, stop + 1) : `${cut.slice(0, cut.lastIndexOf(' '))}…`
}

/** "found by fishing in The Upper Mines (floors 2–19), all year" — prose-shaped, fact-only. */
function whereSentence(window: AvailabilityWindow, lookup: Lookup): string {
  const method = METHOD_LABEL[window.method].toLowerCase()
  const where =
    window.locations.length > 0
      ? ` in ${list(window.locations.map(lookup.placeName))}`
      : window.habitats.length > 0
        ? ` in ${list(window.habitats.map((h) => HABITAT_LABEL[h as Habitat] ?? titleCase(h)))}`
        : ''
  const floors = window.depth === null ? '' : ` (floors ${window.depth.min}–${window.depth.max})`
  return `Found by ${method}${where}${floors}, ${seasonText(window.seasons as Season[])}.`
}

function crossLinks(
  heading: string,
  ids: string[],
  depth: number,
  lookup: Lookup,
  nameOf: (id: string) => string,
): Section | null {
  const links = ids
    .map((id) => {
      const path = lookup.pathOf(id)
      return path === null ? null : { href: `${upTo(depth)}${path.join('/')}/`, text: nameOf(id) }
    })
    .filter((l): l is { href: string; text: string } => l !== null)

  return links.length === 0 ? null : { heading, kind: 'links', links }
}

/**
 * Where a recipe is learned, as one sentence per source.
 *
 * The same wording rule as `describeWindow`: one line per source, never merged,
 * because the Spicy Cheddar Biscuit is taught by the Inn *and* by the Wishing
 * Well and picking one would be a claim. An inferred source says so in the
 * sentence — the guide has no styling to lean on, so the hedge has to be words.
 */
function describeRecipeSource(source: RecipeRecord['sources'][number], lookup: Lookup): string {
  const named =
    source.source_id === null ? null : (lookup.recordName(source.source_id) ?? source.source_id)
  const price = source.price === null ? '' : ` for ${source.price} tesserae`

  switch (source.method) {
    case 'default':
      return 'Known from the start'
    case 'shop':
      return named === null ? `Sold in a shop${price}` : `Sold at ${named}${price}`
    case 'mail':
      return source.character_id === null
        ? 'Arrives in the post'
        : `Sent in the post by ${lookup.characterName(source.character_id)}`
    case 'quest':
      return named === null ? 'A quest reward' : `Reward for ${named}`
    case 'festival':
      return named === null ? 'Sold at a festival stall' : `Sold at a stall at ${named}`
    case 'wishing_well':
      return 'From the Wishing Well'
    case 'chicken_statue':
      return 'From the Chicken Statue'
    case 'mines_chest':
      return named === null
        ? 'Treasure chests in the mines, with the Taste Maker perk'
        : `Treasure chests in ${named}, with the Taste Maker perk`
    case 'cutscene':
      return 'Given during the story'
    case 'skill_level':
      return 'Appears once the crafting level is reached — inferred, as no recipe scroll for it exists in the game files'
    default:
      return titleCase(source.method)
  }
}

/**
 * The recipe's two blocks, for the item it makes.
 *
 * Deliberately `Thing` + `additionalProperty` like every other page rather than
 * schema.org `Recipe`: that type is for food a person can actually cook, and
 * marking up a game dish with it would publish structured data claiming this
 * page is a cooking recipe. The facts are the same either way; the claim is not.
 */
function recipeSections(recipe: RecipeRecord, lookup: Lookup): Section[] {
  const sections: Section[] = []

  const made: { label: string; value: string }[] = []
  if (recipe.station !== null) {
    made.push({
      label: 'Station',
      value:
        recipe.station_level === null
          ? recipe.station
          : `${recipe.station} (level ${recipe.station_level})`,
    })
  }
  if (recipe.skill !== null) {
    made.push({
      label: 'Skill',
      value: `${titleCase(recipe.skill.id)} level ${recipe.skill.level}`,
    })
  }
  if (recipe.craft_minutes !== null) {
    made.push({ label: 'Takes', value: `${recipe.craft_minutes} minutes` })
  }
  for (const ingredient of recipe.ingredients) {
    const what =
      ingredient.item_id === null
        ? `any ${(ingredient.tag ?? '').replace(/_/g, ' ')}`
        : lookup.itemName(ingredient.item_id)
    made.push({ label: 'Ingredient', value: `${what} ×${ingredient.quantity}` })
  }
  if (made.length > 0) sections.push({ heading: 'How it’s made', kind: 'facts', rows: made })

  if (recipe.sources.length > 0) {
    sections.push({
      heading: 'Where to learn the recipe',
      kind: 'list',
      items: recipe.sources.map((source) => describeRecipeSource(source, lookup)),
    })
  }

  return sections
}

function itemPage(
  item: ItemRecord,
  ctx: UrlContext,
  lookup: Lookup,
  recipe: RecipeRecord | undefined,
): GuidePage {
  const segments = ['guide', item.category.replace(/_/g, '-'), slugFor(item.id)]
  const depth = segments.length
  const kind = CATEGORY_KIND[item.category] ?? 'Item'
  const sections: Section[] = []
  const properties: { name: string; value: string }[] = [{ name: 'Category', value: kind }]

  if (item.availability.length > 0) {
    sections.push({
      heading: 'Where to find it',
      kind: 'list',
      items: item.availability.map((w) => describeWindow(w, lookup)),
    })
  }

  const value: { label: string; value: string }[] = []
  if (item.sell_value !== null) {
    value.push({ label: 'Sells for', value: `${item.sell_value} tesserae` })
    properties.push({ name: 'Sell value', value: String(item.sell_value) })
  }
  if (item.buy_value !== null) {
    value.push({ label: 'Buy price', value: `${item.buy_value} tesserae` })
    properties.push({ name: 'Buy value', value: String(item.buy_value) })
  }
  if (item.museum?.donatable === true) {
    const wing = item.museum.wing === null ? 'the museum' : `the ${item.museum.wing} wing`
    value.push({ label: 'Museum', value: `Can be donated to ${wing}` })
    properties.push({ name: 'Museum', value: wing })
  }
  if (item.is_craftable) value.push({ label: 'Craftable', value: 'Yes' })
  if (value.length > 0) sections.push({ heading: 'Value', kind: 'facts', rows: value })

  // The recipe, as its own two blocks. A dish and its recipe are obtained two
  // different ways — you buy a Lemon Pie at the Inn for 650 and its recipe at
  // the same counter for 400 — so they are separate sections, not one.
  if (recipe !== undefined) sections.push(...recipeSections(recipe, lookup))

  const used = crossLinks('Used in', item.used_in_recipe_ids, depth, lookup, lookup.itemName)
  if (used !== null) sections.push(used)

  const first = item.availability[0]
  const learn = recipe?.sources[0]
  const description = metaDescription([
    `${item.name} is a ${kind.toLowerCase()} in Fields of Mistria.`,
    first === undefined ? null : whereSentence(first, lookup),
    learn === undefined ? null : `Recipe: ${describeRecipeSource(learn, lookup).toLowerCase()}.`,
    item.sell_value === null ? null : `Sells for ${item.sell_value} tesserae.`,
    item.museum?.donatable === true ? 'Can be donated to the museum.' : null,
  ])

  return {
    segments,
    source: { dataset: 'items', id: item.id },
    aliases: (item.former_ids ?? []).map((old) => [
      'guide',
      item.category.replace(/_/g, '-'),
      slugFor(old),
    ]),
    input: {
      name: item.name,
      kind,
      description,
      canonical: canonicalOf(ctx, segments),
      siteUrl: ctx.siteUrl,
      appHref: `${upTo(depth)}#/item/${item.id}`,
      hubHref: `${upTo(depth)}guide/`,
      rootHref: upTo(depth),
      sourceUrl: wikiUrl(item.wiki_page),
      ogImage: ctx.ogImage,
      sections,
      gaps: item.data_gaps ?? [],
      properties,
    },
  }
}

function characterPage(character: CharacterRecord, ctx: UrlContext): GuidePage {
  const segments = ['guide', 'villager', slugFor(character.id)]
  const depth = segments.length
  const rows: { label: string; value: string }[] = []
  const properties: { name: string; value: string }[] = []

  if (character.birthday !== null) {
    const birthday = `${titleCase(character.birthday.season)} ${character.birthday.day}`
    rows.push({ label: 'Birthday', value: birthday })
    properties.push({ name: 'Birthday', value: birthday })
  }
  if (character.occupation !== null) {
    rows.push({ label: 'Occupation', value: character.occupation })
    properties.push({ name: 'Occupation', value: character.occupation })
  }
  if (character.affiliation !== null)
    rows.push({ label: 'Affiliation', value: character.affiliation })
  if (character.romanceable !== null) {
    rows.push({ label: 'Romanceable', value: character.romanceable ? 'Yes' : 'No' })
    properties.push({ name: 'Romanceable', value: character.romanceable ? 'Yes' : 'No' })
  }
  if (character.is_vendor) rows.push({ label: 'Runs a shop', value: 'Yes' })

  const sections: Section[] = []
  if (rows.length > 0) sections.push({ heading: 'About', kind: 'facts', rows })
  if (character.family.length > 0) {
    sections.push({
      heading: 'Family',
      kind: 'list',
      items: character.family.map((f) => f.relation),
    })
  }

  const description = metaDescription([
    `${character.name} is a villager in Fields of Mistria.`,
    character.occupation === null ? null : `${character.occupation}.`,
    character.birthday === null
      ? null
      : `Birthday ${titleCase(character.birthday.season)} ${character.birthday.day}.`,
    character.romanceable === true ? 'Romanceable.' : null,
  ])

  return {
    segments,
    source: { dataset: 'characters', id: character.id },
    aliases: (character.former_ids ?? []).map((old) => ['guide', 'villager', slugFor(old)]),
    input: {
      name: character.name,
      kind: 'Villager',
      description,
      canonical: canonicalOf(ctx, segments),
      siteUrl: ctx.siteUrl,
      appHref: `${upTo(depth)}#/villager/${character.id}`,
      hubHref: `${upTo(depth)}guide/`,
      rootHref: upTo(depth),
      sourceUrl: wikiUrl(character.wiki_page),
      ogImage: ctx.ogImage,
      sections,
      gaps: character.data_gaps ?? [],
      properties,
    },
  }
}

function animalPage(animal: AnimalRecord, ctx: UrlContext, lookup: Lookup): GuidePage {
  const segments = ['guide', 'animal', slugFor(animal.id)]
  const depth = segments.length
  const sections: Section[] = []
  const properties: { name: string; value: string }[] = []

  const rows: { label: string; value: string }[] = []
  rows.push({ label: 'Home', value: animal.building === 'coop' ? 'Coop' : 'Barn' })
  properties.push({ name: 'Home', value: animal.building === 'coop' ? 'Coop' : 'Barn' })
  if (animal.purchase !== null) {
    rows.push({ label: 'Price', value: `${animal.purchase.price}t` })
    properties.push({ name: 'Price', value: `${animal.purchase.price}t` })
  }
  if (animal.matures_days !== null) {
    rows.push({ label: 'Grows up in', value: `${animal.matures_days} days` })
  }
  if (animal.breeding?.treat_item_id != null) {
    rows.push({ label: 'Breeding treat', value: lookup.itemName(animal.breeding.treat_item_id) })
  }
  sections.push({ heading: 'About', kind: 'facts', rows })

  if (animal.products.length > 0) {
    sections.push({
      heading: 'Produce',
      kind: 'list',
      items: animal.products.map((product) => {
        const parts: string[] = [lookup.itemName(product.item_id)]
        if (product.sex !== null) parts.push(product.sex === 'female' ? 'females' : 'males')
        if (product.days_to_produce !== null) {
          parts.push(
            product.days_to_produce === 1 ? 'daily' : `every ${product.days_to_produce} days`,
          )
        }
        if (product.quality === 'golden' && product.hearts_required !== null) {
          parts.push(`from ${product.hearts_required} hearts`)
        }
        return parts.join(' — ')
      }),
    })
  }

  const makes =
    animal.products.length === 0
      ? null
      : `It produces ${list(animal.products.map((p) => lookup.itemName(p.item_id)))}.`

  return {
    segments,
    source: { dataset: 'animals', id: animal.id },
    aliases: (animal.former_ids ?? []).map((old) => ['guide', 'animal', slugFor(old)]),
    input: {
      name: animal.name,
      kind: 'Ranch animal',
      description: metaDescription([
        `The ${animal.name} is a ${animal.building} animal in Fields of Mistria.`,
        makes,
      ]),
      canonical: canonicalOf(ctx, segments),
      siteUrl: ctx.siteUrl,
      appHref: `${upTo(depth)}#/animal/${animal.id}`,
      hubHref: `${upTo(depth)}guide/`,
      rootHref: upTo(depth),
      sourceUrl: wikiUrl(animal.wiki_page),
      ogImage: ctx.ogImage,
      sections,
      gaps: animal.data_gaps ?? [],
      properties,
    },
  }
}

function monsterPage(monster: MonsterRecord, ctx: UrlContext, lookup: Lookup): GuidePage {
  const segments = ['guide', 'monster', slugFor(monster.id)]
  const depth = segments.length
  const sections: Section[] = []
  const properties: { name: string; value: string }[] = []

  const rows: { label: string; value: string }[] = []
  if (monster.hp !== null) {
    rows.push({ label: 'Health', value: String(monster.hp) })
    properties.push({ name: 'Health', value: String(monster.hp) })
  }
  if (monster.damage !== null) rows.push({ label: 'Damage', value: String(monster.damage) })
  if (monster.essence !== null) rows.push({ label: 'Essence', value: String(monster.essence) })
  if (monster.biome_ids.length > 0) {
    rows.push({ label: 'Found in', value: list(monster.biome_ids.map(lookup.placeName)) })
  }
  if (rows.length > 0) sections.push({ heading: 'About', kind: 'facts', rows })

  if (monster.drops.length > 0) {
    sections.push({
      heading: 'Drops',
      kind: 'list',
      items: monster.drops.map((d) =>
        d.chance === null
          ? lookup.itemName(d.item_id)
          : `${lookup.itemName(d.item_id)} — ${Math.round(d.chance * 100)}% chance`,
      ),
    })
  }

  const where =
    monster.biome_ids.length === 0
      ? null
      : `Found in ${list(monster.biome_ids.map(lookup.placeName))}.`

  return {
    segments,
    source: { dataset: 'monsters', id: monster.id },
    aliases: (monster.former_ids ?? []).map((old) => ['guide', 'monster', slugFor(old)]),
    input: {
      name: monster.name,
      kind: 'Monster',
      description: metaDescription([`${monster.name} is a monster in Fields of Mistria.`, where]),
      canonical: canonicalOf(ctx, segments),
      siteUrl: ctx.siteUrl,
      appHref: `${upTo(depth)}#/monster/${monster.id}`,
      hubHref: `${upTo(depth)}guide/`,
      rootHref: upTo(depth),
      sourceUrl: wikiUrl(monster.wiki_page),
      ogImage: ctx.ogImage,
      sections,
      gaps: monster.data_gaps ?? [],
      properties,
    },
  }
}

function placePage(
  place: PlaceRecord,
  mine: MineRecord | undefined,
  ctx: UrlContext,
  lookup: Lookup,
): GuidePage {
  const segments = ['guide', 'place', slugFor(place.id)]
  const depth = segments.length
  const sections: Section[] = []
  const properties: { name: string; value: string }[] = []

  const rows: { label: string; value: string }[] = [{ label: 'Kind', value: titleCase(place.kind) }]
  // Only the five mine biomes have a floor range, and the parent `the_mines`
  // deliberately does not — deriving 1–99 from its children would be an
  // inference, and the shipped ranges skip floors 20, 40, 60, 80 and 100.
  if (mine !== undefined) {
    const floors = `floors ${mine.floors.min}–${mine.floors.max}`
    rows.push({ label: 'Depth', value: floors })
    properties.push({ name: 'Floors', value: `${mine.floors.min}–${mine.floors.max}` })
  }
  if (place.parent_id !== null) {
    rows.push({ label: 'Part of', value: lookup.placeName(place.parent_id) })
  }
  sections.push({ heading: 'About', kind: 'facts', rows })

  if (mine !== undefined) {
    for (const [heading, ids, nameOf] of [
      ['Ore found here', mine.ore_item_ids, lookup.itemName],
      ['Fish found here', mine.fish_item_ids, lookup.itemName],
      ['Monsters here', mine.monster_ids, lookup.placeName],
    ] as const) {
      const section = crossLinks(heading, [...ids], depth, lookup, nameOf)
      if (section !== null) sections.push(section)
    }
  }

  const kind = mine === undefined ? 'Location' : 'Mine biome'
  const depthText = mine === undefined ? null : `Floors ${mine.floors.min}–${mine.floors.max}.`

  return {
    segments,
    source: { dataset: mine === undefined ? 'locations' : 'mines', id: place.id },
    aliases: (place.former_ids ?? []).map((old) => ['guide', 'place', slugFor(old)]),
    input: {
      name: place.name,
      kind,
      description: metaDescription([
        `${place.name} is a location in Fields of Mistria.`,
        depthText,
      ]),
      canonical: canonicalOf(ctx, segments),
      siteUrl: ctx.siteUrl,
      appHref: `${upTo(depth)}#/place/${place.id}`,
      hubHref: `${upTo(depth)}guide/`,
      rootHref: upTo(depth),
      sourceUrl: wikiUrl(place.wiki_page),
      ogImage: ctx.ogImage,
      sections,
      gaps: place.data_gaps ?? [],
      properties,
    },
  }
}

// Quest records also carry `required_items`, `unlocks_*_ids` and
// `teaches_recipe_ids`, deliberately not rendered yet. If this page grows
// them, route every target through `crossLinks`/`pathOf` (which withholds
// unpublished records) — printing a veiled record's *name* in plain text
// would leak what the app's spoiler system hides, and validate/seo.ts only
// catches links, not prose.
function questPage(quest: QuestRecord, ctx: UrlContext, lookup: Lookup): GuidePage {
  const segments = ['guide', 'quest', slugFor(quest.id)]
  const depth = segments.length
  const sections: Section[] = []
  const properties: { name: string; value: string }[] = []

  const rows: { label: string; value: string }[] = [{ label: 'Kind', value: titleCase(quest.kind) }]
  if (quest.giver_character_id !== null) {
    rows.push({ label: 'Given by', value: lookup.characterName(quest.giver_character_id) })
  }
  if (quest.repeatable) rows.push({ label: 'Repeatable', value: 'Yes' })
  if (quest.rewards?.tesserae != null) {
    rows.push({ label: 'Tesserae', value: String(quest.rewards.tesserae) })
    properties.push({ name: 'Tesserae', value: String(quest.rewards.tesserae) })
  }
  if (quest.rewards?.renown != null) {
    rows.push({ label: 'Renown', value: String(quest.rewards.renown) })
  }
  sections.push({ heading: 'About', kind: 'facts', rows })

  const rewards = crossLinks(
    'Rewards',
    quest.rewards?.item_ids ?? [],
    depth,
    lookup,
    lookup.itemName,
  )
  if (rewards !== null) sections.push(rewards)

  const giver =
    quest.giver_character_id === null
      ? null
      : `Given by ${lookup.characterName(quest.giver_character_id)}.`

  return {
    segments,
    source: { dataset: 'quests', id: quest.id },
    aliases: (quest.former_ids ?? []).map((old) => ['guide', 'quest', slugFor(old)]),
    input: {
      name: quest.name,
      kind: 'Quest',
      description: metaDescription([`${quest.name} is a quest in Fields of Mistria.`, giver]),
      canonical: canonicalOf(ctx, segments),
      siteUrl: ctx.siteUrl,
      appHref: `${upTo(depth)}#/quest/${quest.id}`,
      hubHref: `${upTo(depth)}guide/`,
      rootHref: upTo(depth),
      sourceUrl: wikiUrl(quest.wiki_page),
      ogImage: ctx.ogImage,
      sections,
      gaps: quest.data_gaps ?? [],
      properties,
    },
  }
}

const wikiUrl = (page: string | null | undefined): string | null =>
  page === null || page === undefined || page === ''
    ? null
    : `https://fieldsofmistria.wiki.gg/wiki/${encodeURIComponent(page.replace(/ /g, '_'))}`

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

export interface BuildResult {
  pages: GuidePage[]
  /** Ids that cleared the gate, so validation can check nothing published is a spoiler. */
  published: Set<string>
  /** Counted, not silently dropped — see the join-drop rule in CLAUDE.md. */
  skipped: { excludedCategory: number; thin: number; spoiler: number; unreleased: number }
}

export function buildPages(data: Dataset, ctx: UrlContext): BuildResult {
  const skipped = { excludedCategory: 0, thin: 0, spoiler: 0, unreleased: 0 }

  const gate = <T extends Common>(records: T[]): T[] =>
    records.filter((record) => {
      if (record.spoiler === true) {
        skipped.spoiler += 1
        return false
      }
      if (record.unreleased === true) {
        skipped.unreleased += 1
        return false
      }
      return true
    })

  const items = gate(data.items).filter((item) => {
    if (EXCLUDED_CATEGORIES.has(item.category)) {
      skipped.excludedCategory += 1
      return false
    }
    if (!hasSubstance(item)) {
      skipped.thin += 1
      return false
    }
    return true
  })

  const characters = gate(data.characters)
  const monsters = gate(data.monsters)
  const animals = gate(data.animals)
  const quests = gate(data.quests).filter(
    (q) => q.rewards !== null || q.giver_character_id !== null,
  )
  const mines = gate(data.mines)
  const mineByLocation = new Map(
    mines.flatMap((m) => (m.location_id === null ? [] : [[m.location_id, m] as const])),
  )
  const places = gate(data.places)

  // Names resolve across *all* records, not just published ones: a monster that
  // drops an unpublished item should still say what it drops. Only the link is
  // withheld, by `pathOf` returning null.
  const nameIndex = new Map<string, string>([
    ...data.items.map((r) => [r.id, r.name] as const),
    ...data.characters.map((r) => [r.id, r.name] as const),
    ...data.monsters.map((r) => [r.id, r.name] as const),
    ...data.animals.map((r) => [r.id, r.name] as const),
    ...data.places.map((r) => [r.id, r.name] as const),
    ...data.mines.map((r) => [r.id, r.name] as const),
    ...data.quests.map((r) => [r.id, r.name] as const),
    ...data.shops.map((r) => [r.id, r.name] as const),
    ...data.festivals.map((r) => [r.id, r.name] as const),
  ])
  const nameOf = (id: string): string => nameIndex.get(id) ?? titleCase(id)

  const pathIndex = new Map<string, string[]>()
  for (const r of items) {
    pathIndex.set(r.id, ['guide', r.category.replace(/_/g, '-'), slugFor(r.id)])
  }
  for (const r of characters) pathIndex.set(r.id, ['guide', 'villager', slugFor(r.id)])
  for (const r of monsters) pathIndex.set(r.id, ['guide', 'monster', slugFor(r.id)])
  for (const r of animals) pathIndex.set(r.id, ['guide', 'animal', slugFor(r.id)])
  for (const r of places) pathIndex.set(r.id, ['guide', 'place', slugFor(r.id)])
  for (const r of quests) pathIndex.set(r.id, ['guide', 'quest', slugFor(r.id)])

  const lookup: Lookup = {
    placeName: nameOf,
    itemName: nameOf,
    characterName: nameOf,
    recordName: (id) => nameIndex.get(id) ?? null,
    pathOf: (id) => pathIndex.get(id) ?? null,
  }

  // A recipe is addressed by the item it makes, so this is keyed by output
  // rather than by recipe id — they happen to be equal today, and relying on
  // that would be relying on a coincidence the furniture collapse could end.
  const recipeByOutput = new Map(
    data.recipes.flatMap((r) =>
      r.output.item_id === null ? [] : [[r.output.item_id, r] as const],
    ),
  )

  const pages: GuidePage[] = [
    ...items.map((item) => itemPage(item, ctx, lookup, recipeByOutput.get(item.id))),
    ...characters.map((character) => characterPage(character, ctx)),
    ...monsters.map((monster) => monsterPage(monster, ctx, lookup)),
    ...animals.map((animal) => animalPage(animal, ctx, lookup)),
    ...places.map((place) => placePage(place, mineByLocation.get(place.id), ctx, lookup)),
    ...quests.map((quest) => questPage(quest, ctx, lookup)),
  ]

  return {
    pages,
    published: new Set(pages.map((p) => p.source.id)),
    skipped,
  }
}
