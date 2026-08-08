import { DATASETS, type DatasetName } from '@mistria/schema'
import type { Loaded } from './load.js'
import { error, type Finding, warn } from './report.js'

/**
 * Which dataset each reference-shaped key points at.
 *
 * Keys are matched by name anywhere in a record, at any depth. That is
 * deliberately generic: a new reference added to a schema is caught by the
 * unknown-key warning below rather than being silently unchecked, so this table
 * stays complete without anyone remembering to update it.
 */
const REF_TARGETS: Readonly<Record<string, DatasetName>> = {
  item_id: 'items',
  base_item_id: 'items',
  produce_item_id: 'items',
  seed_item_id: 'items',
  yields_seed_item_id: 'items',
  currency_item_id: 'items',
  treat_item_id: 'items',
  item_ids: 'items',
  feed_item_ids: 'items',
  ore_item_ids: 'items',
  fish_item_ids: 'items',

  character_id: 'characters',
  giver_character_id: 'characters',
  owner_character_id: 'characters',
  staff_character_ids: 'characters',
  schedule_id: 'schedules',

  location_id: 'locations',
  home_location_id: 'locations',
  // Only locations nest, so a parent is always a location.
  parent_id: 'locations',
  locations: 'locations',
  connections: 'locations',
  map_id: 'maps',
  spot_ids: 'spots',

  set_id: 'museum_sets',
  artifact_set_ids: 'museum_sets',

  biome_id: 'mines',
  biome_ids: 'mines',
  monster_ids: 'monsters',

  shop_id: 'shops',
  vendor_shop_id: 'shops',
  sold_by: 'shops',

  used_in_recipe_ids: 'recipes',
}

/**
 * Reference-shaped keys we deliberately do not check, each with a reason.
 * Listed explicitly so "unchecked" is always a decision, never an oversight.
 */
const REF_EXEMPT: Readonly<Record<string, string>> = {
  id: 'the record’s own key',
  // Not a reference at all — a version-stamped scalar that nothing may point at.
  numeric_id: 'a game-internal number, deliberately not a foreign key',
  // A recipe unlock points at a shop, quest or festival depending on `method`,
  // so it has no single target. Resolved at D3 when those datasets land.
  source_id: 'polymorphic target, resolved at D3',
  // A quest objective's target depends on its `type`: an item to deliver, a
  // monster to defeat, a character to talk to. Only `deliver` is populated
  // today, and every one of those is checked as an item by the build before it
  // is written — a name that isn't in Items never becomes an objective.
  target_id: 'polymorphic target, keyed by the objective’s type',
  // A former id is by definition no longer in the dataset — that is the point of it.
  former_ids: 'historical ids, intentionally unresolvable',
  // Reward and source lists mix item ids with recipe and furniture ids; the
  // build resolves them once those categories land.
  rewards: 'mixed target types, resolved at D3',
  seed_sources: 'mixed target types, resolved at D3',
}

const looksLikeRef = (key: string): boolean => /(^|_)ids?$/.test(key)

interface Ref {
  key: string
  target: DatasetName
  id: string
  at: string
}

function collectRefs(value: unknown, at: string, out: Ref[], unknownKeys: Set<string>): void {
  if (Array.isArray(value)) {
    for (const [i, v] of value.entries()) collectRefs(v, `${at}[${i}]`, out, unknownKeys)
    return
  }
  if (value === null || typeof value !== 'object') return

  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const target = REF_TARGETS[key]

    if (target !== undefined) {
      const ids = Array.isArray(child) ? child : [child]
      for (const id of ids) {
        if (typeof id === 'string') out.push({ key, target, id, at: `${at}.${key}` })
      }
      continue
    }

    if (looksLikeRef(key) && REF_EXEMPT[key] === undefined) unknownKeys.add(key)

    collectRefs(child, `${at}.${key}`, out, unknownKeys)
  }
}

/**
 * Every id referenced anywhere must resolve to a real record.
 *
 * References into a dataset that has not been ingested yet are skipped rather
 * than reported — before D3 half the targets are legitimately empty, and
 * flooding the output with those would hide the failures that matter. The
 * coverage report is what tracks the emptiness.
 */
export function checkReferentialIntegrity(loaded: Loaded): Finding[] {
  const findings: Finding[] = []
  const unknownKeys = new Set<string>()

  const idsByDataset = {} as Record<DatasetName, Set<string>>
  for (const name of Object.keys(DATASETS) as DatasetName[]) {
    const keyField = DATASETS[name].key
    const ids = new Set<string>()
    for (const record of loaded[name].records) {
      const value = (record as Record<string, unknown>)[keyField]
      if (typeof value === 'string') ids.add(value)
    }
    idsByDataset[name] = ids
  }

  for (const name of Object.keys(DATASETS) as DatasetName[]) {
    const ds = loaded[name]
    const refs: Ref[] = []
    for (const [i, record] of ds.records.entries()) {
      collectRefs(record, `[${i}]`, refs, unknownKeys)
    }

    for (const ref of refs) {
      // A dataset with no records yet cannot resolve anything; that is a
      // coverage gap, not a broken reference.
      if (idsByDataset[ref.target].size === 0) continue
      if (idsByDataset[ref.target].has(ref.id)) continue

      findings.push(
        error(
          'refint',
          `${ref.at} -> ${ref.target}: no record with id "${ref.id}"`,
          `data/${ds.file}`,
        ),
      )
    }
  }

  for (const key of unknownKeys) {
    findings.push(
      warn(
        'refint:unregistered',
        `"${key}" looks like a reference but has no target in REF_TARGETS. ` +
          'Add it there, or add it to REF_EXEMPT with a reason.',
      ),
    )
  }

  return findings
}

/** Duplicate keys silently make joins and lookups wrong, so they are errors. */
export function checkDuplicateKeys(loaded: Loaded): Finding[] {
  const findings: Finding[] = []

  for (const name of Object.keys(DATASETS) as DatasetName[]) {
    const spec = DATASETS[name]
    const seen = new Set<string>()

    for (const record of loaded[name].records) {
      const value = (record as Record<string, unknown>)[spec.key]
      if (typeof value !== 'string') continue
      if (seen.has(value)) {
        findings.push(
          error('duplicate-key', `duplicate ${spec.key} "${value}"`, `data/${spec.file}`),
        )
      }
      seen.add(value)
    }
  }

  return findings
}

/** Records nothing references. Worth knowing about, never a failure. */
export function checkOrphans(loaded: Loaded): Finding[] {
  const referenced = new Set<string>()
  const unknownKeys = new Set<string>()

  for (const name of Object.keys(DATASETS) as DatasetName[]) {
    const refs: Ref[] = []
    for (const [i, r] of loaded[name].records.entries()) {
      collectRefs(r, `[${i}]`, refs, unknownKeys)
    }
    for (const ref of refs) referenced.add(`${ref.target}:${ref.id}`)
  }

  const findings: Finding[] = []
  /**
   * Records that exist to be pointed at, so being unreferenced means something
   * is missing. Items and characters are browsed directly and are normally
   * unreferenced, which is why they are not here.
   *
   * **Spots are not here either, and that is the point.** A spot points outward
   * — at the location that holds it — and nothing in the dataset points back at
   * it by id; the map reads them by `location_id`. Listing them produced 23
   * warnings that no amount of work could ever clear, which is the fastest way
   * to teach everyone to skim past the warnings that matter.
   */
  const orphanCheckable: DatasetName[] = ['museum_sets', 'maps', 'mines', 'monsters']

  for (const name of orphanCheckable) {
    const spec = DATASETS[name]
    for (const record of loaded[name].records) {
      const id = (record as Record<string, unknown>)[spec.key]
      if (typeof id !== 'string') continue
      if (!referenced.has(`${name}:${id}`)) {
        findings.push(warn('orphan', `nothing references "${id}"`, `data/${spec.file}`))
      }
    }
  }

  return findings
}
