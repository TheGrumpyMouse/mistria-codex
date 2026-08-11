/**
 * Every internal token the UI must never show raw, translated once.
 *
 * The dataset speaks snake_case — categories, methods, gap names, requirement
 * objects — and each screen used to translate its own corner of it, which is
 * how "S1", "id pending rename" and "[object Object]" reached players. One
 * module, so a vocabulary change is one edit and an untranslated token is a
 * grep away.
 */

/** Category id -> what a player calls it. Shared by Browse, Search and detail pages. */
export const CATEGORY_LABELS: Record<string, string> = {
  fish: 'Fish',
  bug: 'Bugs',
  forageable: 'Forage',
  crop: 'Crops',
  seed: 'Seeds',
  cooked: 'Cooked',
  artifact: 'Artifacts',
  material: 'Materials',
  equipment: 'Equipment',
  tool: 'Tools',
  weapon: 'Weapons',
  ranching_product: 'Ranching',
  fruit: 'Fruit',
  furniture: 'Furniture',
  cosmetic: 'Wardrobe',
  junk: 'Junk',
  misc: 'Other',
  character: 'Villagers',
  monster: 'Monsters',
  location: 'Places',
  quest: 'Quests',
}

/**
 * `basic_chest_set` -> "Basic Chest", `head_gear_misc` -> "Head Gear Misc".
 * The one sanctioned translation of a sub-category token: the vocabularies are
 * closed and ours to read (63 furniture set stems, 36 wardrobe categories, all
 * `words_with_underscores`), the transformation is total, and curating 99
 * hand-title-cased labels would rot. Rule 8 is about *unknown* tokens leaking
 * — this is a closed set passing through one named door.
 */
export const subcategoryLabel = (token: string): string =>
  token
    .replace(/_set$/, '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())

/** Body slot -> where you wear it, for a wardrobe item's subtitle. */
export const WORN_ON_LABELS: Record<string, string> = {
  hair: 'Hair',
  facial_hair: 'Facial hair',
  eyes: 'Eyes',
  head_gear: 'Head',
  face_gear: 'Face',
  top: 'Top',
  bottom: 'Bottom',
  feet: 'Feet',
  back: 'Back',
}

/** Singular, for a one-thing subtitle ("Bugs" is wrong under one beetle). */
export const CATEGORY_LABELS_ONE: Record<string, string> = {
  fish: 'Fish',
  bug: 'Bug',
  forageable: 'Forageable',
  crop: 'Crop',
  seed: 'Seed',
  cooked: 'Cooked dish',
  artifact: 'Artifact',
  material: 'Material',
  equipment: 'Equipment',
  tool: 'Tool',
  weapon: 'Weapon',
  ranching_product: 'Ranching product',
  fruit: 'Fruit',
  furniture: 'Furniture',
  cosmetic: 'Wardrobe item',
  junk: 'Junk',
  misc: 'Item',
  character: 'Villager',
  monster: 'Monster',
  location: 'Place',
  quest: 'Quest',
}

export const categoryLabel = (id: string): string => CATEGORY_LABELS[id] ?? id.replace(/_/g, ' ')
export const categoryLabelOne = (id: string): string =>
  CATEGORY_LABELS_ONE[id] ?? id.replace(/_/g, ' ')

export const METHOD_LABELS: Record<string, string> = {
  fishing: 'Fishing',
  diving: 'Diving',
  fish_trap: 'The fish trap',
  fish_bait: 'Baited fishing',
  bug_net: 'Bug net',
  rock_break: 'Breaking rocks',
  foraging: 'Foraging',
  crop_harvest: 'Harvesting',
  dig_spot: 'Dig spots',
  tree_shake: 'Shaking trees',
  mine_drop: 'Mining',
  monster_drop: 'Monster drops',
  ranching: 'Ranching',
  apiary: 'From an apiary',
  terrarium: 'From a terrarium',
  shop: 'Bought',
  crafting: 'Crafted',
  cooking: 'Cooked',
  quest_reward: 'Quest reward',
  festival: 'At a festival',
  mail: 'In the mail',
  chest: 'Treasure chests',
  wishing_well: 'The Wishing Well',
  chicken_statue: 'The Chicken Statue',
  museum: 'The museum’s replicator',
  cutscene: 'Given during the story',
}

export const methodLabel = (id: string): string => METHOD_LABELS[id] ?? id.replace(/_/g, ' ')

/**
 * `data_gaps` tokens a player should see, in words a player uses.
 *
 * Anything absent from this map is internal bookkeeping (`id_pending_rename`,
 * `predates_1_0`, `map_id`…) and is dropped rather than translated — a token we
 * add later renders as nothing, never as jargon. Dropping is the safe default;
 * translating by `replace(/_/g, ' ')` was how "wiki flagged missing data"
 * reached the screen.
 */
export const GAP_LABELS: Record<string, string> = {
  obtain_method: 'where to get it',
  locations: 'the exact spot',
  time: 'time of day',
  weather: 'weather',
  sell_value: 'sell price',
  schedule: 'daily schedule',
  heart_events: 'heart events',
  birthday: 'birthday',
  growth_days: 'growth time',
  seed_item_id: 'the seed',
  required_items: 'what it costs',
  hp: 'health',
  damage: 'damage',
  essence: 'essence',
  drops: 'drops',
  anchor: 'map position',
}

/** The gaps worth telling a player about, in their words. Internal ones vanish. */
export const gapLabels = (gaps: string[]): string[] => [
  ...new Set(gaps.flatMap((gap) => (GAP_LABELS[gap] === undefined ? [] : [GAP_LABELS[gap]]))),
]

/** What a spot pin is, for map labels and tooltips. */
export const SPOT_KIND_LABELS: Record<string, string> = {
  dig_spot: 'Dig site',
  dive_hole: 'Dive spot',
  forage_patch: 'Forage patch',
  rock: 'Rock',
  tree: 'Tree',
  water: 'Water',
  entrance: 'Entrance',
}

/**
 * A requirement object as a sentence fragment: "finish “Breaking the Fire
 * Seal”" / "the Well Placed perk". Names arrive title-cased from the key when
 * no dataset is loaded to resolve them — a title-cased slug reads fine
 * ("Breaking The Fire Seal"), unlike the raw one.
 */
export interface Requirement {
  type: string
  key: string
  op?: string
  value?: unknown
}

export const titleCase = (key: string): string =>
  key
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')

export function requirementPhrase(req: Requirement, name?: string): string {
  const parts = requirementDisplay(req, name)
  return `${parts.prefix}${parts.label}${parts.suffix}`
}

/**
 * The same phrase, split so a screen can wrap the named thing in a Link.
 *
 * This module stays plain TypeScript — no JSX — so it hands back parts and a
 * route target rather than a node. `linkTo` is set only when the requirement
 * names something that has a page; callers render `label` as text otherwise.
 */
export interface RequirementDisplay {
  prefix: string
  label: string
  suffix: string
  linkTo: { to: '/quest/$id' | '/place/$id' | '/item/$id'; id: string } | null
}

export function requirementDisplay(req: Requirement, name?: string): RequirementDisplay {
  const label = name ?? titleCase(req.key)
  if (req.type === 'quest') {
    return { prefix: 'finish “', label, suffix: '”', linkTo: { to: '/quest/$id', id: req.key } }
  }
  if (req.type === 'perk') return { prefix: 'the ', label, suffix: ' perk', linkTo: null }
  if (req.type === 'location') {
    return { prefix: '', label, suffix: ' unlocked', linkTo: { to: '/place/$id', id: req.key } }
  }
  // A skill gate is the one requirement whose *number* is the requirement:
  // the Tackle Shop sells five rods behind Fishing 8, 15, 20, 30 and 45, and
  // without the level all five read as the same gate. Falling through to the
  // bare label lost it silently.
  if (req.type === 'skill' && typeof req.value === 'number') {
    return { prefix: '', label, suffix: ` level ${req.value}`, linkTo: null }
  }
  // The post office's two conditions. Neither is `item`: holding a potato and
  // having shipped one are different states, and the letter only cares about
  // the second.
  if (req.type === 'shipped_item') {
    return { prefix: 'shipping a ', label, suffix: '', linkTo: { to: '/item/$id', id: req.key } }
  }
  if (req.type === 'donated_item') {
    return {
      prefix: 'donating a ',
      label,
      suffix: ' to the museum',
      linkTo: { to: '/item/$id', id: req.key },
    }
  }
  return { prefix: '', label, suffix: '', linkTo: null }
}

/**
 * The same requirement worded as something you *do*, for a sentence that leads
 * with "until you".
 *
 * `requirementDisplay` hands back a noun for a perk and a verb for a quest,
 * which is right where the lead-in is "needs" and wrong where it is "until
 * you" — "until you the Steady Supplies perk" is not a sentence. Each type gets
 * its own verb here rather than the caller picking one, because a screen that
 * spells its own wording is how the next requirement type reaches a player as
 * `town_rank`.
 */
export function gateDisplay(req: Requirement, name?: string): RequirementDisplay {
  const label = name ?? titleCase(req.key)
  if (req.type === 'quest') {
    return { prefix: 'finish “', label, suffix: '”', linkTo: { to: '/quest/$id', id: req.key } }
  }
  if (req.type === 'perk') return { prefix: 'take the ', label, suffix: ' perk', linkTo: null }
  if (req.type === 'location') {
    return { prefix: 'unlock ', label, suffix: '', linkTo: { to: '/place/$id', id: req.key } }
  }
  if (req.type === 'skill' && typeof req.value === 'number') {
    return { prefix: 'reach ', label, suffix: ` level ${req.value}`, linkTo: null }
  }
  if (req.type === 'shipped_item') {
    return { prefix: 'ship a ', label, suffix: '', linkTo: { to: '/item/$id', id: req.key } }
  }
  if (req.type === 'donated_item') {
    return {
      prefix: 'donate a ',
      label,
      suffix: ' to the museum',
      linkTo: { to: '/item/$id', id: req.key },
    }
  }
  if (req.type === 'animal') {
    // The key is the species token; the label reads as the animal's name.
    return { prefix: 'keep a ', label: label.toLowerCase(), suffix: '', linkTo: null }
  }
  return { prefix: 'have ', label, suffix: '', linkTo: null }
}

/**
 * How a recipe is learned, as the lead-in of a sentence.
 *
 * Only the lead-in: the source's own id (which shop, which quest) is a link the
 * caller renders, so this hands back the words either side of it rather than a
 * finished string. Wording lives here rather than in JSX for the same reason
 * `gateDisplay` does — a screen that spells its own phrasing is how the next
 * method reaches a player as `chicken_statue`.
 */
export const RECIPE_SOURCE_LABELS: Record<string, { lead: string; standalone: string }> = {
  default: { lead: '', standalone: 'Yours from the start' },
  shop: { lead: 'Sold at ', standalone: 'Sold in a shop' },
  mail: { lead: 'Sent by ', standalone: 'Arrives in the post' },
  quest: { lead: 'Reward for ', standalone: 'A quest reward' },
  festival: { lead: 'A stall at ', standalone: 'A festival stall' },
  wishing_well: { lead: '', standalone: 'From the Wishing Well' },
  chicken_statue: { lead: '', standalone: 'From the Chicken Statue' },
  mines_chest: { lead: 'Treasure chests in ', standalone: 'Treasure chests in the mines' },
  cutscene: { lead: '', standalone: 'Given during the story' },
  skill_level: { lead: '', standalone: 'Appears when you reach the level' },
}

export const recipeSourceLabel = (method: string): { lead: string; standalone: string } =>
  RECIPE_SOURCE_LABELS[method] ?? { lead: '', standalone: methodLabel(method) }

/**
 * A festival stall's `stall_key`, as a name.
 *
 * The key is the game's own token from `festivals.toml [<festival>.stocks]`
 * and must never render raw (rule 8). An unknown key returns null and the
 * caller falls back to the festival alone — "A stall at the Animal Festival"
 * is right where "nora_souvenir_stall" would look broken.
 */
const STALL_LABELS: Record<string, string> = {
  nora_souvenir_stall: 'Nora’s souvenir stall',
}

export const stallLabel = (stallKey: string): string | null => STALL_LABELS[stallKey] ?? null

/**
 * A shipped availability-rule token (`perk:Well Placed`) as a phrase.
 * The build resolves names before shipping, so the part after the colon is
 * already the display name.
 */
export function ruleRequirementPhrase(token: string): string {
  const at = token.indexOf(':')
  if (at === -1) return token
  const type = token.slice(0, at)
  const name = token.slice(at + 1)
  if (type === 'perk') return `the ${name} perk`
  if (type === 'quest') return `finish “${name}”`
  return name
}

/** "needs the Well Placed perk · finish “X”" for a list of rule tokens. */
export const ruleRequirementsPhrase = (tokens: string[]): string =>
  tokens.map(ruleRequirementPhrase).join(' · ')

/** A shipped rule token split open, for screens that can link the named thing. */
export const ruleToken = (token: string): { type: string | null; name: string } => {
  const at = token.indexOf(':')
  return at === -1
    ? { type: null, name: token }
    : { type: token.slice(0, at), name: token.slice(at + 1) }
}

/** A mine biome's depth, as `mines.json` states it. */
export interface MineFloors {
  min: number
  max: number
}

/**
 * A place, as any screen needs to print it.
 *
 * `floors` is `null` for everywhere that is not a mine biome, which is *not
 * applicable* rather than unknown — the surface of the valley has no depth to
 * state. The five that do are the only records in the app whose name alone
 * under-describes them: "The Tide Caverns" says nothing about being floors 21
 * to 39, and that is the fact you need to decide whether to go.
 */
export interface PlaceLabel {
  name: string
  floors: MineFloors | null
}

interface LocationLike {
  id: string
  name: string
}
interface MineLike {
  location_id: string | null
  floors: MineFloors
}

/**
 * `location_id -> { name, floors }`, built once per screen.
 *
 * The join lives here so the range cannot say one thing on the calendar and
 * another on an item page. Mines that name no location are skipped rather than
 * keyed on their own id: a biome with no `location_id` is not a place anything
 * links to.
 *
 * **The parent, `the_mines`, deliberately gets no range.** Deriving 1–99 from
 * its five children would be an inference dressed as a reading — and the
 * shipped ranges skip floors 20, 40, 60, 80 and 100, so the derived answer
 * would also be wrong.
 */
export function placeLabels(
  locations: LocationLike[],
  mines: MineLike[] = [],
): Map<string, PlaceLabel> {
  const floors = new Map<string, MineFloors>()
  for (const mine of mines) {
    if (mine.location_id !== null) floors.set(mine.location_id, mine.floors)
  }
  return new Map(locations.map((l) => [l.id, { name: l.name, floors: floors.get(l.id) ?? null }]))
}

/**
 * The fallback when a place id resolves to nothing.
 *
 * Every call site used to spell `id.replace(/_/g, ' ')` inline, which is the
 * de-underscoring §8 forbids — but here it is the last resort before printing
 * a raw id, and a readable guess beats `the_tide_caverns` on screen.
 */
export const placeLabel = (places: Map<string, PlaceLabel>, id: string): PlaceLabel =>
  places.get(id) ?? { name: id.replace(/_/g, ' '), floors: null }

/** "floors 21–39" — an en-dash, and lowercase, as the Mines screen has always written it. */
export const floorRange = (floors: MineFloors): string => `floors ${floors.min}–${floors.max}`
