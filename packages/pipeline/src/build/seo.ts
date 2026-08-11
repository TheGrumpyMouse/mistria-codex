/**
 * Generate the static guide: a crawlable surface for a client-rendered app.
 *
 * The app is hash-routed, which means every screen in it is the same URL as far
 * as a search engine is concerned — `#/item/ore_copper` is a fragment, and
 * fragments are stripped before indexing. On top of that, no major AI crawler
 * executes JavaScript, so `<div id="root"></div>` is the entire document they
 * see. Those two facts together made a 3,000-record dataset worth exactly one
 * search result and zero citations.
 *
 * This builder is the answer: ~1,400 plain HTML pages, no JavaScript, one per
 * record worth reading, generated from the same `data/` the app loads.
 *
 * **Everything lands in one directory, on purpose.** `apps/web/public/guide/`
 * holds the whole surface, and removing it removes the feature completely — the
 * same instinct as the `assets/game/` rule in docs/DATA-POLICY.md. The tree is
 * deleted and rewritten on every run, so a renamed record cannot leave a stale
 * page behind, which also means nothing hand-written may ever live there.
 *
 * **The trap this had to avoid.** `apps/web/vite.config.ts` precaches
 * `**\/*.html`, and Workbox precaching is all-or-nothing: left alone, 1,400 new
 * HTML files would enter the service worker's install manifest and one 404
 * among them would stop the worker installing at all. The guide is excluded
 * there by `globIgnores`, and it is deliberately *not* offline-capable — it is
 * a crawler and cold-visitor surface, and the app is the offline one.
 */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { argv, env } from 'node:process'
import { pathToFileURL } from 'node:url'
import type { Meta } from '@mistria/schema'
import { consola } from 'consola'
import { DATA_DIR, GUIDE_DIR, WEB_PUBLIC_DIR } from '../lib/paths.js'
import {
  type AnimalRecord,
  buildPages,
  type CharacterRecord,
  type Dataset,
  type GuidePage,
  type ItemRecord,
  type MineRecord,
  type MonsterRecord,
  type PlaceRecord,
  type QuestRecord,
  type RecipeRecord,
  type UrlContext,
} from './seo/pages.js'
import { escapeHtml, renderPage, renderRedirect } from './seo/render.js'
import { renderLlmsTxt, renderRobots, renderSitemap } from './seo/sitemap.js'

/**
 * Where the site is actually served from.
 *
 * Canonicals and `og:url` must be absolute, and `meta.basePath` only carries
 * the path half. Passed in by the deploy workflow the same way `BASE_PATH` is,
 * so a fork or a rename needs no code change — and defaulted so a local build
 * produces something coherent rather than throwing.
 */
const SITE_URL = `${(env.MISTRIA_SITE_URL ?? 'https://thegrumpymouse.github.io/mistria-codex/').replace(/\/+$/, '')}/`

const readDataset = async <T>(file: string): Promise<T[]> => {
  try {
    return JSON.parse(await readFile(join(DATA_DIR, file), 'utf8')) as T[]
  } catch {
    // Same posture as `buildIndexFile`: a clone that has not run `build:data`
    // gets an empty guide, not a failed build.
    return []
  }
}

async function loadDataset(): Promise<Dataset> {
  return {
    items: await readDataset<ItemRecord>('items.json'),
    characters: await readDataset<CharacterRecord>('characters.json'),
    monsters: await readDataset<MonsterRecord>('monsters.json'),
    animals: await readDataset<AnimalRecord>('animals.json'),
    places: await readDataset<PlaceRecord>('locations.json'),
    mines: await readDataset<MineRecord>('mines.json'),
    quests: await readDataset<QuestRecord>('quests.json'),
    // Recipes get no page of their own — a recipe's id is its output item's id,
    // so a page for it would be a second URL about one subject. They render as
    // two blocks on the item's page, which is also where a crawler looking for
    // "how do I get the Lemon Pie recipe" should land.
    recipes: await readDataset<RecipeRecord>('recipes.json'),
    // Names only, for a recipe source that points at one.
    shops: await readDataset<{ id: string; name: string }>('shops.json'),
    festivals: await readDataset<{ id: string; name: string }>('festivals.json'),
  }
}

/**
 * The hub, and the only page a crawler needs to reach every other one.
 *
 * A sitemap tells Google what exists; it does not give an AI crawler following
 * links anywhere to start. Grouped by kind and plainly listed — 1,400 anchors
 * is a large page but it is one request, and it is the difference between a
 * crawlable tree and 1,400 orphans.
 */
function renderHub(pages: GuidePage[], siteUrl: string, ogImage: string | null): string {
  const groups = new Map<string, GuidePage[]>()
  for (const page of pages) {
    const kind = page.input.kind
    const bucket = groups.get(kind)
    if (bucket === undefined) groups.set(kind, [page])
    else bucket.push(page)
  }

  const sections = [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([kind, list]) => {
      const links = [...list]
        .sort((a, b) => a.input.name.localeCompare(b.input.name))
        .map(
          (p) =>
            `<li><a href="${escapeHtml(`../${p.segments.slice(1).join('/')}/`)}">${escapeHtml(p.input.name)}</a></li>`,
        )
        .join('')
      return `<h2>${escapeHtml(kind)} <span class="count">${list.length}</span></h2><ul class="grid">${links}</ul>`
    })
    .join('\n')

  const description =
    `Every record in the Mistria Codex as a plain page: ${pages.length} items, ` +
    'villagers, monsters, locations and quests from Fields of Mistria.'

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Guide · Mistria Codex</title>
<meta name="description" content="${escapeHtml(description)}">
<link rel="canonical" href="${escapeHtml(`${siteUrl}guide/`)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Mistria Codex">
<meta property="og:title" content="Mistria Codex Guide">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:url" content="${escapeHtml(`${siteUrl}guide/`)}">
${ogImage === null ? '' : `<meta property="og:image" content="${escapeHtml(ogImage)}">\n`}<link rel="icon" href="../favicon.svg" type="image/svg+xml">
<style>
:root{--paper:#fbf8f3;--surface:#fff;--ink:#2f2a24;--mute:#6b6259;--faint:#948b80;--rule:#e5ded3;--accent:#8a6d3b}
@media(prefers-color-scheme:dark){:root{--paper:#1c1a17;--ink:#ece5da;--mute:#a89e91;--faint:#7d7468;--rule:#3a352d;--accent:#c9a869}}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.6 ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
.wrap{max-width:60rem;margin:0 auto;padding:1.5rem 1.25rem 3rem}
a{color:var(--accent)}
h1{font-size:1.75rem;margin:0 0 .25rem}
p.lede{color:var(--mute);margin:0 0 1.5rem}
h2{font-size:1rem;margin:2rem 0 .5rem;padding-bottom:.35rem;border-bottom:1px solid var(--rule)}
.count{color:var(--faint);font-weight:400;font-size:.8125rem}
ul.grid{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(12rem,1fr));gap:.15rem 1rem;font-size:.9375rem}
.cta{display:inline-block;margin:.5rem 0 1rem;padding:.6rem 1rem;border-radius:.5rem;background:var(--accent);color:var(--paper);text-decoration:none;font-weight:600}
footer{margin-top:3rem;padding-top:1rem;border-top:1px solid var(--rule);font-size:.75rem;color:var(--faint)}
</style>
</head>
<body>
<div class="wrap">
<h1>Mistria Codex — guide</h1>
<p class="lede">${escapeHtml(description)}</p>
<a class="cta" href="../">Open the interactive Codex →</a>
${sections}
<footer><p><a href="../">Mistria Codex</a> — an unofficial fan project. Fields of Mistria is the property of NPC Studio.</p></footer>
</div>
</body>
</html>
`
}

export interface SeoResult {
  pages: number
  redirects: number
  skipped: { excludedCategory: number; thin: number; spoiler: number; unreleased: number }
}

export async function buildSeo(meta: Meta): Promise<SeoResult> {
  const data = await loadDataset()

  // Only when art has actually been packed. A clone with no `assets/game/`
  // ships pages with no social image rather than pages pointing at a 404 —
  // the same degrade-don't-break posture as the favicon in index.html.
  const ogImage = meta.assets === null ? null : `${SITE_URL}assets/game/brand/app-icon-512.png`

  const ctx: UrlContext = { siteUrl: SITE_URL, ogImage }
  const { pages, skipped } = buildPages(data, ctx)

  // A slug is derived, so two ids can in principle land on one URL. Nothing in
  // the data does today, but "nothing does today" is exactly the assumption
  // that rots — a collision would silently overwrite one record with another.
  const seen = new Map<string, string>()
  for (const page of pages) {
    const url = page.segments.join('/')
    const previous = seen.get(url)
    if (previous !== undefined) {
      throw new Error(
        `guide slug collision: "${previous}" and "${page.source.id}" both map to ${url}. ` +
          'Slugs are derived from ids; two ids differing only by a character that slugifies ' +
          'away need distinguishing at the source.',
      )
    }
    seen.set(url, page.source.id)
  }

  await rm(GUIDE_DIR, { recursive: true, force: true })

  let redirects = 0
  for (const page of pages) {
    const file = join(WEB_PUBLIC_DIR, ...page.segments, 'index.html')
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, renderPage(page.input), 'utf8')

    // `former_ids[]` exists on every record from day one so a rename does not
    // orphan saved progress. It does the same job for URLs: static hosting has
    // no redirects, so an old slug gets a canonical plus a meta refresh.
    for (const alias of page.aliases) {
      const url = alias.join('/')
      if (seen.has(url)) continue // a live page already owns it
      const aliasFile = join(WEB_PUBLIC_DIR, ...alias, 'index.html')
      await mkdir(dirname(aliasFile), { recursive: true })
      const target = `../../${page.segments.slice(1).join('/')}/`
      await writeFile(
        aliasFile,
        renderRedirect(target, page.input.canonical, page.input.name),
        'utf8',
      )
      redirects += 1
    }
  }

  await mkdir(GUIDE_DIR, { recursive: true })
  await writeFile(join(GUIDE_DIR, 'index.html'), renderHub(pages, SITE_URL, ogImage), 'utf8')

  // The app root and the hub first, then every page — roughly the order a
  // crawler should care about them in.
  const urls = [SITE_URL, `${SITE_URL}guide/`, ...pages.map((p) => p.input.canonical)]
  await writeFile(join(WEB_PUBLIC_DIR, 'sitemap.xml'), renderSitemap(urls), 'utf8')
  await writeFile(
    join(WEB_PUBLIC_DIR, 'robots.txt'),
    renderRobots(`${SITE_URL}sitemap.xml`),
    'utf8',
  )

  const counts = Object.entries(meta.counts)
    .filter(([name]) => ['items', 'fish', 'bugs', 'characters', 'quests'].includes(name))
    .map(([name, n]) => `${n} ${name}`)
    .join(', ')
  await writeFile(
    join(WEB_PUBLIC_DIR, 'llms.txt'),
    renderLlmsTxt(SITE_URL, `${SITE_URL}guide/`, counts),
    'utf8',
  )

  return { pages: pages.length, redirects, skipped }
}

async function main(): Promise<void> {
  const metaPath = join(WEB_PUBLIC_DIR, 'data', 'meta.json')
  let meta: Meta
  try {
    meta = JSON.parse(await readFile(metaPath, 'utf8')) as Meta
  } catch {
    consola.error('No shipped meta.json — run `pnpm build:ship` first.')
    process.exitCode = 1
    return
  }

  const result = await buildSeo(meta)
  consola.success(
    `Guide: ${result.pages} pages + ${result.redirects} moved-id stubs -> ${GUIDE_DIR}`,
  )
  consola.info(
    `Skipped ${result.skipped.excludedCategory} furniture/cosmetic, ${result.skipped.thin} thin, ` +
      `${result.skipped.spoiler} spoiler, ${result.skipped.unreleased} unreleased.`,
  )
}

const entry = argv[1]
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  main().catch((err: unknown) => {
    consola.error(err)
    process.exitCode = 1
  })
}
