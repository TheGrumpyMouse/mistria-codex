import {
  type Character,
  type GiftInterest,
  type GiftPrefs,
  SEASONS,
  type Season,
  toSnakeId,
} from '@mistria/schema'
import type { GameNpc } from '../../extract/world.js'
import { decodeEntities, stripWikitext, toBoolean } from '../../normalise/wikitext.js'
import { type BuildContext, name as itemName, text } from '../context.js'

const isSeason = (value: string): value is Season => (SEASONS as readonly string[]).includes(value)

/**
 * One family entry: the display text the wiki wrote, and the character it
 * points at when the wiki itself linked one.
 *
 * Resolution follows the `[[wikilink]]` and nothing else. The link target is
 * the one anchor a wiki editor placed deliberately, so matching it against the
 * pinned roster is as strict as every other join here — no name sniffing, no
 * fuzzy matching. 44 of the 60 entries carry a link and all of them resolve
 * (including the pets: Henrietta and Dozy are roster characters). The other 16
 * are unnamed or lore-only relatives — "Unnamed Aunt", "Baroness Linnet of
 * Mistria", the deceased marked with a dagger — and honestly stay unlinked.
 *
 * The display text goes through the same strip pipeline `toTokens` uses, so
 * what renders is unchanged; only the id next to it is new.
 */
function familyEntries(
  ctx: BuildContext,
  relatives: unknown,
): { relation: string; character_id: string | null }[] {
  const roster = realCharacterNames(ctx)
  const raws =
    relatives === null || relatives === undefined
      ? []
      : Array.isArray(relatives)
        ? relatives.map(String)
        : [String(relatives)]

  const entries: { relation: string; character_id: string | null }[] = []
  for (const raw of raws) {
    for (const piece of decodeEntities(raw).split(/<br\s*\/?>/i)) {
      const relation = stripWikitext(piece)
      if (relation === '' || relation === '-' || relation === 'N/A' || relation === 'Unknown') {
        continue
      }
      const target = /\[\[(?!File:|Image:)([^\]|#]+)/i.exec(piece)?.[1]?.replace(/_/g, ' ').trim()
      entries.push({
        relation,
        character_id: target !== undefined && roster.has(target) ? ctx.idFor(target) : null,
      })
    }
  }
  return entries
}

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

/**
 * The game's record for a villager, matched to a wiki display name.
 *
 * Matched by id first — the game's file stems and our ids agree for 33 of 34 —
 * then by the game's own display name, then by the one curated alias. Never
 * fuzzily: a villager matched to the wrong file would take someone else's
 * birthday, and nothing downstream could tell.
 */
function gameNpcFor(ctx: BuildContext, displayName: string): GameNpc | undefined {
  const game = ctx.game
  if (game === null) return undefined

  const alias = ctx.characterRules.gameNpcIds?.[displayName]
  if (alias !== undefined) return game.npcById.get(alias)

  const byId = game.npcById.get(toSnakeId(displayName))
  if (byId !== undefined) return byId

  return [...game.npcById.values()].find((npc) => npc.name === displayName)
}

export function buildCharacters(ctx: BuildContext): Character[] {
  const real = realCharacterNames(ctx)
  return ctx.characters
    .filter((row) => real.has(itemName(row.charName)))
    .map((row) => {
      const name = itemName(row.charName)
      const id = ctx.idFor(name)
      const npc = gameNpcFor(ctx, name)

      const match = BIRTHDAY.exec(text(row.birth))
      const seasonWord = (match?.[1] ?? '').toLowerCase()
      const fromWiki =
        match && SEASON_WORD[seasonWord]
          ? { season: SEASON_WORD[seasonWord] as Season, day: Number(match[2]) }
          : null

      // The game states all 34 birthdays; the wiki has 33. Caldarus is the one
      // it never printed, and the wiki cannot be blamed for it — he is a
      // late-game hidden character.
      const fromGame =
        npc?.birthday !== undefined && npc.birthday !== null && isSeason(npc.birthday.season)
          ? { season: npc.birthday.season, day: npc.birthday.day }
          : null
      const birthday = fromGame ?? fromWiki

      const gaps: string[] = []
      if (birthday === null) gaps.push('birthday')
      // Schedules are hand-transcribed and land at D4; every character starts
      // with the gap so the coverage report tracks the work rather than the
      // absence looking like "this character doesn't move".
      gaps.push('schedule')
      gaps.push('heart_events')

      // Confirmed only when our id *is* the game's file stem. Matching her
      // through the Priestess alias proves who she is, not that `priestess` is
      // what the game calls her — it is not, and the gap says so until the
      // rename is done properly. See curated/vocab/characters.json.
      const confirmed = npc !== undefined && npc.id === id
      if (npc !== undefined && !confirmed) gaps.push('id_pending_rename')

      return {
        id,
        name,
        numeric_id: null,
        numeric_id_game_version: null,
        id_status: confirmed ? ('confirmed' as const) : ('provisional' as const),
        former_ids: [],
        // The game's name for her, when it is not the wiki's. This is the
        // Priestess: the wiki uses the title because that is what the game
        // calls her until she gives you her name, and the files have said
        // Seridia all along. Both are right, and someone who has met her will
        // search for Seridia — so it goes in the index rather than waiting for
        // the id rename, which is a separate and much larger change.
        also_known_as:
          npc?.name !== undefined && npc.name !== null && npc.name !== name ? [npc.name] : [],
        game_version: confirmed ? (ctx.game?.version ?? null) : null,
        version_added: null,
        confidence: 'wiki',
        prov:
          fromGame === null ? { '*': 'wiki_cargo' } : { '*': 'wiki_cargo', birthday: 'game_files' },
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
        family: familyEntries(ctx, row.relatives),
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
