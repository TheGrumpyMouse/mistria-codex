import type { Character, GiftInterest, GiftPrefs, Season } from '@mistria/schema'
import { toBoolean, toTokens } from '../../normalise/wikitext.js'
import { type BuildContext, name as itemName, text } from '../context.js'

/** The wiki writes a birthday as "Winter 18". */
const BIRTHDAY = /^(Spring|Summer|Fall|Autumn|Winter)\s+(\d{1,2})$/i
const SEASON_WORD: Record<string, Season> = {
  spring: 'spring',
  summer: 'summer',
  fall: 'fall',
  autumn: 'fall',
  winter: 'winter',
}

/**
 * Which Characters rows are real villagers.
 *
 * The table is 56 rows for 34 villagers — the rest are wiki editors' user pages
 * using the same infobox template, complete with birthdays and occupations.
 * See curated/vocab/characters.json for why gift preferences are the signal.
 */
export function realCharacterNames(ctx: BuildContext): Set<string> {
  return new Set(ctx.characterRules.roster)
}

/**
 * Report drift between the pinned roster and the wiki.
 *
 * The roster is pinned because the cast of a released game is fixed, but a patch
 * could genuinely add someone. Anything the wiki gifts to that the roster omits
 * is surfaced rather than silently dropped — that is the difference between a
 * deliberate list and a stale one.
 */
export function rosterDrift(ctx: BuildContext): { missing: string[]; absent: string[] } {
  const roster = new Set(ctx.characterRules.roster)
  const gifted = new Set(ctx.giftPrefs.map((r) => text(r.charName)))
  const inTable = new Set(ctx.characters.map((r) => itemName(r.charName)))

  return {
    // Gift-receiving characters the roster does not list — a possible new villager.
    missing: [...gifted].filter((n) => !roster.has(n)).sort(),
    // Roster names the Characters table no longer has — a rename or a removal.
    absent: [...roster].filter((n) => !inTable.has(n)).sort(),
  }
}

export function buildCharacters(ctx: BuildContext): Character[] {
  const real = realCharacterNames(ctx)
  return ctx.characters
    .filter((row) => real.has(itemName(row.charName)))
    .map((row) => {
      const name = itemName(row.charName)
      const id = ctx.idFor(name)

      const match = BIRTHDAY.exec(text(row.birth))
      const seasonWord = (match?.[1] ?? '').toLowerCase()
      const birthday =
        match && SEASON_WORD[seasonWord]
          ? { season: SEASON_WORD[seasonWord] as Season, day: Number(match[2]) }
          : null

      const gaps: string[] = []
      if (birthday === null) gaps.push('birthday')
      // Schedules are hand-transcribed and land at D4; every character starts
      // with the gap so the coverage report tracks the work rather than the
      // absence looking like "this character doesn't move".
      gaps.push('schedule')
      gaps.push('heart_events')

      return {
        id,
        name,
        numeric_id: null,
        numeric_id_game_version: null,
        id_status: 'provisional',
        former_ids: [],
        game_version: null,
        version_added: null,
        confidence: 'wiki',
        prov: { '*': 'wiki_cargo' },
        data_gaps: gaps,
        icon_key: `character/${id}`,
        wiki_page: name.replace(/ /g, '_'),
        blurb: null,

        birthday,
        romanceable: toBoolean(row.romanceable),
        species: text(row.species) || null,
        gender: text(row.gender) || null,
        occupation: text(row.occupation) || null,
        affiliation: text(row.affiliation) || null,

        home_location_id: null,
        // Relatives are free text like "Eiland (Brother)". Parsing them into
        // character refs is D3 work; keeping the relation label without a
        // resolved id is honest and still useful.
        family: toTokens(row.relatives).map((entry) => ({
          relation: entry,
          character_id: null,
        })),
        heart_events: [],
        is_vendor: false,
        shop_id: null,
        schedule_id: null,
      }
    })
}

const INTERESTS: Record<string, GiftInterest> = {
  love: 'loved',
  loved: 'loved',
  like: 'liked',
  liked: 'liked',
  neutral: 'neutral',
  dislike: 'disliked',
  disliked: 'disliked',
  hate: 'hated',
  hated: 'hated',
}

/**
 * Collapse 5,328 flat gift rows into one record per character.
 *
 * The flat shape is fine for a database and terrible for a client: it would mean
 * shipping 5,328 objects to render one villager's page. Grouped, the whole file
 * is a few tens of KB.
 *
 * Rows naming an item that doesn't exist are dropped rather than kept as a
 * dangling id — the app would render a broken link, and referential integrity
 * would fail the build anyway.
 */
export function buildGiftPrefs(ctx: BuildContext): GiftPrefs[] {
  const byCharacter = new Map<string, Record<GiftInterest, string[]>>()
  const knownCharacters = new Set([...realCharacterNames(ctx)].map((n) => ctx.idFor(n)))

  for (const row of ctx.giftPrefs) {
    const characterId = ctx.idFor(text(row.charName))
    if (!knownCharacters.has(characterId)) continue

    const itemName = text(row.itemName)
    if (!ctx.itemByName.has(itemName)) continue

    const interest = INTERESTS[text(row.interest).toLowerCase()]
    if (interest === undefined) continue

    const prefs =
      byCharacter.get(characterId) ??
      ({ loved: [], liked: [], neutral: [], disliked: [], hated: [] } as Record<
        GiftInterest,
        string[]
      >)
    const itemId = ctx.idFor(itemName)
    if (!prefs[interest].includes(itemId)) prefs[interest].push(itemId)
    byCharacter.set(characterId, prefs)
  }

  return [...byCharacter]
    .map(([character_id, prefs]) => ({ character_id, prefs }))
    .sort((a, b) => a.character_id.localeCompare(b.character_id))
}
