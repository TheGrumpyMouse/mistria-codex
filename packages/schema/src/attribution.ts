/**
 * The attribution statement, in one place, because three things say it.
 *
 * It appears in the app's footer on every route, in the About page, in
 * `assets/game/manifest.json` and `ATTRIBUTION.md` as the register's own
 * header, and — since the guide — on roughly 1,400 generated static pages.
 * It lived in two of those places as two identical literals
 * (`apps/web/src/components/Footer.tsx` and `pipeline/src/assets/manifest.ts`)
 * and the pipeline cannot import from `apps/web`, so a third consumer meant
 * either a third copy or this file.
 *
 * It is here rather than in the app or the pipeline because it is the one
 * string both sides must agree on exactly, which is what this package is for.
 * The wording is fixed and is not ours to improve — see docs/DATA-POLICY.md.
 */

export const ATTRIBUTION_TEXT =
  'This is an unofficial fan-made companion app. All game assets, sprites, UI ' +
  'graphics, and character designs are the sole property of NPC Studio. We do ' +
  'not claim ownership of these assets. Full credit goes to the creators at NPC ' +
  'Studio.'

export const OFFICIAL_SITE = 'https://fieldsofmistria.com'
export const STEAM_PAGE = 'https://store.steampowered.com/app/2142790'

/**
 * The wiki we verify facts against, and the licence its text carries.
 *
 * CC BY-SA covers the wiki's prose, which we never redistribute — but we do
 * take facts from it, and crediting the source on every page that used it is
 * both the decent thing and the "companion, not competitor" posture stated in
 * the guide plan. `WIKI_ARTICLE` builds the link from a record's `wiki_page`.
 */
export const WIKI_SITE = 'https://fieldsofmistria.wiki.gg'
export const WIKI_NAME = 'Fields of Mistria Wiki'
export const WIKI_LICENSE = 'CC BY-SA 4.0'

/** `Copper_Ore` -> the article URL. Null in, null out — most records have one. */
export const wikiArticle = (page: string | null): string | null =>
  page === null || page === '' ? null : `${WIKI_SITE}/wiki/${encodeURIComponent(page)}`
