import { type Skill, toSnakeId } from '@mistria/schema'
import type { BuildContext } from '../context.js'
import { predates1_0 } from '../freshness.js'

/**
 * Build the nine skills and their perk trees.
 *
 * This is what turns `requires` from decoration into a working gate. A window
 * carrying `{type: "perk", key: "stoneturner", op: "has"}` means nothing until
 * `stoneturner` is a real id somebody can tick off, and the Today view's
 * `locked | unlocked | unknown` tagging hangs off exactly that.
 *
 * Two fields stay null on purpose:
 *
 * - **`xp_curve`** — the wiki has the level cap and nothing else. A curve is 60
 *   numbers, and 60 plausible numbers are indistinguishable from 60 real ones.
 * - **`effect_key`** — the wiki has a sentence per perk, which is in-game text
 *   we do not copy. A symbolic key needs the game files.
 */
export function buildSkills(ctx: BuildContext): Skill[] {
  const { skills } = ctx

  return skills.skills.map((skill) => {
    const perks: Skill['perks'] = skills.perks
      .filter((perk) => perk.skill === skill.id)
      .map((perk) => {
        const id = toSnakeId(perk.name)
        return {
          id,
          name: perk.name,
          tier: perk.tier,
          level: perk.level,
          essence_cost: perk.cost,
          effect_key: null,
          // Hand-written in curated/vocab/perk_effects.json, and only for the
          // perks that gate finding something. Null is the normal state — an
          // effect sentence for all 137 would be a wiki, and the game's own
          // wording is prose this project never copies.
          effect: ctx.perkEffects[id] ?? null,
          statue: skill.statue,
        }
      })

    const gaps = ['xp_curve', 'effect_key']
    if (predates1_0(skills.lastEdited)) gaps.push('predates_1_0')

    // The game-union pass: perks the skill menu states and the wiki page does
    // not list yet — the seven 1.0 additions, until the wiki catches up.
    // Matched by NAME, not id: wiki perk ids are slugs of the display name
    // ("Welcome Home II" -> welcome_home_ii) while the game spells its own
    // ("welcome_home_two"), so an id match would duplicate half the tree.
    // Names are folded to letters and digits before comparing — the wiki
    // writes "Well Armed" where the game writes "Well-Armed", and a hyphen
    // must not conjure a second perk. Appended perks carry the game's id —
    // the real internal name — with the tier and essence cost the menu
    // states; only the unlock level is the wiki's alone and stays a gap.
    const fold = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]/g, '')
    const tree = ctx.game?.artifactFacts?.skillTreeBySkill.get(skill.id) ?? []
    const perkName = ctx.game?.artifactFacts?.perkNameById
    const wikiNames = new Set(perks.map((p) => fold(p.name)))
    let appended = 0
    for (const gamePerk of tree) {
      const name = perkName?.get(gamePerk.id)
      if (name === undefined || wikiNames.has(fold(name))) continue
      perks.push({
        id: gamePerk.id,
        name,
        tier: gamePerk.tier,
        level: null,
        essence_cost: gamePerk.essence,
        effect_key: null,
        effect: ctx.perkEffects[gamePerk.id] ?? null,
        statue: skill.statue,
      })
      appended += 1
    }
    if (appended > 0) gaps.push('perk_levels')

    // Eight skills have five tiers; Ranching has four. That is a hole in the
    // wiki rather than a design decision, so it is recorded as one — otherwise
    // the app would show a complete-looking Ranching tree that stops at 45.
    const tiers = new Set(perks.map((p) => p.tier)).size
    if (tiers < 5) gaps.push('tier_5')

    return {
      id: skill.id,
      name: skill.name,
      numeric_id: null,
      numeric_id_game_version: null,
      id_status: 'provisional' as const,
      former_ids: [],
      also_known_as: [],
      game_version: skills.wikiVersionStamp,
      version_added: null,
      confidence: 'wiki' as const,
      prov: { '*': 'wiki_page' as const },
      data_gaps: gaps,
      icon_key: `skill/${skill.id}`,
      wiki_page: 'Skills',
      blurb: null,

      max_level: skills.maxLevel,
      xp_curve: null,
      perks,
    }
  })
}
