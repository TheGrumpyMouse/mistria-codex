/**
 * What has to be true about the generated guide.
 *
 * These run against `buildPages()` rather than against the files on disk, so
 * they hold whether or not `pnpm build:seo` has been run in this working copy —
 * and so a failure names the *rule* that broke rather than a missing file.
 *
 * All three are errors. Each one fails silently otherwise, which is the only
 * reason a check is worth its weight:
 *
 * - A **slug collision** means one page quietly overwrote another. The
 *   surviving page looks perfect; the lost record simply is not on the site,
 *   and nothing anywhere says so.
 * - A **published spoiler** routes around the app's own spoiler system by
 *   handing the reveal to Google. The gate that prevents it lives one careless
 *   refactor away from being wrong, and the app veils these deliberately.
 * - A **broken internal link** is path arithmetic gone wrong. Every guide href
 *   is relative and built from a segment count, so an off-by-one produces a
 *   404 on 1,400 pages at once while every page still renders fine locally.
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  type AnimalRecord,
  type BuildingRecord,
  buildPages,
  type CharacterRecord,
  type Dataset,
  type FestivalRecord,
  type ItemRecord,
  type MineRecord,
  type MonsterRecord,
  type PlaceRecord,
  type QuestRecord,
  type RecipeRecord,
  type ShopRecord,
} from '../build/seo/pages.js'
import { renderPage } from '../build/seo/render.js'
import { DATA_DIR } from '../lib/paths.js'
import { error, type Finding } from './report.js'

/** A stable, obviously-fake origin: these checks are about paths, not hosts. */
const TEST_SITE = 'https://example.invalid/base/'

const read = async <T>(file: string): Promise<T[]> => {
  try {
    return JSON.parse(await readFile(join(DATA_DIR, file), 'utf8')) as T[]
  } catch {
    return []
  }
}

/**
 * Resolve a relative href against the directory a page lives in.
 *
 * `URL` does the segment arithmetic properly, including `..` past the root,
 * which is exactly the bug class this is looking for. Returns a path relative
 * to the site root, or null for an off-site or unresolvable link.
 */
function resolveHref(fromSegments: string[], href: string): string | null {
  if (/^[a-z]+:/i.test(href) || href.startsWith('#')) return null
  try {
    const base = new URL(`${TEST_SITE}${fromSegments.join('/')}/`)
    const resolved = new URL(href, base)
    if (!resolved.href.startsWith(TEST_SITE)) return null // climbed above the base
    return resolved.pathname.slice(new URL(TEST_SITE).pathname.length)
  } catch {
    return null
  }
}

/**
 * The checks themselves, over a dataset in memory.
 *
 * Separated from the disk read so the tests can hand it a two-record dataset
 * that *does* collide. A guard nobody has ever seen fail is a guard nobody
 * knows works — every one of these has a test that trips it deliberately.
 */
export function seoFindings(data: Dataset): Finding[] {
  const findings: Finding[] = []
  const { pages } = buildPages(data, { siteUrl: TEST_SITE, ogImage: null })

  // --- slug collisions ---------------------------------------------------
  const byUrl = new Map<string, string>()
  const known = new Set<string>()
  for (const page of pages) {
    const url = page.segments.join('/')
    known.add(`${url}/`)
    const previous = byUrl.get(url)
    if (previous !== undefined) {
      findings.push(
        error(
          'seo:slug-collision',
          `"${previous}" and "${page.source.id}" both map to /${url}/ — one page would ` +
            'silently overwrite the other. Slugs are derived from ids, so two ids that ' +
            'differ only in a character that slugifies away need distinguishing at source.',
          `data/${page.source.dataset}.json`,
        ),
      )
    }
    byUrl.set(url, page.source.id)
  }

  // --- spoilers, which must never reach a public URL ---------------------
  const published = new Set(pages.map((p) => p.source.id))
  for (const [dataset, records] of Object.entries(data)) {
    for (const record of records as { id: string; spoiler?: true; unreleased?: true }[]) {
      if (record.spoiler !== true && record.unreleased !== true) continue
      if (!published.has(record.id)) continue
      findings.push(
        error(
          'seo:spoiler-published',
          `${dataset}/${record.id} is marked ${record.spoiler === true ? 'spoiler' : 'unreleased'} ` +
            'but has a guide page. The app veils this record; publishing it to search ' +
            'hands out the reveal. See the gate in build/seo/pages.ts.',
          `data/${dataset}.json`,
        ),
      )
    }
  }

  // --- internal links must resolve ---------------------------------------
  //
  // Rendering is the only way to see the hrefs, because the depth arithmetic
  // happens during rendering. 1,400 renders is a second or two and it is the
  // only check that would catch an `upTo()` off-by-one.
  for (const page of pages) {
    const html = renderPage(page.input)
    for (const match of html.matchAll(/href="([^"]+)"/g)) {
      const href = match[1]
      if (href === undefined) continue
      const resolved = resolveHref(page.segments, href.replace(/&amp;/g, '&'))
      if (resolved === null) continue
      // Only guide pages are ours to verify. The app root, favicon.svg and the
      // hash routes are the app's, and it is built separately.
      if (!resolved.startsWith('guide/') || resolved === 'guide/') continue
      if (known.has(resolved)) continue
      findings.push(
        error(
          'seo:orphan-link',
          `/${page.segments.join('/')}/ links to /${resolved}, which no guide page owns. ` +
            'Guide hrefs are relative and built from a segment count, so this is almost ' +
            'always path arithmetic rather than a missing record.',
          `data/${page.source.dataset}.json`,
        ),
      )
    }
  }

  return findings
}

export async function checkSeo(): Promise<Finding[]> {
  const data: Dataset = {
    items: await read<ItemRecord>('items.json'),
    characters: await read<CharacterRecord>('characters.json'),
    monsters: await read<MonsterRecord>('monsters.json'),
    animals: await read<AnimalRecord>('animals.json'),
    places: await read<PlaceRecord>('locations.json'),
    mines: await read<MineRecord>('mines.json'),
    quests: await read<QuestRecord>('quests.json'),
    recipes: await read<RecipeRecord>('recipes.json'),
    shops: await read<ShopRecord>('shops.json'),
    buildings: await read<BuildingRecord>('buildings.json'),
    festivals: await read<FestivalRecord>('festivals.json'),
  }

  // Nothing built yet — a clone that has not run `build:data` is not a failure.
  if (data.items.length === 0) return []

  return seoFindings(data)
}
