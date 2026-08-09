/**
 * Field-by-field: where the wiki and the game files describe the same fact,
 * do they say the same thing?
 *
 * `game-agreement.ts` next door asks structural questions — does this id exist,
 * does that wing. This asks the harder one: of the values already shipped, how
 * many were read off a community wiki that the game itself now contradicts.
 * Nearly the whole dataset predates the 1.0 extract, so "the wiki said so" is
 * load-bearing in a few hundred places and nobody had ever counted them.
 *
 * **It reports; it does not fail, and it does not correct.** A disagreement is
 * not automatically a wiki error: the two sources can describe different
 * things (the Inn sells the Lemon Pie at 650 and its recipe scroll at 400, and
 * only one of those is `value.store`), and where they describe the same thing
 * the wiki may simply predate 1.0. Deciding which wins is a per-field
 * judgement someone has to make with the numbers in front of them — so the
 * numbers go in `build/reports/source-agreement.md`, and a field that drifts
 * past a stated tolerance raises a warning naming it.
 *
 * Every comparison is skipped where either side says nothing. "The wiki has no
 * value here" is a gap the coverage report already tracks; this file is only
 * about the overlap.
 *
 * **Where a field is game-first, the comparison reads the wiki's raw source
 * rather than the shipped record.** Otherwise choosing a winner would silence
 * the very drift this file exists to surface: sell value, essence cost and bug
 * rarity now ship the game's number, and comparing that against the game would
 * report a serene 100% while the wiki quietly rotted. The point is to keep
 * knowing how far apart the sources are, not how consistent we are with the
 * one we picked.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { type GameFacts, loadGameFacts, rarityFor } from '../build/game-facts.js'
import { REPORTS_DIR, SOURCES_DIR } from '../lib/paths.js'
import { readJsonFile } from '../lib/read-json.js'
import type { Loaded } from './load.js'
import { type Finding, warn } from './report.js'

/** The wiki tiers we ship, so a cargo cell can be compared with a game grade. */
const RARITY_WORDS = new Set(['common', 'uncommon', 'rare', 'epic', 'legendary'])

/** One raw cargo table, or an empty list on a clone that has not fetched it. */
async function cargo(file: string): Promise<Record<string, unknown>[]> {
  return await readJsonFile<Record<string, unknown>[]>(
    join(SOURCES_DIR, 'wiki', 'cargo', file),
  ).catch(() => [])
}

interface Comparison {
  /** What was compared, in words a reader recognises. */
  field: string
  /** Which two sources — for the report's second column. */
  sources: string
  agree: number
  differ: { id: string; ours: string; game: string }[]
  /**
   * How many disagreements are expected and understood. Above this, the check
   * warns. A tolerance always comes with a reason in `note`.
   */
  tolerance: number
  note: string
  /**
   * Which side the dataset actually ships, so a warning reads as "the wiki is
   * behind" rather than "our data is wrong".
   *
   * Also the precedence declaration. The project's rule is **the more specific
   * source wins; where both are equally specific, the game files win** — so
   * `'wiki'` on a field the game also states is a claim that the wiki is
   * narrower there, and it needs a `note` saying why. The precedence table in
   * the report counts these; see docs/DATA-POLICY.md.
   *
   * Absent where neither side is a straight copy — the record is assembled from
   * both, and there is no single winner to name.
   */
  ships?: 'game' | 'wiki'
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)
const show = (v: unknown): string =>
  Array.isArray(v) ? (v.length === 0 ? '—' : v.join(' ')) : String(v ?? '—')

/** Compare one field across a list of records, skipping anything either side leaves null. */
function compare<T>(
  field: string,
  sources: string,
  records: T[],
  read: (record: T) => { id: string; ours: unknown; game: unknown } | null,
  {
    tolerance = 0,
    note = '',
    ships,
  }: { tolerance?: number; note?: string; ships?: 'game' | 'wiki' } = {},
): Comparison {
  const result: Comparison = {
    field,
    sources,
    agree: 0,
    differ: [],
    tolerance,
    note,
    ...(ships === undefined ? {} : { ships }),
  }
  for (const record of records) {
    const pair = read(record)
    if (pair === null) continue
    if (pair.ours === null || pair.ours === undefined) continue
    if (pair.game === null || pair.game === undefined) continue
    if (same(pair.ours, pair.game)) result.agree += 1
    else result.differ.push({ id: pair.id, ours: show(pair.ours), game: show(pair.game) })
  }
  return result
}

interface ItemRecord {
  id: string
  name: string
  category: string
  sell_value: number | null
  buy_value: number | null
}
interface CropRecord {
  id: string
  growth_days: number | null
  regrow_days: number | null
  seasons: string[]
}
interface CharacterRecord {
  id: string
  birthday: { season: string; day: number } | null
}
interface SetRecord {
  id: string
  wing: string
  item_ids: string[]
}
interface RecipeRecord {
  id: string
  output: { item_id: string | null }
  ingredients: { item_id: string | null; quantity: number }[]
}
interface SkillRecord {
  id: string
  perks: { id: string; name: string; tier: number | null; essence_cost: number | null }[]
}

/** The wiki writes "Well Armed" for the game's "Well-Armed"; fold before matching. */
const fold = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]/g, '')
interface FacetRecord {
  item_id: string
  rarity: string | null
}

/** The game's wing ids against ours: only `insect`/`insects` differs. */
const WING_IDS: Record<string, string> = {
  archaeology: 'archaeology',
  fish: 'fish',
  flora: 'flora',
  insect: 'insects',
}

async function comparisons(loaded: Loaded, game: GameFacts): Promise<Comparison[]> {
  const items = loaded.items.records as unknown as ItemRecord[]
  const out: Comparison[] = []

  // — Item sell value, read from the wiki's own cargo cell rather than from
  //   the record, because the record now ships the game's number. Joined on
  //   display name, which is how the item builder reaches the same row.
  const nameById = new Map(items.map((item) => [item.id, item.name]))
  const wikiSell = new Map<string, number>()
  for (const row of await cargo('Items.json')) {
    const value = Number(row.sellValue)
    if (typeof row.itemName === 'string' && Number.isFinite(value)) {
      wikiSell.set(row.itemName, value)
    }
  }
  out.push(
    compare(
      'Item sell value',
      'wiki Items.sellValue vs value.bin',
      items,
      (item) => {
        // Cosmetics and furniture were never on the wiki's Items table.
        if (item.category === 'cosmetic' || item.category === 'furniture') return null
        const ours = wikiSell.get(nameById.get(item.id) ?? '')
        return {
          id: item.id,
          ours: ours ?? null,
          game: game.itemById.get(item.id)?.sell_value ?? null,
        }
      },
      { ships: 'game' },
    ),
  )

  // — Crops. Growth is the wiki's `growthTime`; the files count the stage
  //   table. Both describe planting to last stage.
  //   A fruit tree is not in `crop.toml` at all — it is a tree with a
  //   `fruit_data` subtable — so the comparison has to look in both places or
  //   it silently compares an apple against nothing.
  const crops = loaded.crops.records as unknown as CropRecord[]
  const grownBy = (id: string): { stages: number; regrow: number | null } | null => {
    const tree = game.fruitTreeByHarvest.get(id)
    if (tree !== undefined) {
      return { stages: tree.tree.day_to_stage.length, regrow: tree.tree.regrow_days }
    }
    const plant = game.cropByHarvest.get(id)
    return plant === undefined
      ? null
      : { stages: plant.day_to_stage.length, regrow: plant.regrow_days }
  }

  out.push(
    compare('Crop growth days', 'wiki Crops.growthTime vs day_to_stage', crops, (crop) => {
      const plant = grownBy(crop.id)
      if (plant === null) return null
      return {
        id: crop.id,
        ours: crop.growth_days,
        game: plant.stages === 0 ? null : plant.stages - 1,
      }
    }),
  )
  out.push(
    compare('Crop regrow days', 'wiki Crops.regrowTime vs regrow_days', crops, (crop) => {
      const plant = grownBy(crop.id)
      if (plant === null) return null
      return { id: crop.id, ours: crop.regrow_days, game: plant.regrow }
    }),
  )

  // — Birthdays. The one field where the game covers a villager the wiki
  //   never printed (Caldarus), so the overlap is 33 of 34.
  const characters = loaded.characters.records as unknown as CharacterRecord[]
  out.push(
    compare('Villager birthday', 'wiki Characters.birth vs npc birthday', characters, (person) => {
      const npc = game.npcById.get(person.id)
      if (npc?.birthday == null || person.birthday === null) return null
      return {
        id: person.id,
        ours: `${person.birthday.season} ${person.birthday.day}`,
        game: `${npc.birthday.season} ${npc.birthday.day}`,
      }
    }),
  )

  // — Museum rosters. Ours come from the wing pages (fish, flora, insects) or
  //   from Cargo (archaeology); the files declare each set outright.
  const sets = loaded.museum_sets.records as unknown as SetRecord[]
  const gameSets = new Map<string, string[]>(
    game.museumSets.map((s) => [`${WING_IDS[s.wing] ?? s.wing}_${s.set}`, s.items]),
  )
  out.push(
    compare('Museum set roster', 'wiki wing pages vs world.json sets', sets, (set) => {
      const theirs = gameSets.get(set.id)
      if (theirs === undefined) return null
      return { id: set.id, ours: [...set.item_ids].sort(), game: [...theirs].sort() }
    }),
  )

  // — Recipes. Ours are game-sourced now, so the meaningful comparison is
  //   ingredient *lists* against the item's own `recipe` array.
  const recipes = loaded.recipes.records as unknown as RecipeRecord[]
  const recipeIngredients = compare(
    'Recipe ingredients',
    'shipped recipe vs item.recipe',
    recipes,
    (recipe) => {
      const outputId = recipe.output.item_id
      if (outputId === null) return null
      const g = game.itemById.get(outputId)
      if (g === undefined || g.recipe.length === 0) return null
      const ours = recipe.ingredients
        .flatMap((i) => (i.item_id === null ? [] : [`${i.item_id}x${i.quantity}`]))
        .sort()
      const theirs = g.recipe.map((c) => `${c.item}x${Math.max(c.count, 1)}`).sort()
      return { id: recipe.id, ours, game: theirs }
    },
    // A collapsed furniture group ships its canonical member's recipe, and a
    // colour variant may want a different dye — those are not disagreements.
    {
      tolerance: 40,
      note: 'furniture colour groups ship one recipe for the group; 37 groups vary by colour',
    },
  )
  out.push(recipeIngredients)

  // — Perk trees. Tier and essence come from the skill menu; the wiki also
  //   lists them, and this is the only place the two were ever compared.
  const skills = loaded.skills.records as unknown as SkillRecord[]
  const perkRows = skills.flatMap((skill) => skill.perks.map((perk) => ({ skill: skill.id, perk })))
  // Essence now ships the menu's number, so the wiki side is read from the
  // page harvest — same reason as sell value above.
  const wikiSkills = await readJsonFile<{ perks: { name: string; cost: number | null }[] }>(
    join(SOURCES_DIR, 'wiki', 'pages', 'skills.json'),
  ).catch(() => ({ perks: [] }))
  const wikiEssence = new Map(
    wikiSkills.perks.flatMap((p) => (p.cost === null ? [] : [[fold(p.name), p.cost] as const])),
  )
  out.push(
    compare(
      'Perk essence cost',
      'wiki Skills page vs skill_menu',
      perkRows,
      ({ skill, perk }) => {
        const tree = game.artifactFacts?.skillTreeBySkill.get(skill) ?? []
        const theirs = tree.find((p) => p.id === perk.id)
        if (theirs === undefined) return null
        return { id: perk.id, ours: wikiEssence.get(fold(perk.name)) ?? null, game: theirs.essence }
      },
      { ships: 'game' },
    ),
  )
  out.push(
    compare('Perk tier', 'wiki Skills page vs skill_menu', perkRows, ({ skill, perk }) => {
      const tree = game.artifactFacts?.skillTreeBySkill.get(skill) ?? []
      const theirs = tree.find((p) => p.id === perk.id)
      if (theirs === undefined) return null
      return { id: perk.id, ours: perk.tier, game: theirs.tier }
    }),
  )

  // — Artifact rarity. Ours is the wiki's column where the files say nothing.
  const artifacts = loaded.artifacts.records as unknown as FacetRecord[]
  out.push(
    compare('Artifact rarity', 'wiki Artifacts.rarity vs artifacts.toml loot', artifacts, (row) => {
      const theirs = game.artifactFacts?.rarityByItem.get(row.item_id) ?? null
      return { id: row.item_id, ours: row.rarity, game: theirs }
    }),
  )

  // — Bug rarity, from the wiki's own cell for the same reason as sell value.
  const bugs = loaded.bugs.records as unknown as FacetRecord[]
  const wikiBugRarity = new Map<string, string>()
  for (const row of await cargo('Bugs.json')) {
    const word = String(row.rarity ?? '').toLowerCase()
    if (typeof row.name === 'string' && RARITY_WORDS.has(word)) wikiBugRarity.set(row.name, word)
  }
  const bugNameById = new Map(items.map((item) => [item.id, item.name]))
  out.push(
    compare(
      'Bug rarity',
      'wiki Bugs.rarity vs bugs.toml',
      bugs,
      (row) => ({
        id: row.item_id,
        ours: wikiBugRarity.get(bugNameById.get(row.item_id) ?? '') ?? null,
        game: rarityFor(game.bugById.get(row.item_id)?.rarity ?? null),
      }),
      // Six bugs the files grade `very_rare`, which maps to `epic` — a step
      // the wiki's scale does not have. A vocabulary gap, not a contested fact.
      {
        tolerance: 6,
        note: 'the files have an `epic` step (`very_rare`) the wiki’s scale lacks',
        ships: 'game',
      },
    ),
  )

  return out
}

function renderReport(rows: Comparison[]): string {
  const lines: string[] = [
    '# Source agreement',
    '',
    '<!-- Generated by `pnpm validate`. Do not edit. -->',
    '',
    'Where the wiki (or a community snapshot) and the game files both state the',
    'same fact, this is how often they say the same thing. A disagreement is not',
    'automatically a wiki error — the two can describe different things, and the',
    'wiki may predate 1.0 — so nothing here is corrected automatically.',
    '',
    '| Field | Compared | Agree | Differ | Sources |',
    '| --- | ---: | ---: | ---: | --- |',
  ]

  for (const row of rows) {
    const total = row.agree + row.differ.length
    const pct = total === 0 ? '—' : `${((row.agree / total) * 100).toFixed(1)}%`
    lines.push(
      `| ${row.field} | ${total} | ${row.agree} (${pct}) | ${row.differ.length} | ${row.sources} |`,
    )
  }

  lines.push(
    '',
    '## Precedence',
    '',
    'Which source each field is read from, on the records where **both** state a',
    'value. The rule is the more specific source wins; where both are equally',
    'specific, the game files win — so a `wiki` row here is a claim that the wiki',
    'is narrower on that field, and it needs a reason. A boolean squeezed out of a',
    'rich source is not a fallback, it is a bug: reducing `Recipes.recipeSource` to',
    '"is this cell non-empty" shipped 163 recipes all claiming "shop".',
    '',
    '| Field | Both state it | Ships |',
    '| --- | ---: | --- |',
  )
  for (const row of rows) {
    const both = row.agree + row.differ.length
    const ships = row.ships === undefined ? 'assembled from both' : `**${row.ships}**`
    lines.push(`| ${row.field} | ${both} | ${ships} |`)
  }

  for (const row of rows.filter((r) => r.differ.length > 0)) {
    lines.push('', `## ${row.field} — ${row.differ.length} differ`, '')
    if (row.note !== '') lines.push(`> ${row.note}`, '')
    lines.push('| Record | Ours | Game files |', '| --- | --- | --- |')
    for (const d of row.differ.slice(0, 40)) {
      lines.push(`| \`${d.id}\` | ${d.ours} | ${d.game} |`)
    }
    if (row.differ.length > 40) lines.push('', `…and ${row.differ.length - 40} more.`)
  }

  return `${lines.join('\n')}\n`
}

export async function checkSourceAgreement(loaded: Loaded): Promise<Finding[]> {
  const game = await loadGameFacts().catch(() => null)
  if (game === null) return []

  const rows = await comparisons(loaded, game)
  await mkdir(REPORTS_DIR, { recursive: true })
  await writeFile(join(REPORTS_DIR, 'source-agreement.md'), renderReport(rows), 'utf8')

  // The precedence rule, as a check rather than a paragraph. A field read from
  // the wiki on records the game also answers is either a deliberate
  // specificity call (a per-shop price beating a global `value.store`) or the
  // bug this whole file exists to surface — and only a stated reason tells the
  // two apart.
  const unexplainedWikiFirst = rows.filter(
    (row) => row.ships === 'wiki' && row.agree + row.differ.length > 0 && row.note === '',
  )

  return [
    ...unexplainedWikiFirst.map((row) =>
      warn(
        'sources:precedence',
        `${row.field} ships the wiki's value on ${row.agree + row.differ.length} record(s) the ` +
          'game files also state, with no reason given. Either the wiki is the more specific ' +
          "source here — say so in the comparison's `note` — or the field should be game-first.",
        join(REPORTS_DIR, 'source-agreement.md'),
      ),
    ),
    ...rows
      .filter((row) => row.differ.length > row.tolerance)
      .map((row) => {
        const shipped =
          row.ships === 'game'
            ? ' — the files win and ship'
            : row.ships === 'wiki'
              ? ' — the page wins and ships'
              : ''
        return warn(
          'sources:disagree',
          `${row.field}: the wiki and the files differ on ${row.differ.length} of ` +
            `${row.agree + row.differ.length}${shipped} (e.g. ${row.differ
              .slice(0, 3)
              .map((d) => `${d.id} wiki ${d.ours}, files ${d.game}`)
              .join('; ')})`,
          join(REPORTS_DIR, 'source-agreement.md'),
        )
      }),
  ]
}
