/**
 * The files that tell a crawler what exists.
 *
 * One of these three does real work today and the other two are groundwork, so
 * it is worth being precise about which is which rather than shipping all three
 * with the same confidence.
 *
 * **`sitemap.xml` works.** Sitemaps are scoped to the directory they are served
 * from, so one at `/<repo>/sitemap.xml` may list every URL under `/<repo>/` and
 * can be submitted directly in Search Console. This is the only one of the three
 * that changes anything while the site lives on `github.io`.
 *
 * **`robots.txt` does nothing here, and that is not a bug in this file.**
 * Crawlers read robots.txt only at the *domain* root — `user.github.io/robots.txt`
 * — which belongs to the user-page repository, not this one. A file at
 * `/<repo>/robots.txt` is fetched by nobody. It is emitted anyway because it
 * costs nothing and becomes correct the moment a custom domain is attached, but
 * nothing in the guide's design depends on it.
 *
 * **`llms.txt` is speculative and is not load-bearing.** Google's June 2026
 * documentation states Search ignores it; Ahrefs measured 97% of valid
 * llms.txt files receiving zero bot requests in a month; no major provider has
 * committed to reading one. It is twenty lines, so it ships as a free option.
 * If it is ever the answer to "why is the guide not being cited", it is the
 * wrong answer — the guide works because it is static HTML, not because of this.
 */
import { WIKI_LICENSE, WIKI_NAME, WIKI_SITE } from '@mistria/schema'

/** XML text nodes. `&` first, as ever. */
const xmlEscape = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/**
 * The sitemap.
 *
 * **No `lastmod`, deliberately.** The only timestamp available is `meta.builtAt`,
 * which moves on every deploy even when no data changed — and a lastmod that is
 * always "now" is worse than none, because Google learns to discount the field
 * entirely. Better to say nothing than to say something untrue every push.
 *
 * No `priority` or `changefreq` either: both have been ignored for years.
 */
export function renderSitemap(urls: string[]): string {
  const entries = urls.map((url) => `  <url><loc>${xmlEscape(url)}</loc></url>`).join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries}
</urlset>
`
}

/**
 * Named so the intent is on the record, even where the file is not read.
 *
 * The AI crawlers are listed with an explicit `Allow`. They are allowed by
 * default — a missing robots.txt permits everything — so this is documentation
 * of a decision rather than a mechanism: this project *wants* to be readable by
 * them, and a future maintainer should have to delete a line to change that
 * rather than merely fail to add one.
 */
export function renderRobots(sitemapUrl: string): string {
  return `# Mistria Codex — an unofficial Fields of Mistria companion.
#
# NOTE: on a GitHub Pages *project* site this file is at /<repo>/robots.txt,
# which crawlers do not read — only the domain root counts. It is here so the
# intent is recorded, and so it is already correct if a custom domain is added.

User-agent: *
Allow: /

# The app itself is a client-rendered PWA and none of these execute JavaScript,
# so the static guide is the only part of this site they can read. That is what
# it is for.
User-agent: GPTBot
Allow: /

User-agent: OAI-SearchBot
Allow: /

User-agent: ClaudeBot
Allow: /

User-agent: PerplexityBot
Allow: /

User-agent: CCBot
Allow: /

User-agent: Google-Extended
Allow: /

# Settings and search are stateful UI, not content.
Disallow: /*#/settings
Disallow: /*#/search

Sitemap: ${sitemapUrl}
`
}

export function renderLlmsTxt(siteUrl: string, guideUrl: string, counts: string): string {
  return `# Mistria Codex

> An unofficial, offline-first companion app for the farming game Fields of
> Mistria. It answers "what can I find today, and where" from a structured
> dataset of ${counts}.

This project publishes facts — seasons, weather, locations, floor ranges, sell
values, museum sets, drop rates — and deliberately publishes no game text. In-game
descriptions and flavour text are never reproduced or paraphrased. Fields of
Mistria is the property of NPC Studio; this project is unaffiliated.

## Reading this site

- ${guideUrl} — static HTML fact pages, one per record. No JavaScript required.
- ${siteUrl} — the interactive app. Client-rendered; a crawler that does not
  execute JavaScript will see an empty document, which is why the guide exists.

## Sources

Facts are verified against the ${WIKI_NAME} (${WIKI_SITE}, ${WIKI_LICENSE}) and,
where available, the game's own data files. Where the two disagree, the
disagreement is reported rather than silently resolved.
`
}
