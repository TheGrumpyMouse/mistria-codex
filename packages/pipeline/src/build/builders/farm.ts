import type { Animal, Building, Pet, RanchingRules, Requirement, Season } from '@mistria/schema'
import { consola } from 'consola'
import type { GameAnimal, GameStable } from '../../extract/ranching.js'
import type { AnimalInputs, BuildContext, BuildingInputs } from '../context.js'

/**
 * Build the ranch: animals, the buildings that house them, the pets, and the
 * rulebook they all share.
 *
 * The animals were hand-authored from the wiki's prose for four milestones —
 * per-sex produce is carried by English grammar there, which no parser reads
 * safely. `fiddle/ranching/` states all of it structurally, so the game is
 * primary for everything it states and the curated file survives for what it
 * does not: the feed chains (the game states only `kind = "seed"|"hay"`),
 * mammal gestation (stated nowhere in the files — the wiki's 4 days stands),
 * the selling shop, and the wiki page names. Where both state a fact the two
 * are compared and a disagreement is reported, never silently resolved.
 *
 * Product ids are **internal ids** (`egg`, `cow_milk`), which for this game
 * are almost always our record ids too — each is still checked against the
 * built item set, and a miss is counted, because "almost always" is how half
 * a dataset ends up pointing at names the other half abandoned.
 */

const ALL_SEASONS: Season[] = ['spring', 'summer', 'fall', 'winter']
const SEASONS = new Set<string>(ALL_SEASONS)

/** Resolve display names to item ids, reporting the ones that don't exist. */
function itemIds(
  ctx: BuildContext,
  names: string[],
  owner: string,
): { ids: string[]; missing: string[] } {
  const ids: string[] = []
  const missing: string[] = []
  for (const name of names) {
    if (ctx.itemByName.has(name)) ids.push(ctx.idFor(name))
    else {
      missing.push(name)
      ctx.resolver.recordUnresolved(name, 'curated_item', owner)
    }
  }
  return { ids, missing }
}

export function buildAnimals(
  ctx: BuildContext,
  builtItemIds?: Set<string>,
  shippedQuestIds?: Set<string>,
): Animal[] {
  const input: AnimalInputs = ctx.animals
  const game = ctx.game?.ranching ?? null
  const gameById = new Map<string, GameAnimal>(game?.animals.map((a) => [a.id, a] as const) ?? [])

  // The first tier where a golden product can roll at all — the number a
  // player plans around. Stated in ranching/misc.toml, not hardcoded: 8 today,
  // and a rebalance shows up here instead of shipping stale.
  const goldenFrom =
    game?.misc.production_tiers.find(
      (tier) => tier.golden.count > 0 || tier.golden.additional_chance > 0,
    )?.hearts_required ?? null

  let unresolvedGameIds = 0
  const disagreements: string[] = []
  const resolveGameItem = (id: string | null, owner: string, gaps: string[]): string | null => {
    if (id === null) return null
    // Internal ids, never display names: membership in the built item set is
    // the check, and idFor() must not see them.
    if (builtItemIds === undefined || builtItemIds.has(id)) return id
    ctx.resolver.recordUnresolved(id, 'curated_item', owner)
    unresolvedGameIds += 1
    gaps.push('products')
    return null
  }

  const built = input.animals.map((animal): Animal => {
    const gaps: string[] = []
    const owner = `animal:${animal.id}`
    const facts = gameById.get(animal.id) ?? null
    const feed = itemIds(ctx, input.feed[animal.building], owner)
    if (feed.missing.length > 0) gaps.push('feed')

    // ── Products ──────────────────────────────────────────────────────────
    let products: Animal['products']
    if (facts !== null) {
      products = []
      const male = facts.production.male
      const female = facts.production.female
      const sexes =
        male.normal_product === female.normal_product &&
        male.golden_product === female.golden_product &&
        male.days_to_produce === female.days_to_produce
          ? ([['both', female]] as const)
          : ([
              ['female', female],
              ['male', male],
            ] as const)
      for (const [sex, side] of sexes) {
        const sexValue = sex === 'both' ? null : sex
        const normal = resolveGameItem(side.normal_product, owner, gaps)
        if (normal !== null) {
          products.push({
            item_id: normal,
            sex: sexValue,
            days_to_produce: side.days_to_produce,
            hearts_required: null,
            quality: null,
          })
        }
        const golden = resolveGameItem(side.golden_product, owner, gaps)
        if (golden !== null) {
          products.push({
            item_id: golden,
            sex: sexValue,
            days_to_produce: side.days_to_produce,
            hearts_required: goldenFrom,
            quality: 'golden',
          })
        }
      }
    } else {
      const base = itemIds(ctx, animal.products, owner)
      const golden = itemIds(ctx, animal.goldenProducts, owner)
      if (base.missing.length > 0 || golden.missing.length > 0) gaps.push('products')
      products = [
        ...base.ids.map((id) => ({
          item_id: id,
          sex: null,
          days_to_produce: null,
          hearts_required: null,
          quality: null,
        })),
        ...golden.ids.map((id) => ({
          item_id: id,
          sex: null,
          days_to_produce: null,
          hearts_required: 8,
          quality: 'golden' as const,
        })),
      ]
    }

    // ── Breeding ──────────────────────────────────────────────────────────
    const curatedTreat = itemIds(ctx, [animal.treat], owner).ids[0] ?? null
    const gameTreat = facts === null ? null : resolveGameItem(facts.breeding.treat, owner, gaps)
    if (gameTreat !== null && curatedTreat !== null && gameTreat !== curatedTreat) {
      disagreements.push(`${animal.id}: treat ${curatedTreat} (curated) vs ${gameTreat} (game)`)
    }
    const usesEgg = facts?.breeding.uses_egg ?? null
    const breeding = {
      treat_item_id: gameTreat ?? curatedTreat,
      // The game states no mammal gestation anywhere; the wiki's 4 days is the
      // only source, and egg layers incubate instead — not-applicable there.
      gestation_days: usesEgg === true ? null : input.gestationDays,
      uses_egg: usesEgg,
      incubation_days: usesEgg === true ? (facts?.breeding.incubation_days ?? null) : null,
    }

    // ── Purchase ──────────────────────────────────────────────────────────
    if (
      facts !== null &&
      facts.pricing.buy_price !== null &&
      facts.pricing.buy_price !== animal.price
    ) {
      disagreements.push(
        `${animal.id}: price ${animal.price} (curated) vs ${facts.pricing.buy_price} (game)`,
      )
    }
    const requires: Requirement[] = []
    if (facts?.requirements.repaired_haydens_farm === true) {
      const questId = ctx.game?.questByFlag.get('repaired_haydens_farm')
      if (
        questId !== undefined &&
        (shippedQuestIds === undefined || shippedQuestIds.has(questId))
      ) {
        requires.push({ type: 'quest', key: questId, op: 'done', value: null })
      } else {
        // The gate is real; pointing it at nothing would fail refint and
        // guessing the record is how wrong ids propagate. Held back, counted.
        gaps.push('purchase_requirements')
      }
    }
    const reached = facts?.requirements.reached_date ?? null
    const availableFrom =
      reached !== null && SEASONS.has(reached.season)
        ? { season: reached.season as Season, day: reached.day, year: reached.year }
        : null

    // ── Envelope ──────────────────────────────────────────────────────────
    const prov: Animal['prov'] = { '*': 'manual' }
    if (facts !== null) {
      prov['*'] = 'game_files'
      prov.feed_item_ids = 'manual'
      prov.wiki_page = 'manual'
      // Mixed inside one object: the treat and egg facts are the game's, the
      // gestation length is the wiki's. The finer grain has nowhere to live.
      prov.breeding = 'manual'
    }

    return {
      id: animal.id,
      name: facts?.name ?? animal.name,
      numeric_id: null,
      numeric_id_game_version: null,
      // Not in the ItemId enum — animals are their own table, keyed by the
      // game's own file names, which is exactly what these ids are.
      id_status: facts === null ? 'provisional' : 'confirmed',
      former_ids: [],
      also_known_as: [],
      game_version: facts === null ? null : (ctx.game?.version ?? null),
      version_added: null,
      confidence: facts === null ? 'wiki' : 'verified',
      prov,
      data_gaps: [...new Set(gaps)].sort(),
      icon_key: `animal/${animal.id}`,
      wiki_page: animal.wiki_page,
      blurb: null,

      building: animal.building,
      size: facts?.size ?? null,
      matures_days: facts?.breeding.days_until_adult ?? input.maturesDays[animal.building],
      products,
      breeding,
      feed_item_ids: feed.ids,
      purchase: {
        price: facts?.pricing.buy_price ?? animal.price,
        currency: 'tesserae',
        shop_id: input.shopId,
        requires,
        available_from: availableFrom,
      },
      sell:
        facts === null
          ? null
          : {
              baby: facts.pricing.baby_sell_price,
              adult_by_heart: facts.pricing.adult_sell_prices,
              tier_multipliers: facts.pricing.tier_sell_price_multipliers,
            },
      variants:
        facts === null
          ? []
          : facts.variants.map((variant) => {
              const pairName =
                variant.default_cosmetic === null
                  ? undefined
                  : ctx.game?.animalCosmeticNameByPair.get(
                      `${animal.id}|${variant.default_cosmetic}`,
                    )
              return {
                key: variant.key,
                name: variant.name,
                tier: Math.min(Math.max(variant.tier ?? 1, 1), 6),
                born_in:
                  variant.born_in === null
                    ? [...ALL_SEASONS]
                    : variant.born_in.filter((s): s is Season => SEASONS.has(s)),
                purchasable: variant.default_unlocked,
                acquirable: variant.acquirable,
                renown_value: variant.renown_value,
                default_cosmetic_item_id:
                  pairName !== undefined && ctx.itemByName.has(pairName)
                    ? ctx.idFor(pairName)
                    : null,
                // The swatch key ships whether or not the art exists yet, so
                // asset coverage reports a variant whose sprite never arrived
                // instead of nothing ever asking for one.
                icon_key: `animal/${animal.id}_${variant.key}`,
              }
            }),
      is_mount: facts?.is_mount ?? null,
      petting:
        facts === null || (facts.petting.kind !== 'pet' && facts.petting.kind !== 'pick_up')
          ? null
          : {
              kind: facts.petting.kind,
              essence_points: facts.petting.essence_points,
              stamina_cost: facts.petting.stamina_cost,
            },
      eats:
        facts?.eating.kind === 'seed' || facts?.eating.kind === 'hay' ? facts.eating.kind : null,
    }
  })

  if (game !== null) {
    const joined = built.filter((a) => a.sell !== null).length
    consola.info(`animals: ${joined}/${built.length} joined to the game's ranching tables`)
    // The game's animal list and ours must be the same set — a ninth animal in
    // a patch must not be silence.
    const ours = new Set(input.animals.map((a) => a.id))
    const extra = game.animals.filter((a) => !ours.has(a.id)).map((a) => a.id)
    if (extra.length > 0) {
      consola.warn(`animals: game states unshipped animal(s) — ${extra.join(', ')}`)
    }
  }
  if (disagreements.length > 0) {
    consola.warn(`animals: curated and game disagree — ${disagreements.join(' · ')}`)
  }
  if (unresolvedGameIds > 0) {
    consola.warn(`animals: ${unresolvedGameIds} game item id(s) ship no record`)
  }

  return built
}

export function buildBuildings(ctx: BuildContext): Building[] {
  const input: BuildingInputs = ctx.buildings
  const stables = ctx.game?.ranching?.stables ?? []
  // small_barn / medium_barn / large_barn are the coop-or-barn record's tiers
  // 1/2/3 — the same reading the curated tiers already use.
  const stableByKindTier = new Map<string, GameStable>()
  for (const stable of stables) {
    const [size, kind] = stable.id.split('_')
    const tier = size === 'small' ? 1 : size === 'medium' ? 2 : size === 'large' ? 3 : null
    if (tier !== null && kind !== undefined) stableByKindTier.set(`${kind}:${tier}`, stable)
  }

  return input.buildings.map((building) => {
    const gaps: string[] = []
    const owner = `building:${building.id}`

    const tiers = building.tiers.map((tier) => {
      const materials: { item_id: string; quantity: number }[] = []
      for (const material of tier.materials) {
        if (!ctx.itemByName.has(material.item)) {
          ctx.resolver.recordUnresolved(material.item, 'curated_item', owner)
          gaps.push('materials')
          continue
        }
        materials.push({ item_id: ctx.idFor(material.item), quantity: material.quantity })
      }

      const stable =
        building.kind === 'coop' || building.kind === 'barn'
          ? stableByKindTier.get(`${building.kind}:${tier.level}`)
          : undefined
      return {
        level: tier.level,
        cost: { tesserae: tier.tesserae, materials },
        capacity: stable?.max_occupants ?? tier.capacity,
        incubators: stable?.incubators ?? null,
        requires: tier.requires as Requirement[],
      }
    })

    // A building with no tiers is one whose cost table we have not read yet.
    // Recording it empty is what lets a player learn the Mill exists.
    if (tiers.length === 0) gaps.push('tiers')

    const animalSize =
      building.kind === 'coop'
        ? ('small' as const)
        : building.kind === 'barn'
          ? ('large' as const)
          : null
    const stableJoined =
      (building.kind === 'coop' || building.kind === 'barn') && stables.length > 0

    return {
      id: building.id,
      name: building.name,
      numeric_id: null,
      numeric_id_game_version: null,
      id_status: 'provisional' as const,
      former_ids: [],
      also_known_as: [],
      game_version: stableJoined ? (ctx.game?.version ?? null) : null,
      version_added: null,
      confidence: 'wiki' as const,
      prov: stableJoined
        ? ({ '*': 'manual', tiers: 'game_files' } as Building['prov'])
        : { '*': 'manual' as const },
      data_gaps: [...new Set(gaps)],
      icon_key: `building/${building.kind}`,
      wiki_page: building.wiki_page,
      blurb: null,

      kind: building.kind,
      tiers,
      animal_size: stableJoined ? animalSize : null,
      vendor_shop_id: building.vendor,
      placeable_on_farm: building.placeable_on_farm,
    }
  })
}

/**
 * Pet records, one per kind. `pet_` prefixed ids: `mimic` the pet would
 * collide with `mimic` the monster in the display index, which keeps the
 * first arrival and silently drops the second.
 */
export function buildPets(ctx: BuildContext): Pet[] {
  const extract = ctx.game?.petsExtract ?? null
  if (extract === null) return []
  const names = ctx.game?.petKindNames ?? new Map<string, string>()

  const byKind = new Map<string, { key: string; name: string | null; icon_key: string }[]>()
  for (const variant of extract.variants) {
    if (variant.pet_kind === null) continue
    const list = byKind.get(variant.pet_kind) ?? []
    // The swatch key ships whether or not the art exists yet — same contract
    // as the animal variants, so a missing sprite is a reported gap.
    list.push({
      key: variant.key,
      name: variant.name,
      icon_key: `pet/${variant.pet_kind}_${variant.key}`,
    })
    byKind.set(variant.pet_kind, list)
  }

  const dropped: string[] = []
  const built: Pet[] = []
  for (const [kind, variants] of [...byKind.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const name = names.get(kind)
    if (name === undefined) {
      // A kind the alias file does not name — a new pet in a patch. Dropped
      // and counted, never de-tokenised into a name.
      dropped.push(kind)
      continue
    }
    built.push({
      id: `pet_${kind}`,
      name,
      numeric_id: null,
      numeric_id_game_version: null,
      id_status: 'confirmed',
      former_ids: [],
      also_known_as: [],
      game_version: ctx.game?.version ?? null,
      version_added: null,
      confidence: 'verified',
      prov: { '*': 'game_files', name: 'manual' },
      // How each pet is obtained is stated nowhere in the files we read.
      data_gaps: ['acquisition'],
      icon_key: `pet/${kind}`,
      wiki_page: null,
      blurb: null,

      kind_key: kind,
      variants: variants.sort((a, b) => a.key.localeCompare(b.key)),
    })
  }
  if (dropped.length > 0) {
    consola.warn(`pets: ${dropped.length} unnamed kind(s) dropped — ${dropped.join(', ')}`)
  }
  return built
}

/** The singleton rulebook record. Empty dataset when the extract predates it. */
export function buildRanching(ctx: BuildContext, builtItemIds?: Set<string>): RanchingRules[] {
  const game = ctx.game?.ranching ?? null
  if (game === null) return []
  const pets = ctx.game?.petsExtract ?? null

  const heartPoints = game.misc.heart_points
  const int = (value: number | number[] | undefined): number | null =>
    typeof value === 'number' && Number.isInteger(value) ? value : null
  const intList = (value: number | number[] | undefined): number[] =>
    Array.isArray(value) ? value.filter((n) => Number.isInteger(n)) : []

  const petJobs: RanchingRules['pet_jobs'] = []
  for (const job of pets?.jobs ?? []) {
    if (job.key !== 'wood' && job.key !== 'stone' && job.key !== 'forageables') continue
    const rewardShips =
      job.reward_item !== null && (builtItemIds === undefined || builtItemIds.has(job.reward_item))
    if (job.reward_item !== null && !rewardShips) {
      ctx.resolver.recordUnresolved(job.reward_item, 'curated_item', `pet_job:${job.key}`)
    }
    petJobs.push({
      job: job.key,
      location_id:
        job.location_room === null
          ? null
          : (ctx.game?.locationByRoom.get(job.location_room) ?? null),
      reward_item_id: rewardShips ? job.reward_item : null,
      reward_custom: job.reward_custom,
      reward_by_heart: job.reward_table,
    })
  }

  return [
    {
      id: 'ranching_rules',
      name: 'Ranching',
      numeric_id: null,
      numeric_id_game_version: null,
      id_status: 'confirmed',
      former_ids: [],
      also_known_as: [],
      game_version: ctx.game?.version ?? null,
      version_added: null,
      confidence: 'verified',
      prov: { '*': 'game_files' },
      data_gaps: [],
      icon_key: null,
      wiki_page: 'Animals',
      blurb: null,

      min_hearts_to_breed: game.misc.min_heart_level_for_breeding,
      heart_point_table: game.misc.heart_point_table,
      production_tiers: game.misc.production_tiers,
      heart_actions: {
        pet: int(heartPoints.pet),
        feed: int(heartPoints.feed),
        go_outside: int(heartPoints.go_outside),
        left_outside_penalty: int(heartPoints.left_outside_penalty),
        feed_bonus: {
          normal: int(heartPoints.normal_feed_bonus),
          quality: int(heartPoints.quality_feed_bonus),
          deluxe: int(heartPoints.deluxe_feed_bonus),
          ultimate: int(heartPoints.ultimate_feed_bonus),
        },
        crop_bonus: int(heartPoints.crop_bonus),
        cooked_star_bonuses: intList(heartPoints.cooked_star_bonuses),
        child_born: int(heartPoints.child_born),
        toy: int(heartPoints.toy),
      },
      festival_scoring: {
        tier_points: game.misc.festival_scoring.tier,
        heart_points: game.misc.festival_scoring.heart,
      },
      pet_jobs: petJobs,
    },
  ]
}
