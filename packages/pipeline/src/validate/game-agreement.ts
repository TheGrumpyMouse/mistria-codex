/**
 * Where the shipped dataset disagrees with the game's own files.
 *
 * This is the check the wiki-only pipeline could never run. Nearly everything in
 * `data/` was read off a community wiki and believed; `sources/game/` is the
 * same facts stated by the thing being described, so the two can be diffed.
 *
 * It reports rather than fails, and the distinction is deliberate. A
 * disagreement is not automatically a bug in `data/`: the game files could be a
 * newer build than the wiki has caught up with, or the two could be describing
 * genuinely different things — the museum's `sets.spring_river` and our
 * `fish_spring_river_fish_set` are the same set with different ids, and only a
 * human should decide that. What the check guarantees is that a disagreement is
 * *visible*, which is the whole reason the extract is committed.
 *
 * Silent when a clone has no `sources/game/`, which is the state the project was
 * in before G1 and still a valid one.
 */
import { join } from 'node:path'
import { loadGameFacts, wordKey } from '../build/game-facts.js'
import { SOURCES_DIR } from '../lib/paths.js'
import type { Loaded } from './load.js'
import { error, type Finding, warn } from './report.js'

interface SetRecord {
  id: string
  wing: string
  item_ids: string[]
}

interface ItemRecord {
  id: string
  name: string
  id_status: string
  category?: string
  availability?: { prov: string; requires: { type: string; key: string }[] }[]
}

/**
 * How the extract's four wing ids are spelled in `data/museum_sets.json`.
 *
 * Three are identical. The fourth is the game's `insect` against our `insects`,
 * which is a plural and not a disagreement — `MUSEUM_WINGS` in the schema has
 * said `insects` since D0 and renaming it would churn every set id for nothing.
 */
const WING_IDS: Record<string, string> = {
  archaeology: 'archaeology',
  fish: 'fish',
  flora: 'flora',
  insect: 'insects',
}

export async function checkGameAgreement(loaded: Loaded): Promise<Finding[]> {
  const game = await loadGameFacts().catch(() => null)
  if (game === null) return []

  const findings: Finding[] = []
  const sets = loaded.museum_sets.records as unknown as SetRecord[]
  const items = loaded.items.records as unknown as ItemRecord[]

  // 1. The museum, by the numbers. 82 sets and 409 items were hand-transcribed
  //    from wing pages long before the game files were available, and the game
  //    declares exactly 82 and 409. That is the headline agreement, and it is
  //    worth asserting rather than admiring once: a curation change that quietly
  //    drops a set would otherwise pass every other check in this directory.
  if (sets.length > 0 && sets.length !== game.museumSets.length) {
    findings.push(
      warn(
        'game:museum-set-count',
        `data/ has ${sets.length} museum sets, the game declares ${game.museumSets.length}`,
        'data/museum_sets.json',
      ),
    )
  }

  const gameItems = new Set(game.museumSets.flatMap((s) => s.items))
  const ourItems = new Set(sets.flatMap((s) => s.item_ids))
  if (ourItems.size > 0) {
    const missing = [...gameItems].filter((id) => !ourItems.has(id)).sort()
    const extra = [...ourItems].filter((id) => !gameItems.has(id)).sort()

    if (missing.length > 0) {
      findings.push(
        warn(
          'game:museum-missing-item',
          `${missing.length} items the game puts in a set are in none of ours: ` +
            missing.slice(0, 8).join(', '),
          'data/museum_sets.json',
        ),
      )
    }
    if (extra.length > 0) {
      findings.push(
        warn(
          'game:museum-extra-item',
          `${extra.length} items are in one of our sets and in none of the game's: ` +
            extra.slice(0, 8).join(', '),
          'data/museum_sets.json',
        ),
      )
    }
  }

  // 2. Wings the game has and we do not, or the reverse. Cheap, and it is the
  //    check that would catch a fifth wing shipping in a patch.
  const gameWings = new Set(game.museumSets.map((s) => WING_IDS[s.wing] ?? s.wing))
  const ourWings = new Set(sets.map((s) => s.wing))
  for (const wing of gameWings) {
    if (ourWings.size > 0 && !ourWings.has(wing)) {
      findings.push(
        warn('game:museum-wing', `the game has a "${wing}" wing and data/ does not`, 'curated/'),
      )
    }
  }

  // 3. An item the game does not name, that is not one of the things the game
  //    deliberately does not model as an item.
  //
  //    Subtracting the animal cosmetics is the whole point. They are 114 of the
  //    139, they will never be in the `ItemId` enum, and a warning that can
  //    never go green is worse than no warning: it teaches everyone to skim
  //    past the ones that can. What is left is 25 real name discrepancies —
  //    "Bag Upgrade" naming two different pouches, "Burdock root Seed" cased
  //    differently, pet cosmetics that live somewhere this does not yet read —
  //    and every one of those is worth a human deciding about.
  const unconfirmed = items.filter(
    (i) => i.id_status === 'provisional' && !game.nonItemNames.has(wordKey(i.name)),
  )
  if (unconfirmed.length > 0) {
    findings.push(
      warn(
        'game:unconfirmed-ids',
        `${unconfirmed.length} item ids are not in the game's ItemId enum and are not ` +
          `known non-items: ${unconfirmed
            .slice(0, 8)
            .map((i) => i.name)
            .join(', ')}`,
        join(SOURCES_DIR, 'game', 'items.json'),
      ),
    )
  }

  // 4. A tree the game sells you a sapling for that has no crop record.
  //
  //    This is the check that would have caught the gap it now guards. Lemon,
  //    Peach and Pear shipped for months as items with an empty availability,
  //    because fruit trees are not in the wiki's Crops table and not in the
  //    game's `crop.toml` either — they are a third file, and the only signal
  //    that anything was missing was three fruits nobody could tell you how to
  //    get. A patch adding an eighth tree fails silently the same way.
  const crops = loaded.crops.records as unknown as { id: string }[]
  const cropIds = new Set(crops.map((c) => c.id))
  const unplanted = [...game.fruitTreeByHarvest.keys()].filter((id) => !cropIds.has(id))
  if (crops.length > 0 && unplanted.length > 0) {
    findings.push(
      warn(
        'game:fruit-tree-missing',
        `${unplanted.length} trees have a sapling item and no crop record: ${unplanted.sort().join(', ')}`,
        'data/crops.json',
      ),
    )
  }

  // 5. Every artifact the game puts in a pool must have somewhere to be found.
  //
  //    An **error**, unlike everything else in this file, because it is not a
  //    disagreement between sources — it is this build regressing on data it
  //    already had. A patch that adds a ninth pool room, or a curation change
  //    that breaks the room alias, would otherwise quietly return 20 artifacts
  //    to "no source recorded".
  if (game.artifactFacts !== null) {
    const byId = new Map(items.map((i) => [i.id, i]))
    const holes = [...game.artifactFacts.poolByItem.keys()]
      .filter((id) => {
        const item = byId.get(id)
        return item?.category === 'artifact' && (item.availability ?? []).length === 0
      })
      .sort()
    if (holes.length > 0) {
      findings.push(
        error(
          'game:artifact-pool-coverage',
          `${holes.length} artifacts are in a game pool and have no availability: ` +
            holes.slice(0, 8).join(', '),
          'data/items.json',
        ),
      )
    }

    // And every perk a window requires must be a perk the skills dataset can
    // explain — a typo here renders as a requirement nobody can look up.
    const perkIds = new Set(
      (loaded.skills.records as unknown as { perks?: { id: string }[] }[]).flatMap((s) =>
        (s.perks ?? []).map((p) => p.id),
      ),
    )
    const badPerks = [
      ...new Set(
        items.flatMap((i) =>
          (i.availability ?? []).flatMap((w) =>
            w.requires.filter((r) => r.type === 'perk' && !perkIds.has(r.key)).map((r) => r.key),
          ),
        ),
      ),
    ].sort()
    if (perkIds.size > 0 && badPerks.length > 0) {
      findings.push(
        error(
          'game:unknown-perk',
          `${badPerks.length} required perks are not in skills.json: ${badPerks.join(', ')}`,
          'data/items.json',
        ),
      )
    }
  }

  // 6. A room the extract spawns bugs in that curated/aliases/game_rooms.json
  //    does not place. Each one is a location the bug map is silently missing.
  if (game.unmappedRooms.length > 0) {
    findings.push(
      warn(
        'game:unmapped-room',
        `${game.unmappedRooms.length} bug-spawning rooms have no location: ` +
          game.unmappedRooms.join(', '),
        'curated/aliases/game_rooms.json',
      ),
    )
  }

  return findings
}
