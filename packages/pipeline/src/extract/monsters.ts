/**
 * Monster combat stats and loot, read from `fiddle/monsters/`.
 *
 * One file per family, one table per variant, and the numbers the wiki never
 * records — `hp`, `damage`, `essence`, `coin_count` — stated plainly on every
 * variant. Drops are even better than the wiki's: exact internal ids (the
 * `cosmetic` entries name `player_assets` keys directly, which dissolves the
 * "Rockclod Hat" name-resolution problem), percent chances, and count ranges.
 *
 * Two structural notes:
 *
 * **`[default]` is a real fallback, not a placeholder.** The Mimic states no
 * `hp` of its own and inherits 1000 from its file's default table; the Rock
 * Stack's default says 144 and the variant overrides it to 150. Reading
 * variants without the fallback would ship the Mimic with no health at all.
 *
 * **`super_drops` is a second, real loot list.** Only the Rock Stack has one —
 * the guaranteed diamonds for destroying it fully (`obj_monster_rock_stack.gml`
 * rolls it separately). Folding it into `drops` would state a 100% diamond
 * chance on an ordinary kill.
 */
import { join } from 'node:path'
import {
  defaults,
  entries,
  field,
  num,
  range,
  readToml,
  resolveIn,
  str,
  table,
  tomlFiles,
} from './toml.js'

export interface GameMonsterDrop {
  /** Which table the id lives in: `item` ids are ItemId enum members, `cosmetic` ids are `player_assets` keys. */
  kind: 'item' | 'cosmetic'
  id: string
  /** Percent, as the file writes it: 70 means 70%. */
  chance: number | null
  count_range: [number, number] | null
}

export interface GameMonsterVariant {
  /** The variant's own table key — `rockclod_blue`, not a display name. */
  key: string
  /** Declaring file, relative to `fiddle/monsters/` — the family. */
  file: string
  hp: number | null
  damage: number | null
  essence: number | null
  coin_count: [number, number] | null
  drops: GameMonsterDrop[]
  super_drops: GameMonsterDrop[]
}

export interface GameMonstersExtract {
  gameVersion: string
  files: string[]
  variants: GameMonsterVariant[]
}

function readDrops(value: unknown): GameMonsterDrop[] {
  if (!Array.isArray(value)) return []
  const out: GameMonsterDrop[] = []
  for (const raw of value) {
    const entry = table(raw)
    if (entry === null) continue
    const item = str(entry.item)
    const cosmetic = str(entry.cosmetic)
    if (item === null && cosmetic === null) continue
    out.push({
      kind: item !== null ? 'item' : 'cosmetic',
      id: item ?? (cosmetic as string),
      chance: num(entry.chance),
      count_range: range(entry.count_range),
    })
  }
  return out
}

export async function extractMonsters(
  root: string,
  gameVersion: string,
): Promise<GameMonstersExtract> {
  const files = await tomlFiles(root, join('fiddle', 'monsters'))
  if (files.length === 0) {
    throw new Error(
      'fiddle/monsters/ holds no TOML files. Refusing to write an empty monster extract ' +
        'over a good one — check MISTRIA_GAME_DIR points at the unpacked assets folder.',
    )
  }

  const variants: GameMonsterVariant[] = []
  for (const file of files) {
    const doc = await readToml(resolveIn(root, 'fiddle', 'monsters', file))
    const base = defaults(doc)
    for (const [key, entry] of entries(doc)) {
      const get = (k: string): unknown => field(entry, base, k)
      variants.push({
        key,
        file,
        hp: num(get('hp')),
        damage: num(get('damage')),
        essence: num(get('essence')),
        coin_count: range(get('coin_count')),
        drops: readDrops(get('drops')),
        super_drops: readDrops(get('super_drops')),
      })
    }
  }

  variants.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
  return { gameVersion, files, variants }
}
