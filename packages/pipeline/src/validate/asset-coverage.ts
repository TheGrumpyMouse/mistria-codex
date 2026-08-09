import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ASSETS_MANIFEST, REPORTS_DIR } from '../lib/paths.js'
import type { Loaded } from './load.js'
import { type Finding, warn } from './report.js'

/**
 * Which records have art, and which art no record uses.
 *
 * **This exists because `build/asset-gaps.json` was never a coverage report and
 * was being read as one.** That file is written by the wiki fetcher and only
 * ever holds names that (a) entered the fetch inventory and (b) came back
 * missing from MediaWiki — a record of the wiki contradicting itself. When 48
 * item records were found drawing a hashed glyph instead of a sprite, exactly
 * one of them was in it. The other 47 had never been *wanted* by any collector,
 * so nothing anywhere could report them: a record whose display name never
 * joined is silently absent, not visibly missing.
 *
 * The check runs the other way round — from `data/` outwards. Every record that
 * declares an `icon_key` is resolved against the manifest, so a gap is
 * impossible to open without it appearing here. It also counts the reverse,
 * because art we fetch, pack, ship and never draw is a cost paid for nothing:
 * every unused key is bytes in an atlas sheet that a phone downloads.
 *
 * A warning, never an error. A clone that has never run `pnpm assets:fetch` has
 * no art at all and must still validate — the glyph fallback is a designed
 * state, not a broken one.
 */

/** Datasets whose records never render their own icon, so a miss means nothing. */
const NOT_DRAWN = new Set([
  // A recipe is drawn as its output item, never as itself; all 866 icon_keys
  // are `recipe/<id>` and no `recipe/*` art exists or is wanted.
  'recipes',
])

interface Uncovered {
  dataset: string
  id: string
  name: string
  category: string | null
  iconKey: string
}

export interface AssetCoverage {
  /** False when there is no manifest — a fresh clone, not a failure. */
  haveManifest: boolean
  covered: number
  uncovered: Uncovered[]
  /** Manifest keys no record in `data/` points at. */
  unusedKeys: string[]
  /** Keys skipped because their dataset never draws them. */
  notDrawn: number
}

interface RecordLike {
  id?: unknown
  name?: unknown
  category?: unknown
  icon_key?: unknown
}

export async function computeAssetCoverage(loaded: Loaded): Promise<AssetCoverage> {
  let manifestKeys: Set<string>
  try {
    const manifest = JSON.parse(await readFile(ASSETS_MANIFEST, 'utf8')) as {
      assets?: { icon_keys?: string[] }[]
    }
    manifestKeys = new Set((manifest.assets ?? []).flatMap((a) => a.icon_keys ?? []))
  } catch {
    return { haveManifest: false, covered: 0, uncovered: [], unusedKeys: [], notDrawn: 0 }
  }

  const covered: string[] = []
  const uncovered: Uncovered[] = []
  const used = new Set<string>()
  let notDrawn = 0

  for (const dataset of Object.values(loaded)) {
    for (const raw of dataset.records) {
      const record = raw as RecordLike
      const iconKey = record.icon_key
      if (typeof iconKey !== 'string' || iconKey === '') continue

      if (NOT_DRAWN.has(dataset.name)) {
        notDrawn += 1
        continue
      }

      if (manifestKeys.has(iconKey)) {
        covered.push(iconKey)
        used.add(iconKey)
        continue
      }
      uncovered.push({
        dataset: dataset.name,
        id: typeof record.id === 'string' ? record.id : '?',
        name: typeof record.name === 'string' ? record.name : '?',
        category: typeof record.category === 'string' ? record.category : null,
        iconKey,
      })
    }
  }

  return {
    haveManifest: true,
    covered: covered.length,
    uncovered,
    unusedKeys: [...manifestKeys].filter((key) => !used.has(key)).sort(),
    notDrawn,
  }
}

/**
 * One warning per dataset, not per record.
 *
 * Thirty-seven missing cosmetics are one fact about the wardrobe, not
 * thirty-seven facts. The names go in the report; the console gets the count
 * and where to look.
 */
export function assetCoverageFindings(coverage: AssetCoverage): Finding[] {
  if (!coverage.haveManifest || coverage.uncovered.length === 0) return []

  const byDataset = new Map<string, Uncovered[]>()
  for (const entry of coverage.uncovered) {
    byDataset.set(entry.dataset, [...(byDataset.get(entry.dataset) ?? []), entry])
  }

  return [...byDataset].map(([dataset, entries]) =>
    warn(
      'assets:uncovered',
      `${entries.length} ${dataset} records have an icon_key with no art and draw a glyph ` +
        `(e.g. ${entries
          .slice(0, 3)
          .map((e) => e.iconKey)
          .join(', ')}). See build/reports/asset-coverage.md.`,
      `data/${dataset}.json`,
    ),
  )
}

/**
 * Families that belong to no record and never will.
 *
 * `LOOSE_FAMILIES` in assets/manifest.ts — served as individual files rather
 * than packed into a sheet. A portrait is reached by `Atlas.portrait()`
 * rewriting a character key; the map and the wordmark are code literals. All
 * 30 would otherwise sit at the top of this list every run, which is how a
 * report trains people to stop reading it.
 */
const CODE_REACHED = new Set(['portrait', 'map', 'brand'])

/** Group by the icon_key's prefix — the family a reader thinks in. */
function byPrefix(keys: string[]): Map<string, string[]> {
  const groups = new Map<string, string[]>()
  for (const key of keys) {
    const prefix = key.split('/')[0] ?? '?'
    groups.set(prefix, [...(groups.get(prefix) ?? []), key])
  }
  return new Map([...groups].sort((a, b) => b[1].length - a[1].length))
}

export async function writeAssetCoverageReport(coverage: AssetCoverage): Promise<void> {
  const lines: string[] = [
    '# Asset coverage',
    '',
    '_Generated by `pnpm validate`. Do not edit._',
    '',
  ]

  if (!coverage.haveManifest) {
    lines.push(
      'No `assets/game/manifest.json`. Every record draws its glyph, which is the',
      'designed state for a clone that has not run `pnpm assets:fetch`.',
      '',
    )
    await mkdir(REPORTS_DIR, { recursive: true })
    await writeFile(join(REPORTS_DIR, 'asset-coverage.md'), `${lines.join('\n')}\n`, 'utf8')
    return
  }

  const total = coverage.covered + coverage.uncovered.length
  const percent = total === 0 ? 0 : Math.round((coverage.covered / total) * 1000) / 10

  lines.push(
    `**${coverage.covered} of ${total}** records that declare an \`icon_key\` have art (${percent}%).`,
    '',
    `${coverage.notDrawn} more were skipped: their dataset never draws its own icon.`,
    '',
  )

  lines.push('## Records with no art', '')
  if (coverage.uncovered.length === 0) {
    lines.push('None. Every record that declares an icon_key resolves to a sprite.', '')
  } else {
    lines.push(
      'These draw a hashed glyph. That is a supported, permanent fallback — but a',
      'gap here is usually a join that silently missed, not art that does not exist.',
      '',
      '| dataset | category | id | name | icon_key |',
      '| --- | --- | --- | --- | --- |',
    )
    for (const entry of [...coverage.uncovered].sort((a, b) =>
      `${a.dataset}${a.iconKey}`.localeCompare(`${b.dataset}${b.iconKey}`),
    )) {
      lines.push(
        `| ${entry.dataset} | ${entry.category ?? '—'} | \`${entry.id}\` | ${entry.name} | \`${entry.iconKey}\` |`,
      )
    }
    lines.push('')
  }

  const chrome = coverage.unusedKeys.filter((key) => CODE_REACHED.has(key.split('/')[0] ?? ''))
  const orphaned = coverage.unusedKeys.filter((key) => !CODE_REACHED.has(key.split('/')[0] ?? ''))

  lines.push(
    '## Art no record points at',
    '',
    `${orphaned.length} keys, excluding the ${chrome.length} in \`portrait/\`, \`map/\` and`,
    '`brand/`, which belong to no record by design and are only ever asked for by a',
    'code literal.',
    '',
    'A key here is not necessarily unused — the app draws some of these by literal',
    'too (`ui/tesserae`, `ui/fish_shadow_*`). It is the list to check a new screen',
    'against: the art may already be packed and shipping.',
    '',
  )
  for (const [prefix, keys] of byPrefix(orphaned)) {
    lines.push(`- **${prefix}/** — ${keys.length}: ${keys.join(', ')}`)
  }
  lines.push('')

  await mkdir(REPORTS_DIR, { recursive: true })
  await writeFile(join(REPORTS_DIR, 'asset-coverage.md'), `${lines.join('\n')}\n`, 'utf8')
}
