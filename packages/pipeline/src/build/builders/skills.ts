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
    const perks = skills.perks
      .filter((perk) => perk.skill === skill.id)
      .map((perk) => ({
        id: toSnakeId(perk.name),
        name: perk.name,
        tier: perk.tier,
        level: perk.level,
        essence_cost: perk.cost,
        effect_key: null,
        statue: skill.statue,
      }))

    const gaps = ['xp_curve', 'effect_key']
    if (predates1_0(skills.lastEdited)) gaps.push('predates_1_0')

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
