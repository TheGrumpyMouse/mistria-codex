/**
 * The HTML for one guide page.
 *
 * **This module owns every angle bracket in the guide.** `pages.ts` describes a
 * page as data — a title, some sections, some rows — and never writes markup,
 * so there is exactly one place escaping can be forgotten and it is here. A
 * builder that returns a string of HTML would move that risk to fourteen call
 * sites; a builder that returns `{ heading, rows }` cannot.
 *
 * Three things these pages deliberately are not:
 *
 * - **Not the app.** No JavaScript, no framework, no fetch. An AI crawler reads
 *   raw HTML and never executes script (measured: ClaudeBot downloaded JS on
 *   23.8% of requests and ran it on none), so anything that needs the runtime
 *   is invisible here. That is the entire reason this directory exists.
 * - **Not prose.** Headings and facts. Every rule in docs/DATA-POLICY.md holds:
 *   no in-game text, no wiki sentences, and no paraphrase of either. "Write a
 *   nice intro paragraph for SEO" is precisely the trap that policy names.
 * - **Not styled by the design system.** The literal colours below are not a
 *   breach of the app's no-hardcoded-hex rule — that rule is about
 *   `tokens.css`, and this file ships no CSS bundle to reference. The palette
 *   is copied deliberately so the guide looks like the app it links into.
 */
import { ATTRIBUTION_TEXT, WIKI_LICENSE, WIKI_NAME } from '@mistria/schema'

/** `&` first, or the escapes escape each other. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * A `<script type="application/ld+json">` body.
 *
 * The escape is not decoration: a JSON string containing `</script>` ends the
 * block early and the rest of the document becomes markup. Escaping `<` to its
 * unicode form is valid JSON, so parsers are unaffected.
 */
const jsonLdBody = (value: unknown): string =>
  JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e')

export interface FactRow {
  label: string
  /** Plain text. Escaped here. */
  value: string
  /** When set, the value renders as a link to another guide page or the wiki. */
  href?: string
}

/**
 * A named thing plus an optional trailing detail — a stock line, a material
 * with its quantity, a tier's blueprint. `href` links the name when the
 * target has a page; `detail` (price, quantity, a requirement) never does,
 * matching the rest of this file's rule that only one thing per row links.
 */
export interface Entry {
  label: string
  href?: string
  detail?: string
}

export type Section =
  | { heading: string; kind: 'facts'; rows: FactRow[] }
  | { heading: string; kind: 'list'; items: string[] }
  | { heading: string; kind: 'links'; links: { href: string; text: string }[] }
  | { heading: string; kind: 'entries'; entries: Entry[] }

export interface PageInput {
  /** The `<h1>` and the base of the `<title>`. */
  name: string
  /** A short kind label — "Fish", "Villager", "Mine biome". Ours, not the game's. */
  kind: string
  /** The meta description. Assembled from facts by `pages.ts`, never written prose. */
  description: string
  /** Absolute. Required — a canonical must never be relative. */
  canonical: string
  /**
   * Absolute site root, with a trailing slash.
   *
   * Separate from `rootHref` because the two are read by different consumers
   * and only one of them tolerates a relative URL: anchors in the document use
   * the relative form (a leading `/` 404s on Pages), while every URL inside the
   * JSON-LD must be absolute — a structured-data `@id` of `../../../` is not a
   * resolvable identity and parsers discard the node.
   */
  siteUrl: string
  /** Relative href back to the app's hash route for this record. */
  appHref: string
  /** Relative href to the guide hub, for the breadcrumb. */
  hubHref: string
  /** Relative href to the site root. */
  rootHref: string
  /** The wiki article this record's facts were verified against, if it has one. */
  sourceUrl: string | null
  /** Absolute URL of the social image, or null when no art has been packed. */
  ogImage: string | null
  sections: Section[]
  /** Fields we know we do not know. Printed, because silence reads as "none". */
  gaps: string[]
  /** JSON-LD `mainEntity` properties. */
  properties: { name: string; value: string }[]
}

/**
 * One stylesheet for ~1,400 pages, inlined into each.
 *
 * Inline rather than a shared file because it is under a kilobyte and a
 * separate request would double the cost of the page for a crawler that reads
 * one and leaves. `prefers-color-scheme` is honoured because these pages are
 * read outside the app, where the app's theme setting does not reach.
 */
const STYLE = `
:root{--paper:#fbf8f3;--surface:#fff;--ink:#2f2a24;--mute:#6b6259;--faint:#948b80;--rule:#e5ded3;--accent:#8a6d3b}
@media(prefers-color-scheme:dark){:root{--paper:#1c1a17;--surface:#242119;--ink:#ece5da;--mute:#a89e91;--faint:#7d7468;--rule:#3a352d;--accent:#c9a869}}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.6 ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;-webkit-text-size-adjust:100%}
.wrap{max-width:44rem;margin:0 auto;padding:1.5rem 1.25rem 3rem}
a{color:var(--accent)}
nav.crumb{font-size:.8125rem;color:var(--faint);margin-bottom:1.25rem}
nav.crumb a{color:var(--mute)}
h1{font-size:1.75rem;line-height:1.2;margin:0 0 .25rem}
p.kind{margin:0 0 1.5rem;color:var(--mute);font-size:.875rem}
h2{font-size:1rem;margin:2rem 0 .5rem;padding-bottom:.35rem;border-bottom:1px solid var(--rule)}
dl{display:grid;grid-template-columns:minmax(7rem,auto) 1fr;gap:.35rem 1rem;margin:0}
dt{color:var(--mute);font-size:.875rem}
dd{margin:0}
ul{margin:.25rem 0;padding-left:1.1rem}
li{margin:.2rem 0}
.cta{display:inline-block;margin:1.5rem 0 .5rem;padding:.6rem 1rem;border-radius:.5rem;background:var(--accent);color:var(--paper);text-decoration:none;font-weight:600}
.gaps{color:var(--mute);font-size:.875rem}
footer{margin-top:3rem;padding-top:1rem;border-top:1px solid var(--rule);font-size:.75rem;color:var(--faint);line-height:1.5}
footer a{color:var(--mute)}
footer p{margin:.5rem 0}
@media(max-width:26rem){dl{grid-template-columns:1fr;gap:0 0}dt{margin-top:.5rem}}
`
  .trim()
  .replace(/\n/g, '')

function renderSection(section: Section): string {
  const heading = `<h2>${escapeHtml(section.heading)}</h2>`

  if (section.kind === 'facts') {
    const rows = section.rows
      .map((row) => {
        const value = escapeHtml(row.value)
        const dd = row.href === undefined ? value : `<a href="${escapeHtml(row.href)}">${value}</a>`
        return `<dt>${escapeHtml(row.label)}</dt><dd>${dd}</dd>`
      })
      .join('')
    return `${heading}<dl>${rows}</dl>`
  }

  if (section.kind === 'list') {
    const items = section.items.map((i) => `<li>${escapeHtml(i)}</li>`).join('')
    return `${heading}<ul>${items}</ul>`
  }

  if (section.kind === 'links') {
    const links = section.links
      .map((l) => `<li><a href="${escapeHtml(l.href)}">${escapeHtml(l.text)}</a></li>`)
      .join('')
    return `${heading}<ul>${links}</ul>`
  }

  const entries = section.entries
    .map((e) => {
      const label =
        e.href === undefined
          ? escapeHtml(e.label)
          : `<a href="${escapeHtml(e.href)}">${escapeHtml(e.label)}</a>`
      const detail = e.detail === undefined || e.detail === '' ? '' : ` — ${escapeHtml(e.detail)}`
      return `<li>${label}${detail}</li>`
    })
    .join('')
  return `${heading}<ul>${entries}</ul>`
}

/**
 * The structured-data block.
 *
 * `Thing` rather than something more specific, on purpose. There is no
 * schema.org type for a video-game item, and `Person` is wrong for a fictional
 * villager — a wrong type is worse than a general one, because it makes claims
 * a parser will act on. `additionalProperty`/`PropertyValue` is the honest
 * encoding for "here are named facts about this", and it is what actually gets
 * read.
 */
function jsonLd(input: PageInput): string {
  const graph: Record<string, unknown>[] = [
    {
      '@type': 'WebPage',
      '@id': input.canonical,
      url: input.canonical,
      name: `${input.name} — ${input.kind}`,
      description: input.description,
      isPartOf: { '@type': 'WebSite', name: 'Mistria Codex', url: input.siteUrl },
      breadcrumb: {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Mistria Codex', item: input.siteUrl },
          { '@type': 'ListItem', position: 2, name: 'Guide', item: `${input.siteUrl}guide/` },
          { '@type': 'ListItem', position: 3, name: input.name },
        ],
      },
      mainEntity: {
        '@type': 'Thing',
        name: input.name,
        description: input.description,
        additionalProperty: input.properties.map((p) => ({
          '@type': 'PropertyValue',
          name: p.name,
          value: p.value,
        })),
        ...(input.sourceUrl === null ? {} : { sameAs: input.sourceUrl }),
      },
      about: {
        '@type': 'VideoGame',
        name: 'Fields of Mistria',
        publisher: { '@type': 'Organization', name: 'NPC Studio' },
      },
    },
  ]

  return jsonLdBody({ '@context': 'https://schema.org', '@graph': graph })
}

export function renderPage(input: PageInput): string {
  const title = `${input.name} · ${input.kind} · Mistria Codex`
  const source =
    input.sourceUrl === null
      ? ''
      : `<p>Facts on this page were verified against the ` +
        `<a href="${escapeHtml(input.sourceUrl)}" rel="nofollow">${escapeHtml(WIKI_NAME)}</a> ` +
        `(${escapeHtml(WIKI_LICENSE)}). No wiki text is reproduced here.</p>`

  const gaps =
    input.gaps.length === 0
      ? ''
      : `<h2>Not recorded</h2><p class="gaps">No source has been read for: ` +
        `${escapeHtml(input.gaps.join(', '))}.</p>`

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(input.description)}">
<link rel="canonical" href="${escapeHtml(input.canonical)}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="Mistria Codex">
<meta property="og:title" content="${escapeHtml(input.name)}">
<meta property="og:description" content="${escapeHtml(input.description)}">
<meta property="og:url" content="${escapeHtml(input.canonical)}">
${input.ogImage === null ? '' : `<meta property="og:image" content="${escapeHtml(input.ogImage)}">\n`}<meta name="twitter:card" content="${input.ogImage === null ? 'summary' : 'summary_large_image'}">
<link rel="icon" href="${escapeHtml(`${input.rootHref}favicon.svg`)}" type="image/svg+xml">
<style>${STYLE}</style>
<script type="application/ld+json">${jsonLd(input)}</script>
</head>
<body>
<div class="wrap">
<nav class="crumb"><a href="${escapeHtml(input.rootHref)}">Mistria Codex</a> › <a href="${escapeHtml(input.hubHref)}">Guide</a> › ${escapeHtml(input.name)}</nav>
<h1>${escapeHtml(input.name)}</h1>
<p class="kind">${escapeHtml(input.kind)}</p>
<a class="cta" href="${escapeHtml(input.appHref)}">Open ${escapeHtml(input.name)} in the Codex →</a>
${input.sections.map(renderSection).join('\n')}
${gaps}
<footer>
${source}
<p>${escapeHtml(ATTRIBUTION_TEXT)}</p>
<p><a href="${escapeHtml(input.rootHref)}">Mistria Codex</a> · <a href="${escapeHtml(input.hubHref)}">All guide pages</a></p>
</footer>
</div>
</body>
</html>
`
}

/**
 * A page for an id that has been renamed.
 *
 * Static hosting has no redirects, so this is the closest honest equivalent: a
 * canonical pointing at the live page plus a meta refresh for humans. It exists
 * because `former_ids[]` is on every record from day one for exactly this
 * reason — a URL that once worked should never start answering "not found".
 *
 * `noindex` so the pair never competes with itself in search.
 */
export function renderRedirect(target: string, canonical: string, name: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(name)} · Mistria Codex</title>
<link rel="canonical" href="${escapeHtml(canonical)}">
<meta name="robots" content="noindex,follow">
<meta http-equiv="refresh" content="0;url=${escapeHtml(target)}">
</head>
<body><p>This page moved to <a href="${escapeHtml(target)}">${escapeHtml(name)}</a>.</p></body>
</html>
`
}
