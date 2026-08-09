/**
 * What we want, before anything is downloaded.
 *
 * The inventory is the join between two things that must never be joined inside
 * `data/`: a record's `icon_key`, which is ours and permanent, and a wiki
 * filename, which is theirs and can be renamed out from under us. Keeping the
 * join here is what lets `assets/` be deleted without leaving a dangling
 * reference anywhere in the dataset.
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { consola } from 'consola'
import { CURATED_DIR, DATA_DIR, SOURCES_DIR } from '../lib/paths.js'
import { collectLinkedWants } from './link-icons.js'
import type { AssetFamily } from './manifest.js'
import { canonicalWikiName, fileRef, localName } from './names.js'

/** One record asking for one sprite. Many wants can name the same file. */
export interface Want {
  family: AssetFamily
  /** The record's `icon_key`, e.g. `misc/abyssal_chest`. */
  iconKey: string
  /** MediaWiki's canonical spelling of the file. */
  sourceFile: string
}

/** One file to fetch, with every record that wants it. */
export interface InventoryEntry {
  key: string
  family: AssetFamily
  file: string
  sourceFile: string
  iconKeys: string[]
}

const readJson = async <T>(path: string): Promise<T> =>
  JSON.parse(await readFile(path, 'utf8')) as T

/**
 * Item sprites, from data we already have committed.
 *
 * `Items.icon` is a wikitext fragment — `[[File:Abyssal chest.png]]` — and the
 * join back to our own ids is on display name, the same fragile seam as
 * everywhere else in this project. It is asserted rather than assumed: an item
 * whose name is not in the cargo table is counted and reported, never guessed at.
 */
export async function collectItemWants(): Promise<Want[]> {
  interface CargoItem {
    itemName: string
    icon: string | null
  }
  interface DataItem {
    name: string
    icon_key: string | null
  }

  const cargo = await readJson<CargoItem[]>(join(SOURCES_DIR, 'wiki', 'cargo', 'items.json'))

  const byName = new Map<string, string>()
  for (const row of cargo) {
    const name = fileRef(row.icon ?? '')
    if (name !== null) byName.set(row.itemName, name)
  }

  // Crops as well as items: a crop record is the growing plant and carries its
  // own `crop/…` key, and 27 of the 58 have no matching item row to inherit from.
  const records = [
    ...(await readJson<DataItem[]>(join(DATA_DIR, 'items.json'))),
    ...(await readJson<DataItem[]>(join(DATA_DIR, 'crops.json'))),
  ]

  const wants: Want[] = []
  let missing = 0
  for (const record of records) {
    if (record.icon_key === null) continue
    const sourceFile = byName.get(record.name)
    if (sourceFile === undefined) {
      missing += 1
      continue
    }
    wants.push({ family: 'item', iconKey: record.icon_key, sourceFile })
  }

  if (missing > 0) consola.info(`assets: ${missing} records have no sprite on the wiki`)
  return wants
}

/**
 * Wardrobe sprites, from the cosmetics-page harvest.
 *
 * Unlike furniture — which no wiki table carries art for — every cosmetics
 * row has a `[[File:…]]`, so these come down the ordinary wiki path with no
 * game install involved. The join is display name, which is also how the
 * cosmetic records got their prices, so a name that resolved there resolves
 * here.
 *
 * **Folded, not exact.** The wiki writes "Beekeeper’s Hat" with a curly
 * apostrophe where the game writes a straight one, and "Swimtrunks" where the
 * game writes "Swim Trunks" — seven wardrobe pieces whose art was on the wiki
 * all along and which an exact join threw away. The skills builder folds names
 * for the same reason ("Well Armed" against "Well-Armed"); punctuation and
 * spacing are not identity.
 */
export async function collectCosmeticWants(): Promise<Want[]> {
  interface Harvested {
    cosmetics: { name: string; icon: string | null }[]
  }
  interface DataItem {
    name: string
    category: string
    icon_key: string | null
  }

  let harvest: Harvested
  try {
    harvest = await readJson<Harvested>(join(SOURCES_DIR, 'wiki', 'pages', 'cosmetics.json'))
  } catch {
    consola.info('assets: no cosmetics harvest yet — run `pnpm enrich:pages`')
    return []
  }

  const byName = new Map(
    harvest.cosmetics.flatMap((row) =>
      row.icon === null ? [] : [[foldName(row.name), row.icon] as const],
    ),
  )
  const records = await readJson<DataItem[]>(join(DATA_DIR, 'items.json'))

  const wants: Want[] = []
  const missed: string[] = []
  for (const record of records) {
    if (record.category !== 'cosmetic' || record.icon_key === null) continue
    const sourceFile = byName.get(foldName(record.name))
    if (sourceFile === undefined) {
      // Counted, never silent. A bare `continue` here is what hid 37 wardrobe
      // pieces: no want, no gap, no number — the join simply produced less and
      // said nothing. Whatever is left after folding is a real wiki gap, and
      // `pnpm assets:game` is what covers it.
      missed.push(record.name)
      continue
    }
    wants.push({ family: 'cosmetic', iconKey: record.icon_key, sourceFile })
  }

  if (missed.length > 0) {
    consola.info(
      `assets: ${missed.length} cosmetics are not on the wiki's pages ` +
        `(e.g. ${missed.slice(0, 3).join(', ')}) — the game install covers these`,
    )
  }
  return wants
}

/**
 * Two names are the same name if they differ only in punctuation or spacing.
 *
 * Curly versus straight apostrophes, and "Swim Trunks" versus "Swimtrunks".
 * Spaces go too, not just collapse, because the disagreement is sometimes about
 * whether a compound is one word.
 */
const foldName = (name: string): string =>
  name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '')

/**
 * Villager icons and portraits, from the character-page harvest.
 *
 * Joined on the wiki page name, which is what `enrich/characters.ts` keys its
 * output by and what `data/characters.json` records as `wiki_page` — a stable
 * join, unlike display name.
 */
export async function collectCharacterWants(): Promise<Want[]> {
  interface Art {
    characters: { character: string; icon: string | null; portrait: string | null }[]
  }
  interface Character {
    wiki_page: string | null
    icon_key: string | null
  }

  let art: Art
  try {
    art = await readJson<Art>(join(SOURCES_DIR, 'wiki', 'pages', 'characters.json'))
  } catch {
    consola.info('assets: no character art yet — run `pnpm enrich:pages`')
    return []
  }

  const byPage = new Map(art.characters.map((c) => [c.character, c]))
  const records = await readJson<Character[]>(join(DATA_DIR, 'characters.json'))
  const wants: Want[] = []

  for (const record of records) {
    if (record.icon_key === null || record.wiki_page === null) continue
    const found = byPage.get(record.wiki_page)
    if (found === undefined) continue

    if (found.icon !== null) {
      wants.push({ family: 'villager', iconKey: record.icon_key, sourceFile: found.icon })
    }
    // The portrait is keyed separately: it is a different image of the same
    // villager, not an alternative to the icon, and only one of the two is ever
    // packed into a sheet.
    if (found.portrait !== null) {
      wants.push({
        family: 'portrait',
        iconKey: record.icon_key.replace(/^character\//, 'portrait/'),
        sourceFile: found.portrait,
      })
    }
  }

  return wants
}

/** Monster sprites, joined on the name the extract and the dataset agree on. */
export async function collectMonsterWants(): Promise<Want[]> {
  interface Extract {
    monsters: { name: string; icon: string | null }[]
  }

  let extract: Extract
  try {
    extract = await readJson<Extract>(join(SOURCES_DIR, 'wiki', 'pages', 'monsters.json'))
  } catch {
    return []
  }

  const byName = new Map(
    extract.monsters.flatMap((m) => (m.icon === null ? [] : [[m.name, m.icon] as const])),
  )
  const records = await readJson<{ name: string; icon_key: string | null }[]>(
    join(DATA_DIR, 'monsters.json'),
  )

  return records.flatMap((record) => {
    const sourceFile = record.icon_key === null ? undefined : byName.get(record.name)
    if (sourceFile === undefined || record.icon_key === null) return []
    return [{ family: 'monster' as const, iconKey: record.icon_key, sourceFile }]
  })
}

/** Festival calendar icons, joined on the festival's own page name. */
export async function collectFestivalWants(): Promise<Want[]> {
  interface Extract {
    festivals: { name: string; icon: string | null }[]
  }

  let extract: Extract
  try {
    extract = await readJson<Extract>(join(SOURCES_DIR, 'wiki', 'pages', 'festivals.json'))
  } catch {
    return []
  }

  const byName = new Map(
    extract.festivals.flatMap((f) => (f.icon === null ? [] : [[f.name, f.icon] as const])),
  )
  const records = await readJson<{ name: string; icon_key: string | null }[]>(
    join(DATA_DIR, 'festivals.json'),
  )

  return records.flatMap((record) => {
    const sourceFile = byName.get(record.name)
    if (sourceFile === undefined || record.icon_key === null) return []
    return [{ family: 'festival' as const, iconKey: record.icon_key, sourceFile }]
  })
}

/**
 * UI glyphs, named by hand.
 *
 * Tesserae, weather, seasons and tool icons are a small fixed set scattered
 * across inline wikitext in a dozen different templates. Naming twenty-five
 * files explicitly is both less code and less likely to be wrong than a scraper
 * that has to recognise every template that might contain one.
 */
export async function collectUiWants(): Promise<Want[]> {
  interface UiAssets {
    glyphs: { key: string; file: string; also?: string[] }[]
  }

  let ui: UiAssets
  try {
    ui = await readJson<UiAssets>(join(CURATED_DIR, 'vocab', 'ui_assets.json'))
  } catch {
    return []
  }

  return ui.glyphs.flatMap((glyph) => {
    const sourceFile = canonicalWikiName(glyph.file)
    if (sourceFile === '') return []
    // `also` aliases the same sprite under other icon_keys — how the quest
    // kinds' `quest/story`-style keys and a villager with no infobox icon get
    // real art without any record changing. The dedup in buildInventory
    // merges every alias onto one fetched asset.
    return [
      { family: 'ui' as const, iconKey: `ui/${glyph.key}`, sourceFile },
      ...(glyph.also ?? []).map((iconKey) => ({ family: 'ui' as const, iconKey, sourceFile })),
    ]
  })
}

/**
 * The world map and the game's logo — hand-named, exactly like the UI glyphs.
 *
 * The map name comes from the committed `Map:` page in `sources/` (the same
 * image the DataMaps extension declares as its background, in the same
 * 5442x3599 space every anchor and shape already uses). The logo is the main
 * page's infobox art. Neither can be harvested from a record, so both are a
 * written-down list; a wiki rename fails the fetch loudly.
 */
export async function collectMapWants(): Promise<Want[]> {
  interface UiAssets {
    maps?: { key: string; file: string }[]
    brand?: { key: string; file: string }[]
  }

  let ui: UiAssets
  try {
    ui = await readJson<UiAssets>(join(CURATED_DIR, 'vocab', 'ui_assets.json'))
  } catch {
    return []
  }

  const wants = (entries: { key: string; file: string }[], family: 'map' | 'brand'): Want[] =>
    entries.flatMap((entry) => {
      const sourceFile = canonicalWikiName(entry.file)
      if (sourceFile === '') return []
      return [{ family, iconKey: `${family}/${entry.key}`, sourceFile }]
    })

  return [...wants(ui.maps ?? [], 'map'), ...wants(ui.brand ?? [], 'brand')]
}

/**
 * Collapse wants into one entry per file.
 *
 * Two things here are the whole point of the function. **Files are deduped on
 * MediaWiki's canonical spelling**, so `acorn.png` and `Acorn.png` are one
 * download rather than two. And **local names are checked for collisions** — two
 * distinct wiki files that kebab-case to the same thing would silently overwrite
 * each other on disk, which is the one failure that would be invisible in a diff
 * and wrong in the app.
 *
 * Ordering is by key throughout, so the manifest is a stable diff.
 */
export function buildInventory(wants: Want[]): InventoryEntry[] {
  const byFile = new Map<string, InventoryEntry>()

  for (const want of wants) {
    // **Canonicalised here and only here.** Every collector used to do it for
    // itself, and the ones that forgot produced `Celine_Portrait.png` and
    // `march icon.png` — names MediaWiki silently normalises on the way back, so
    // the resolved URL came home under a key nothing was looking for and
    // eighteen portraits vanished without a single error. One seam, like
    // `ctx.idFor`, so no caller can get it wrong.
    const sourceFile = canonicalWikiName(want.sourceFile)
    if (sourceFile === '') continue

    const existing = byFile.get(sourceFile)
    if (existing !== undefined) {
      if (!existing.iconKeys.includes(want.iconKey)) existing.iconKeys.push(want.iconKey)
      continue
    }

    const file = localName(sourceFile)
    byFile.set(sourceFile, {
      key: `${want.family}/${file.replace(/\.[a-z0-9]+$/, '')}`,
      family: want.family,
      file: `${want.family}/${file}`,
      sourceFile,
      iconKeys: [want.iconKey],
    })
  }

  const byLocal = new Map<string, string>()
  for (const entry of byFile.values()) {
    const clash = byLocal.get(entry.file)
    if (clash !== undefined && clash !== entry.sourceFile) {
      throw new Error(
        `two wiki files map to assets/game/${entry.file}: "${clash}" and "${entry.sourceFile}". ` +
          'Add a disambiguating rule to localName() rather than letting one overwrite the other.',
      )
    }
    byLocal.set(entry.file, entry.sourceFile)
  }

  const entries = [...byFile.values()]
  for (const entry of entries) entry.iconKeys.sort()
  entries.sort((a, b) => a.key.localeCompare(b.key))
  return entries
}

/**
 * Wiki filenames a person has verified the wiki gets wrong.
 *
 * Applied to the collected wants, before dedupe, so the correction lands in one
 * place and everything downstream — the local name, the manifest's
 * `source_file`, the gap report — records the file that actually exists rather
 * than the one the cargo row claims. See `curated/aliases/asset_files.json` for
 * why this is a curated file and not a rule in the fetcher.
 */
async function applyCorrections(wants: Want[]): Promise<Want[]> {
  interface Corrections {
    corrections: { wrong: string; right: string }[]
  }

  let file: Corrections
  try {
    file = await readJson<Corrections>(join(CURATED_DIR, 'aliases', 'asset_files.json'))
  } catch {
    return wants
  }

  const byWrong = new Map(
    file.corrections.map((c) => [canonicalWikiName(c.wrong), canonicalWikiName(c.right)] as const),
  )
  let applied = 0
  const corrected = wants.map((want) => {
    const right = byWrong.get(canonicalWikiName(want.sourceFile))
    if (right === undefined) return want
    applied += 1
    return { ...want, sourceFile: right }
  })

  if (applied > 0) consola.info(`assets: ${applied} want(s) use a corrected wiki filename`)
  return corrected
}

/** Everything we want, from every source. */
export async function collectInventory(): Promise<InventoryEntry[]> {
  const linked = await collectLinkedWants()
  if (linked.unmatched.length > 0) {
    consola.info(
      `assets: ${linked.unmatched.length} records have no unambiguous linked icon ` +
        '(they keep their drawn glyph)',
    )
  }

  const wants = [
    ...(await collectItemWants()),
    ...(await collectCosmeticWants()),
    ...(await collectCharacterWants()),
    ...(await collectMonsterWants()),
    ...(await collectFestivalWants()),
    ...linked.wants,
    ...(await collectUiWants()),
    ...(await collectMapWants()),
  ]
  return buildInventory(await applyCorrections(wants))
}
