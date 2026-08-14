import { type Meta, SEASONS } from '@mistria/schema'
import { getRouteApi, Link, useNavigate } from '@tanstack/react-router'
import { useEffect, useMemo, useState } from 'react'
import { Column } from '~/app/AppShell'
import { useAtlas } from '~/app/AtlasProvider'
import { BackLink } from '~/components/BackLink'
import { FishShadow } from '~/components/FishShadow'
import { ItemIcon } from '~/components/ItemIcon'
import { OpportunityCard } from '~/components/OpportunityCard'
import { PlaceLink } from '~/components/PlaceLink'
import { NotRecorded, Section, Unknown } from '~/components/Section'
import { SpoilerAsk, SpoilerChip, veilReasonOf } from '~/components/Spoiler'
import { ValleyMap } from '~/components/ValleyMap'
import {
  type DisplayIndex,
  loadDataset,
  loadDisplayIndex,
  loadItemRecord,
  loadMeta,
  loadRequestBoard,
} from '~/lib/data'
import { useDocumentTitle } from '~/lib/head'
import {
  categoryLabelOne,
  gateDisplay,
  type PlaceLabel,
  placeLabels,
  recipeSourceLabel,
  stallLabel,
  titleCase,
  WORN_ON_LABELS,
} from '~/lib/labels'
import { opportunitiesFromWindows } from '~/lib/opportunity'
import { doneIn, setDone } from '~/lib/progress'
import type { BoardRequest } from '~/lib/request-board'
import { iconKeyFor } from '~/lib/search'
import { useSpoilers } from '~/lib/spoilers'

const route = getRouteApi('/item/$id')

/**
 * One item: what it is worth, where it comes from, and who wants it.
 *
 * This is the screen that needs the full record, so it is the one screen that
 * loads `items.json`. That is the right trade — you arrive here having chosen a
 * single thing, so a one-off second of loading buys every field — and it is why
 * no *list* screen loads it.
 */

interface ItemRecord {
  id: string
  name: string
  spoiler?: boolean
  unreleased?: boolean
  /** Furniture colour groups: the game's own id per colourway. */
  variant_ids?: string[]
  variant_recipes_differ?: true
  /** Wardrobe: how many colours, which slot, and whether you start with it. */
  variant_count?: number
  worn_on?: string
  default_unlocked?: true
  icon_key: string | null
  category: string
  sell_value: number | null
  buy_value: number | null
  is_giftable: boolean | null
  data_gaps: string[]
  museum: { donatable: boolean; set_id: string | null; wing: string | null } | null
  sold_by: string[]
  wiki_page: string | null
  availability: {
    method: string
    seasons: string[]
    weather: string[] | null
    locations: string[]
    /** What the places were expanded from, when they were deduced. */
    habitats: string[]
    time: { from: string; to: string }[] | null
    time_precision: string
    weather_precision: string
    rarity: string | null
    confidence: string
    requires: Gate[]
  }[]
}

interface RecipeRecord {
  id: string
  kind: string
  station: string | null
  station_level: number | null
  craft_minutes: number | null
  /** What the bench asks of you before the recipe is craftable at all. */
  skill: { id: string; level: number } | null
  ingredients: { item_id: string | null; tag: string | null; quantity: number }[]
  output: { item_id: string | null; quantity: number }
  /**
   * How the recipe is *learned*, which is a different question from how the
   * thing it makes is obtained — you buy a Lemon Pie at the Inn for 650 and you
   * buy the recipe for it at the same counter for 400.
   *
   * An array because a recipe can be taught in more than one place, and the
   * screen must not pick a winner. `confidence: 'inferred'` is the one entry
   * the game does not state: no scroll for it exists anywhere, so the crafting
   * level is the only gate left, and it renders hedged.
   */
  sources: {
    method: string
    source_id: string | null
    /** Which stall at the festival — an internal token, labelled or dropped. */
    stall_key: string | null
    character_id: string | null
    price: number | null
    currency: string
    requires: Gate[]
    confidence: string
  }[]
}

/** Just enough of a festival to name a recipe stall's host — and to veil it. */
interface FestivalLite {
  id: string
  name: string
  spoiler?: boolean
  unreleased?: boolean
}

interface GiftPrefs {
  character_id: string
  prefs: Record<string, string[]>
}

/** A gate on a stock line, a shop, or an availability window. */
interface Gate {
  type: string
  key: string
  op?: string
  value?: unknown
}

interface ShopRecord {
  id: string
  name: string
  /** `shop/<id>`. The eight fixed shops have art; the six stalls glyph. */
  icon_key: string | null
  location_id: string | null
  owner_character_id: string | null
  /** Day-gated shops — the Saturday Market stalls. Empty means always open. */
  hours: { days: string[] }[]
  /**
   * Gates on the shop existing at all: the six Saturday Market stalls appear
   * once the bridge is repaired. Empty means open from day one.
   */
  unlock_requires: Gate[]
  /**
   * The whole line, not just the id.
   *
   * This interface used to declare `{ item_id, rotation }` and everything else
   * on the line was discarded on the way in — which is why 68 items sold only
   * after a shop upgrade said nothing about it, and why every price on the page
   * was the item's *global* one. A shop's own price is the accurate figure:
   * the Inn sells the Lemon Pie at 650 and its recipe scroll at 400, and one
   * global number cannot be both.
   */
  stock: {
    item_id: string
    price: number | null
    currency: string
    requires: Gate[]
    /** Seasons this line is stocked in. `null` is year-round, not unknown. */
    seasons: string[] | null
    rotation: boolean
    /**
     * Set when the line sells the *recipe*, not the thing it makes.
     *
     * `item_id` is still the product, so the line links somewhere useful — but
     * rendering it as a plain product line is what put the Lemon Pie on the
     * Inn's shelf twice, at 650 and at 400, with nothing saying which was which.
     */
    teaches_recipe_id: string | null
  }[]
}

/** A place, with what the valley map needs to draw it. */
interface LocationLite {
  id: string
  name: string
  parent_id: string | null
  shape: { type: 'cells'; cell: number; runs: [number, number, number][] } | null
  anchor: { x: number; y: number } | null
}

interface MineRecord {
  id: string
  name: string
  location_id: string | null
  floors: { min: number; max: number }
}

/** `['sat']` -> "Saturdays". Only whole days are ever stated on a shop. */
const DAY_NAMES: Record<string, string> = {
  mon: 'Mondays',
  tue: 'Tuesdays',
  wed: 'Wednesdays',
  thu: 'Thursdays',
  fri: 'Fridays',
  sat: 'Saturdays',
  sun: 'Sundays',
}

interface SealRecord {
  id: string
  name: string
  quest_id: string
  required_items: { item_id: string; quantity: number }[]
}

/** The fish facet — only the shadow is rendered here. */
interface FishFacetLite {
  item_id: string
  shadow_size: string | null
}

/** A production machine — data only its own item page renders. */
interface MachineRecord {
  id: string
  item_id: string
  days_to_produce: number | null
  capacity: number | null
  accepts_item_ids: string[]
  yields: { input_rarity: string; item_ids: string[] }[]
  requests: {
    item_id: string
    season: string | null
    requires: { type: string; key: string }[]
  }[]
}

interface QuestLite {
  id: string
  name: string
  kind: string
  objectives: { type: string; target_id: string | null; quantity: number | null }[]
}

/** Just enough of an animal to say "your cow makes this" with a link. */
interface AnimalLite {
  id: string
  name: string
  icon_key: string | null
  products: {
    item_id: string
    sex: 'male' | 'female' | null
    days_to_produce: number | null
    hearts_required: number | null
    quality: string | null
  }[]
  breeding: { treat_item_id: string | null } | null
  feed_item_ids: string[]
}

/** Just enough of a monster to say "this drops it" with a link. */
interface MonsterLite {
  id: string
  name: string
  icon_key: string | null
  drops: {
    item_id: string
    chance: number | null
    quantity: { min: number; max: number } | null
    requires_perk: string | null
  }[]
}

/** One thing that wants this item handed over, and its tick. */
interface Need {
  /** Progress domain — decides the stored key and never collides. */
  domain: 'museum' | 'seal' | 'quest' | 'request'
  /** The id half of the progress key. */
  progressId: string
  label: string
  /** Where tapping the name goes; null for the museum (its link is the banner). */
  linkTo: { to: '/quest/$id' | '/museum'; id?: string } | null
  quantity: number
  /** The needing record's index id, for veil checks. Null for the museum. */
  aboutId: string | null
}

/** The four levels the wiki records, best first. */
const PREF_ORDER = ['loved', 'liked', 'neutral', 'disliked', 'hated'] as const

export function ItemRoute() {
  const { id } = route.useParams()
  const [state, setState] = useState<{
    item: ItemRecord | null
    index: DisplayIndex
    prefs: GiftPrefs[]
    places: Map<string, PlaceLabel>
    locations: LocationLite[]
    shops: Map<string, ShopRecord>
    /** Keyed by mine id, not location id — a recipe's chest source names the biome. */
    mines: Map<string, MineRecord>
    recipes: RecipeRecord[]
    seals: SealRecord[]
    quests: QuestLite[]
    festivals: Map<string, FestivalLite>
    board: BoardRequest[]
    machines: MachineRecord[]
    fishFacets: FishFacetLite[]
    monsters: MonsterLite[]
    animals: AnimalLite[]
    meta: Meta | null
    loading: boolean
  }>({
    item: null,
    index: {},
    prefs: [],
    places: new Map(),
    locations: [],
    shops: new Map(),
    mines: new Map(),
    recipes: [],
    seals: [],
    quests: [],
    festivals: new Map(),
    board: [],
    machines: [],
    fishFacets: [],
    monsters: [],
    animals: [],
    meta: null,
    loading: true,
  })
  // What has already been handed in, one Set per progress domain. Loaded with
  // the data and written optimistically, exactly like the museum screen.
  const [ticked, setTicked] = useState<Record<string, Set<string>>>({})

  useEffect(() => {
    let live = true
    Promise.all([
      loadItemRecord<ItemRecord>(id),
      loadDisplayIndex(),
      loadDataset<GiftPrefs>('gift_prefs'),
      loadDataset<LocationLite>('locations'),
      // 4KB, for five floor ranges. "The Tide Caverns" does not say it is
      // floors 21 to 39, and that is what decides whether to go.
      loadDataset<MineRecord>('mines'),
      loadDataset<ShopRecord>('shops'),
      loadDataset<RecipeRecord>('recipes'),
      loadDataset<SealRecord>('seals'),
      loadDataset<QuestLite>('quests'),
      // 3KB, so a festival-taught recipe can say *which* festival — and stay
      // veiled when the calendar veils it.
      loadDataset<FestivalLite>('festivals'),
      loadDataset<MachineRecord>('machines'),
      loadDataset<FishFacetLite>('fish'),
      // 6KB, for the reverse of the bestiary's drop tables — "where do I get
      // Monster Shell" is answered by who drops it, and nothing else says so.
      loadDataset<MonsterLite>('monsters'),
      // A few KB, for the reverse of the ranch's produce tables — an egg's
      // page should name the hen.
      loadDataset<AnimalLite>('animals'),
      loadRequestBoard(),
      loadMeta(),
      Promise.all(
        (['museum', 'seal', 'quest', 'request'] as const).map(
          async (domain) => [domain, await doneIn(domain)] as const,
        ),
      ),
    ])
      .then(
        ([
          item,
          index,
          prefs,
          locations,
          mines,
          shops,
          recipes,
          seals,
          quests,
          festivals,
          machines,
          fishFacets,
          monsters,
          animals,
          board,
          meta,
          done,
        ]) => {
          if (!live) return
          setState({
            item,
            index,
            prefs,
            places: placeLabels(locations, mines),
            mines: new Map(mines.map((mine) => [mine.id, mine])),
            locations,
            shops: new Map(shops.map((s) => [s.id, s])),
            recipes,
            seals,
            quests,
            festivals: new Map(festivals.map((f) => [f.id, f])),
            board: board.requests,
            machines,
            fishFacets,
            monsters,
            animals,
            meta,
            loading: false,
          })
          setTicked(Object.fromEntries(done))
        },
      )
      .catch(() => live && setState((s) => ({ ...s, loading: false })))
    return () => {
      live = false
    }
  }, [id])

  const spoilers = useSpoilers()
  const navigate = useNavigate()
  const artUrl = useAtlas().mapUrl('map/valley')
  const {
    item,
    index,
    prefs,
    places,
    locations,
    shops,
    mines,
    recipes,
    seals,
    quests,
    festivals,
    board,
    machines,
    fishFacets,
    monsters,
    animals,
    meta,
    loading,
  } = state
  useDocumentTitle(item?.name ?? null)

  // Every way to get this, one entry per place. Built from the record's own
  // windows rather than the flat rules index — see `opportunitiesFromWindows`
  // for why the index is the wrong source here.
  const opportunities = useMemo(
    () => (item === null ? [] : opportunitiesFromWindows(item.availability, meta?.weatherOdds)),
    [item, meta],
  )

  // Everything that wants this item handed over. Boolean ticks — the store is
  // a CRDT of {key, signed-timestamp} and cannot count to three — with the
  // required quantity displayed beside each.
  const needs = useMemo((): Need[] => {
    const out: Need[] = []
    for (const seal of seals) {
      const wanted = seal.required_items.find((r) => r.item_id === id)
      if (wanted === undefined) continue
      out.push({
        domain: 'seal',
        progressId: `${seal.id}/${id}`,
        label: seal.name,
        linkTo: { to: '/quest/$id', id: seal.quest_id },
        quantity: wanted.quantity,
        aboutId: seal.quest_id,
      })
    }
    const sealQuests = new Set(seals.map((s) => s.quest_id))
    for (const quest of quests) {
      // Requests are listed from the board (giver attached); seal quests are
      // listed above with their seal's name. What is left is every other
      // quest that takes a delivery of this item.
      if (quest.kind === 'request' || sealQuests.has(quest.id)) continue
      const objective = quest.objectives.find((o) => o.target_id === id)
      if (objective === undefined) continue
      out.push({
        domain: 'quest',
        progressId: `${quest.id}/${id}`,
        label: quest.name,
        linkTo: { to: '/quest/$id', id: quest.id },
        quantity: objective.quantity ?? 1,
        aboutId: quest.id,
      })
    }
    for (const request of board) {
      const wanted = request.items.find((i) => i.id === id)
      if (wanted === undefined) continue
      // A spoiler giver's name stays off the label until revealed — the row's
      // usual veil keys off the *quest* record, and these requests are not
      // themselves spoilers; only who posted them is.
      const veiledGiver =
        request.giver_spoiler === true &&
        (request.giver_id === null || !spoilers.shown(request.giver_id))
      out.push({
        domain: 'request',
        progressId: `${request.id}/${id}`,
        label:
          request.giver_name === null || veiledGiver
            ? request.name
            : `${request.giver_name} — ${request.name}`,
        linkTo: { to: '/quest/$id', id: request.id },
        quantity: wanted.quantity,
        aboutId: request.id,
      })
    }
    return out
  }, [seals, quests, board, id, spoilers])

  const isTicked = (need: Need): boolean => ticked[need.domain]?.has(need.progressId) ?? false
  const toggleNeed = (need: Need): void => {
    const now = !isTicked(need)
    setTicked((current) => {
      const next = new Set(current[need.domain] ?? [])
      if (now) next.add(need.progressId)
      else next.delete(need.progressId)
      return { ...current, [need.domain]: next }
    })
    void setDone(need.domain, need.progressId, now)
  }
  const museumDone = ticked.museum?.has(id) ?? false
  const toggleMuseum = (): void => {
    const now = !museumDone
    setTicked((current) => {
      const next = new Set(current.museum ?? [])
      if (now) next.add(id)
      else next.delete(id)
      return { ...current, museum: next }
    })
    void setDone('museum', id, now)
  }
  const recipe = item === null ? undefined : recipes.find((r) => r.output.item_id === item.id)
  const machine = item === null ? undefined : machines.find((m) => m.item_id === item.id)
  // The other direction: everything this item goes into. Matched on the item
  // id alone — a recipe wanting "any fish" is a category, not this item, and
  // claiming it would overstate what we know.
  const usedIn =
    item === null
      ? []
      : recipes.filter(
          (r) =>
            r.output.item_id !== null &&
            r.output.item_id !== item.id &&
            r.ingredients.some((ing) => ing.item_id === item.id),
        )

  // The reverse of the bestiary's drop tables: who drops this. Thirteen
  // monster materials had no other recorded source and showed "No source
  // recorded" while the bestiary listed exactly who to hit for them.
  const droppedBy =
    item === null ? [] : monsters.filter((m) => m.drops.some((d) => d.item_id === item.id))

  // The reverse of the ranch's produce tables: which animal makes this, which
  // one breeds with it, which ones eat it. Ranching products used to answer
  // "where does milk come from" with silence.
  const producedBy =
    item === null ? [] : animals.filter((a) => a.products.some((p) => p.item_id === item.id))
  const treatFor = item === null ? [] : animals.filter((a) => a.breeding?.treat_item_id === item.id)
  const feedFor = item === null ? [] : animals.filter((a) => a.feed_item_ids.includes(item.id))

  // Who feels how about this item, from the reverse of the gift table.
  const opinions = useMemo(() => {
    const byLevel = new Map<string, string[]>()
    for (const record of prefs) {
      for (const [level, ids] of Object.entries(record.prefs)) {
        if (!ids.includes(id)) continue
        byLevel.set(level, [...(byLevel.get(level) ?? []), record.character_id])
      }
    }
    return byLevel
  }, [prefs, id])

  if (loading) {
    return (
      <Column>
        <p className="text-ink-mute text-sm">Loading…</p>
      </Column>
    )
  }

  if (item === null) {
    return (
      <Column>
        <h1 className="text-2xl">Not found</h1>
        <p className="mt-1 text-ink-mute text-sm">
          Nothing here goes by “{id.replace(/_/g, ' ')}”.{' '}
          <Link to="/browse" className="underline decoration-rule underline-offset-4">
            Browse instead
          </Link>
          .
        </p>
      </Column>
    )
  }

  // The veil covers the whole page, name included — the name is the spoiler.
  // Same treatment for content the game does not ship yet, in its own words.
  if ((item.spoiler === true || item.unreleased === true) && !spoilers.shown(item.id)) {
    return (
      <Column>
        <BackLink />
        <SpoilerAsk
          id={item.id}
          kind="item"
          reason={item.spoiler === true ? 'spoiler' : 'unreleased'}
        />
      </Column>
    )
  }

  return (
    <Column>
      <BackLink />
      <header className="flex items-center gap-3">
        <ItemIcon iconKey={item.icon_key ?? `item/${item.id}`} name={item.name} size="lg" />
        <div className="min-w-0">
          <h1 className="truncate text-2xl">{item.name}</h1>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-1 text-ink-mute text-sm">
            <span>
              {categoryLabelOne(item.category)}
              {item.worn_on !== undefined && (
                <> · worn on the {(WORN_ON_LABELS[item.worn_on] ?? item.worn_on).toLowerCase()}</>
              )}
              {item.sell_value !== null && ' · sells for'}
              {/* A wardrobe item cannot be sold back, so its price is what it
                  costs — the one category where buy_value is the headline. */}
              {item.sell_value === null && item.buy_value !== null && ' · costs'}
            </span>
            {/* The coin is decoration; the "t" is the unit. Keeping both is
                mildly redundant and survives a clone with no art, where the
                sprite is a lettered tile and "500" alone would name no
                currency. Every list row says "500t" too. */}
            {(item.sell_value ?? item.buy_value) !== null && (
              <span className="inline-flex items-center gap-1">
                <ItemIcon iconKey="ui/tesserae" name="tesserae" size="sm" />
                <span data-numeral>{item.sell_value ?? item.buy_value}t</span>
              </span>
            )}
          </p>
        </div>
      </header>

      {/* What the fish looks like from the shore — the game shows a sized
          silhouette in the water, and knowing which shadow to chase is half
          the hunt. Rendered only when the facet states a size. */}
      {item.category === 'fish' &&
        (() => {
          const shadow = fishFacets.find((f) => f.item_id === item.id)?.shadow_size
          if (shadow == null) return null
          return (
            // Stacked on a phone, side by side once there is room: the panel is
            // 192px wide and a 390px screen leaves the sentence two cramped
            // lines beside it. The label goes under the thing it labels.
            <div className="mt-3 flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:gap-3">
              <FishShadow size={shadow} />
              <p className="text-ink-mute text-sm">
                Shows a <span className="text-ink">{shadow}</span> shadow in the water.
              </p>
            </div>
          )
        })()}

      {/* The wardrobe's own two facts: how many colours the palette offers,
          and whether you already own it from character creation — which is
          why nothing sells it. */}
      {(item.variant_count !== undefined || item.default_unlocked === true) && (
        <p className="mt-2 text-ink-mute text-sm">
          {item.variant_count !== undefined && (
            <>
              Comes in <span data-numeral>{item.variant_count}</span> colours.{' '}
            </>
          )}
          {item.default_unlocked === true && 'Yours from the start — no shop sells it.'}
        </p>
      )}

      {item.variant_ids !== undefined && item.variant_ids.length > 1 && (
        <p className="mt-2 text-ink-mute text-sm">
          Comes in <span data-numeral>{item.variant_ids.length}</span> colours and styles.{' '}
          {item.variant_recipes_differ === true
            ? 'Colours can ask for different materials — the recipe below makes the base one.'
            : 'One recipe covers them all; you pick the look when crafting.'}
        </p>
      )}

      {item.museum?.donatable === true && (
        <label
          className="mt-3 flex cursor-pointer items-center gap-2.5 rounded-card px-3 py-2 text-sm"
          style={{ background: 'var(--museum-tint)', color: 'var(--ink)' }}
        >
          {/* The same museum:<item_id> key the museum screen writes, so the
              two checkboxes can never disagree. */}
          <input type="checkbox" checked={museumDone} onChange={toggleMuseum} />
          {item.museum.wing !== null && (
            <ItemIcon
              iconKey={`museum/${item.museum.wing}`}
              name={`${item.museum.wing} wing`}
              size="sm"
            />
          )}
          <span className={museumDone ? 'line-through opacity-70' : undefined}>
            <Link to="/museum" className="underline decoration-rule underline-offset-4">
              The museum wants this
            </Link>{' '}
            — {item.museum.wing?.replace(/_/g, ' ') ?? 'wing unknown'} wing.
            {museumDone && ' Donated.'}
          </span>
        </label>
      )}

      {/*
        One section, where there used to be two.

        This list and the "Where can I get this? →" link beneath it asked the
        same question, and the page it linked to answered it better — weather,
        frequencies and a map, none of which were here. The two are now one:
        `OpportunityCard` renders a row per place, and the map that used to be
        on the other screen sits under it.
      */}
      <Section title="Where to find it">
        {opportunities.length === 0 ? (
          // "No source recorded" is true of the availability data and was
          // being printed directly above a shop selling the thing at a stated
          // price — which is 482 items, the largest group on this screen, and
          // reads as the app contradicting itself one line later. The gap is
          // real and still says so; it just no longer claims to be the whole
          // answer when the page already holds a better one.
          <Unknown>
            {(() => {
              // Name what the page *does* hold before conceding a gap — the
              // availability data really is empty, but printing "No source
              // recorded" above a shop, a recipe or a drop table is the app
              // contradicting itself one section later.
              const below = [
                ...(item.sold_by.length > 0 ? ['sold'] : []),
                ...(recipe !== undefined ? ['made'] : []),
                ...(droppedBy.length > 0 ? ['dropped by monsters'] : []),
                ...(producedBy.length > 0 ? ['made by your animals'] : []),
              ]
              return below.length === 0
                ? 'No source recorded.'
                : `Not recorded as found anywhere in the wild — but it is ${below.join(' and ')}, below.`
            })()}
          </Unknown>
        ) : (
          <>
            <ul className="flex flex-col divide-y divide-rule border-rule border-y">
              {opportunities.map((opportunity) => (
                // Keyed by what makes the row distinct rather than by its
                // position: an array index changes meaning the moment a window
                // is inserted, and these are ordered by the source, not by us.
                <OpportunityCard
                  key={`${opportunity.method}:${opportunity.seasons.join()}:${opportunity.locationIds.join()}`}
                  opportunity={opportunity}
                  places={places}
                  odds={meta?.weatherOdds}
                  names={index}
                />
              ))}
            </ul>
            <WhereMap
              opportunities={opportunities}
              locations={locations}
              artUrl={artUrl}
              onOpen={(placeId) => void navigate({ to: '/place/$id', params: { id: placeId } })}
            />
          </>
        )}
      </Section>

      {/* The reverse of the bestiary's drop table. A veiled monster shows a
          spoiler chip, not its name — the name is the spoiler. */}
      {droppedBy.length > 0 && (
        <Section title="Dropped by">
          <ul className="flex flex-wrap gap-1.5">
            {droppedBy.map((monster) => {
              const drop = monster.drops.find((d) => d.item_id === item.id)
              const veiled = veilReasonOf(index[monster.id])
              return (
                <li key={monster.id}>
                  {veiled !== null && !spoilers.shown(monster.id) ? (
                    <SpoilerChip reason={veiled} />
                  ) : (
                    <Link
                      to="/monster/$id"
                      params={{ id: monster.id }}
                      className="flex items-center gap-1.5 rounded-tile border border-rule py-0.5 pr-2 pl-0.5 text-ink text-xs transition-colors hover:bg-sunk"
                    >
                      <ItemIcon
                        iconKey={monster.icon_key ?? `monster/${monster.id}`}
                        name={monster.name}
                        size="sm"
                      />
                      {monster.name}
                      {/* A null chance is unknown and never renders as a number. */}
                      {drop?.chance != null && (
                        <span data-numeral className="text-ink-faint">
                          {Math.round(drop.chance * 100)}%
                        </span>
                      )}
                    </Link>
                  )}
                </li>
              )
            })}
          </ul>
        </Section>
      )}

      {/* The reverse of the ranch's produce tables — an egg's page names the
          hen, a treat's page names what it breeds, feed names who eats it. */}
      {(producedBy.length > 0 || treatFor.length > 0 || feedFor.length > 0) && (
        <Section title="From the ranch">
          <ul className="flex flex-col gap-1 text-ink-mute text-sm">
            {producedBy.map((animal) => {
              const product = animal.products.find((p) => p.item_id === item.id)
              return (
                <li key={`makes:${animal.id}`} className="flex items-center gap-2.5">
                  <ItemIcon
                    iconKey={animal.icon_key ?? `animal/${animal.id}`}
                    name={animal.name}
                    size="sm"
                  />
                  <span className="min-w-0">
                    {product?.sex !== null && product !== undefined && (
                      <>{product.sex === 'female' ? 'Female ' : 'Male '}</>
                    )}
                    <Link
                      to="/animal/$id"
                      params={{ id: animal.id }}
                      className="text-ink underline decoration-rule underline-offset-4 hover:text-ink"
                    >
                      {animal.name}
                    </Link>
                    {product?.days_to_produce != null && (
                      <>
                        {product.days_to_produce === 1 ? (
                          <> — daily</>
                        ) : (
                          <>
                            {' — every '}
                            <span data-numeral>{product.days_to_produce}</span> days
                          </>
                        )}
                      </>
                    )}
                    {product?.quality === 'golden' && product.hearts_required !== null && (
                      <>
                        {', from '}
                        <span data-numeral>{product.hearts_required}♥</span>
                      </>
                    )}
                  </span>
                </li>
              )
            })}
            {treatFor.map((animal) => (
              <li key={`treat:${animal.id}`} className="flex items-center gap-2.5">
                <ItemIcon
                  iconKey={animal.icon_key ?? `animal/${animal.id}`}
                  name={animal.name}
                  size="sm"
                />
                <span>
                  Breeds the{' '}
                  <Link
                    to="/animal/$id"
                    params={{ id: animal.id }}
                    className="text-ink underline decoration-rule underline-offset-4 hover:text-ink"
                  >
                    {animal.name}
                  </Link>
                </span>
              </li>
            ))}
            {feedFor.length > 0 && (
              <li className="flex items-start gap-2.5">
                <span className="min-w-0 text-ink-mute">
                  Feed for the{' '}
                  {feedFor.map((animal, i) => (
                    <span key={animal.id}>
                      {i > 0 && (i === feedFor.length - 1 ? ' and ' : ', ')}
                      <Link
                        to="/animal/$id"
                        params={{ id: animal.id }}
                        className="text-ink underline decoration-rule underline-offset-4 hover:text-ink"
                      >
                        {animal.name}
                      </Link>
                    </span>
                  ))}
                </span>
              </li>
            )}
          </ul>
        </Section>
      )}

      {/* The recipe, for anything that is cooked or crafted — which is what
          makes "search for a recipe" honest: the dish's own page explains how
          it is made, ingredients linked. */}
      {recipe !== undefined && (
        <Section title="How it’s made">
          <p className="text-ink-mute text-sm">
            {recipe.station !== null && (
              <>
                At the {recipe.station.toLowerCase()}
                {recipe.station_level !== null && (
                  <>
                    {' (level '}
                    <span data-numeral>{recipe.station_level}</span>
                    {')'}
                  </>
                )}
              </>
            )}
            {/* The skill the bench asks for. 814 recipes state one and none of
                them had ever shown it, so "why can't I craft this" had no
                answer on the page that is supposed to answer it. */}
            {recipe.skill !== null && (
              <>
                {recipe.station !== null ? ' · ' : ''}needs {titleCase(recipe.skill.id)} level{' '}
                <span data-numeral>{recipe.skill.level}</span>
              </>
            )}
            {recipe.craft_minutes !== null && (
              <>
                {recipe.station !== null || recipe.skill !== null ? ' · ' : ''}takes{' '}
                <span data-numeral>{recipe.craft_minutes}</span> minutes
              </>
            )}
          </p>
          {recipe.ingredients.length > 0 && (
            <ul className="mt-1.5 flex flex-col divide-y divide-rule border-rule border-y">
              {recipe.ingredients.map((ingredient) => (
                <li
                  key={ingredient.item_id ?? ingredient.tag ?? ''}
                  className="flex items-center gap-3 py-2"
                >
                  {ingredient.item_id !== null ? (
                    <>
                      <ItemIcon
                        iconKey={iconKeyFor(ingredient.item_id, index[ingredient.item_id])}
                        name={index[ingredient.item_id]?.n ?? ingredient.item_id}
                        size="sm"
                      />
                      <Link
                        to="/item/$id"
                        params={{ id: ingredient.item_id }}
                        className="min-w-0 flex-1 truncate text-ink text-sm underline decoration-transparent underline-offset-4 transition-colors hover:decoration-rule"
                      >
                        {index[ingredient.item_id]?.n ?? ingredient.item_id.replace(/_/g, ' ')}
                      </Link>
                    </>
                  ) : (
                    // "Any fish" — the game accepts a category here, so there
                    // is deliberately no link to a single item.
                    <span className="min-w-0 flex-1 truncate text-ink text-sm">
                      any {ingredient.tag?.replace(/_/g, ' ').toLowerCase()}
                    </span>
                  )}
                  <span data-numeral className="shrink-0 text-ink-mute text-xs">
                    ×{ingredient.quantity}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {/*
            Where the *recipe* comes from — a different question from where the
            thing it makes comes from, and the one this page used to answer with
            "No source recorded" three sections up. You buy a Lemon Pie at the
            Inn for 650 and you buy the recipe for it at the same counter for
            400; those are two facts and the page now states both.

            One row per source, never merged: the Spicy Cheddar Biscuit is
            taught by the Inn *and* by the Wishing Well, and picking a winner
            would be an answer nobody can act on.
          */}
          <h3 className="mt-4 font-display font-semibold text-ink text-sm">
            Where to learn the recipe
          </h3>
          {recipe.sources.length === 0 ? (
            <Unknown>No source recorded for the recipe itself.</Unknown>
          ) : (
            <ul className="mt-1.5 flex flex-col divide-y divide-rule border-rule border-y">
              {recipe.sources.map((source) => (
                <RecipeSourceRow
                  key={`${source.method}:${source.source_id ?? ''}:${source.stall_key ?? ''}`}
                  source={source}
                  shops={shops}
                  quests={quests}
                  mines={mines}
                  festivals={festivals}
                  index={index}
                />
              ))}
            </ul>
          )}
        </Section>
      )}

      {/* The machine's own rules, on the machine's own page — which bees or
          bugs it takes, what each rarity turns into, and what it asks for
          season by season. The products' pages already carry the reverse as
          an availability window ("From an apiary"). */}
      {machine !== undefined && (
        <Section title="What it does">
          <p className="text-ink-mute text-sm">
            Put something in and come back
            {machine.days_to_produce !== null && (
              <>
                {' '}
                <span data-numeral>{machine.days_to_produce}</span> days later
              </>
            )}
            {machine.capacity !== null && (
              <>
                {' — it holds '}
                <span data-numeral>{machine.capacity}</span> at a time
              </>
            )}
            . Rarer inputs yield finer output.
          </p>

          <h3 className="mt-3 font-display font-semibold text-ink text-sm">What it takes</h3>
          <ItemLinkList ids={machine.accepts_item_ids} index={index} />

          <h3 className="mt-3 font-display font-semibold text-ink text-sm">What comes out</h3>
          <ul className="mt-1 flex flex-col gap-1 text-ink-mute text-sm">
            {machine.yields
              .filter((tier) => tier.item_ids.length > 0)
              .map((tier) => (
                <li key={tier.input_rarity} className="flex flex-wrap items-center gap-1.5">
                  <span className="shrink-0">{tier.input_rarity} →</span>
                  {tier.item_ids.map((outId) => (
                    <Link
                      key={outId}
                      to="/item/$id"
                      params={{ id: outId }}
                      className="flex items-center gap-1.5 rounded-tile border border-rule py-0.5 pr-2 pl-0.5 text-ink text-xs transition-colors hover:bg-sunk"
                    >
                      <ItemIcon
                        iconKey={iconKeyFor(outId, index[outId])}
                        name={index[outId]?.n ?? outId}
                        size="sm"
                      />
                      {index[outId]?.n ?? outId.replace(/_/g, ' ')}
                    </Link>
                  ))}
                </li>
              ))}
          </ul>

          {machine.requests.length > 0 && (
            <>
              <h3 className="mt-3 font-display font-semibold text-ink text-sm">What it asks for</h3>
              <p className="text-ink-faint text-xs">
                It requests one of these now and then — a bonus, not a requirement.
              </p>
              <ul className="mt-1 flex flex-col gap-2 text-ink-mute text-sm">
                {SEASONS.filter((season) =>
                  machine.requests.some((request) => request.season === season),
                ).map((season) => (
                  <li key={season} className="flex flex-wrap items-center gap-1.5">
                    <span
                      className="shrink-0 rounded-pill px-1.5 py-0.5 text-[0.625rem]"
                      style={{ background: `var(--${season}-tint)`, color: `var(--${season})` }}
                    >
                      {season}
                    </span>
                    {machine.requests
                      .filter((request) => request.season === season)
                      .map((request) => (
                        <Link
                          key={request.item_id}
                          to="/item/$id"
                          params={{ id: request.item_id }}
                          className="flex items-center gap-1.5 rounded-tile border border-rule py-0.5 pr-2 pl-0.5 text-ink text-xs transition-colors hover:bg-sunk"
                        >
                          <ItemIcon
                            iconKey={iconKeyFor(request.item_id, index[request.item_id])}
                            name={index[request.item_id]?.n ?? request.item_id}
                            size="sm"
                          />
                          {index[request.item_id]?.n ?? request.item_id.replace(/_/g, ' ')}
                        </Link>
                      ))}
                  </li>
                ))}
              </ul>
            </>
          )}
        </Section>
      )}

      {/* There is no shop route, but a shop is a building at a place with an
          owner — and both of those have pages, which is what someone reading
          "the General Store sells this" wants to tap next. */}
      {item.sold_by.length > 0 && (
        <Section title="Sold by">
          <ul className="flex flex-col gap-1 text-ink-mute text-sm">
            {item.sold_by.map((shopId) => {
              const shop = shops.get(shopId)
              if (shop === undefined) {
                return <li key={shopId}>{shopId.replace(/_/g, ' ')}</li>
              }
              const days = [
                ...new Set(shop.hours.flatMap((h) => h.days.map((d) => DAY_NAMES[d] ?? d))),
              ]
              // The line, not just a flag off it. Everything below reads from
              // this one lookup rather than re-scanning the stock per fact.
              //
              // **Skipping the recipe line matters.** The Inn stocks the Lemon
              // Pie and its recipe scroll under the same `item_id`, and taking
              // whichever came first would print the scroll's 400t as the
              // dish's price. The scroll has its own home, in "Where to learn
              // the recipe" above.
              const line = shop.stock.find(
                (entry) => entry.item_id === item.id && entry.teaches_recipe_id === null,
              )
              return (
                <li key={shopId} className="flex items-start gap-2.5">
                  <ItemIcon
                    iconKey={shop.icon_key ?? `shop/${shop.id}`}
                    name={shop.name}
                    size="sm"
                  />
                  <span className="min-w-0">
                    <span className="text-ink">{shop.name}</span>
                    {shop.location_id !== null && (
                      <>
                        {' — in '}
                        <PlaceLink
                          id={shop.location_id}
                          places={places}
                          className="underline decoration-rule underline-offset-4 hover:text-ink"
                        />
                      </>
                    )}
                    {shop.owner_character_id !== null && (
                      <>
                        {', run by '}
                        <Link
                          to="/villager/$id"
                          params={{ id: shop.owner_character_id }}
                          className="underline decoration-rule underline-offset-4 hover:text-ink"
                        >
                          {index[shop.owner_character_id]?.n ??
                            shop.owner_character_id.replace(/_/g, ' ')}
                        </Link>
                      </>
                    )}
                    {(days.length > 0 || line?.rotation === true) && (
                      <span className="text-ink-faint">
                        {days.length > 0 && <> — {days.join(', ')} only</>}
                        {line?.rotation === true && <> · rotating stock</>}
                      </span>
                    )}

                    {/*
                      This shop's own price, which is the accurate one. The
                      header states the item's global `buy_value`, and one
                      global figure cannot be right for two shops at once —
                      the Inn sells the Lemon Pie at 650 and its recipe scroll
                      at 400. The coin decorates and the `t` is the fact, so
                      the figure still reads on a clone with no art.
                    */}
                    {line?.price !== null && line?.price !== undefined && (
                      <span className="mt-0.5 flex items-center gap-1 text-ink text-xs">
                        <ItemIcon iconKey="ui/tesserae" name="tesserae" size="sm" />
                        <span>
                          <span data-numeral>{line.price}</span>t
                        </span>
                        {line.seasons !== null && line.seasons.length > 0 && (
                          <span className="text-ink-faint">
                            {' · '}
                            {SEASONS.filter((s) => line.seasons?.includes(s)).join(', ')} only
                          </span>
                        )}
                      </span>
                    )}

                    {/*
                      What it takes before this line appears at all — the Inn's
                      31 upgrade-gated dishes, Hayden's 24, the Tackle Shop's
                      five rods behind rising Fishing levels. Sixty-eight items
                      are sold only behind one of these and, until now, none of
                      them said so.

                      Two levels, and they are different statements: the line
                      can be gated inside a shop that is already open, and the
                      six Saturday Market stalls do not exist at all until the
                      bridge is repaired.
                    */}
                    {line !== undefined && line.requires.length > 0 && (
                      <span className="mt-0.5 block text-xs" style={{ color: 'var(--locked)' }}>
                        Not stocked until you <GateRun gates={line.requires} index={index} />
                      </span>
                    )}
                    {shop.unlock_requires.length > 0 && (
                      <span className="mt-0.5 block text-xs" style={{ color: 'var(--locked)' }}>
                        The stall opens once you{' '}
                        <GateRun gates={shop.unlock_requires} index={index} />
                      </span>
                    )}
                  </span>
                </li>
              )
            })}
          </ul>
        </Section>
      )}

      {/* The reverse of "How it's made": what this goes into. The forward
          direction was already loaded, so this list is free. */}
      {usedIn.length > 0 && (
        <Section title="Used in">
          <ul className="flex flex-wrap gap-1.5">
            {usedIn.map((r) =>
              r.output.item_id === null ? null : (
                <li key={r.id}>
                  <Link
                    to="/item/$id"
                    params={{ id: r.output.item_id }}
                    className="flex items-center gap-1.5 rounded-tile border border-rule py-0.5 pr-2 pl-0.5 text-ink text-xs transition-colors hover:bg-sunk"
                  >
                    <ItemIcon
                      iconKey={iconKeyFor(r.output.item_id, index[r.output.item_id])}
                      name={index[r.output.item_id]?.n ?? r.output.item_id}
                      size="sm"
                    />
                    {index[r.output.item_id]?.n ?? r.output.item_id.replace(/_/g, ' ')}
                  </Link>
                </li>
              ),
            )}
          </ul>
        </Section>
      )}

      {/* Who wants this handed over — seals, story quests, board requests —
          with a tick per need. Boolean on purpose: the progress store is a
          CRDT of signed timestamps and cannot count "3 of 5"; the ×count says
          how many to bring, the tick says you brought them. */}
      {needs.length > 0 && (
        <Section title="Needed for">
          <ul className="flex flex-col divide-y divide-rule border-rule border-y">
            {needs.map((need) => {
              const entry = need.aboutId === null ? undefined : index[need.aboutId]
              const reason = veilReasonOf(entry)
              const veiled =
                reason !== null && need.aboutId !== null && !spoilers.shown(need.aboutId)
              const done = isTicked(need)
              return (
                <li
                  key={`${need.domain}:${need.progressId}`}
                  className="flex items-center gap-3 py-2"
                >
                  <input
                    type="checkbox"
                    checked={done}
                    onChange={() => toggleNeed(need)}
                    aria-label={`${veiled ? 'Hidden need' : need.label} — handed in`}
                  />
                  {/* Who is asking, as a picture: a quest scroll, or the wing
                      of the museum that wants it. A veiled row draws nothing —
                      the quest sprite says which kind of quest it is, and for
                      a late-story one that is already a hint. */}
                  {!veiled &&
                    (need.linkTo?.to === '/museum' ? (
                      item.museum?.wing != null && (
                        <ItemIcon
                          iconKey={`museum/${item.museum.wing}`}
                          name={`${item.museum.wing} wing`}
                          size="sm"
                        />
                      )
                    ) : need.aboutId === null ? null : (
                      <ItemIcon
                        iconKey={iconKeyFor(need.aboutId, entry ?? { c: 'quest' })}
                        name={need.label}
                        size="sm"
                      />
                    ))}
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {veiled && reason !== null ? (
                      // The need exists and can even be ticked — only the name
                      // of the late-story thing asking stays veiled.
                      need.linkTo?.id !== undefined ? (
                        <Link
                          to="/quest/$id"
                          params={{ id: need.linkTo.id }}
                          className="inline-flex items-center gap-1.5"
                        >
                          <SpoilerChip reason={reason} />
                        </Link>
                      ) : (
                        <SpoilerChip reason={reason} />
                      )
                    ) : need.linkTo === null ? (
                      <span
                        className="text-ink"
                        style={
                          done
                            ? { color: 'var(--ink-faint)', textDecoration: 'line-through' }
                            : undefined
                        }
                      >
                        {need.label}
                      </span>
                    ) : need.linkTo.to === '/museum' ? (
                      <Link
                        to="/museum"
                        className="text-ink underline decoration-transparent underline-offset-4 transition-colors hover:decoration-rule"
                        style={
                          done
                            ? { color: 'var(--ink-faint)', textDecoration: 'line-through' }
                            : undefined
                        }
                      >
                        {need.label}
                      </Link>
                    ) : (
                      <Link
                        to="/quest/$id"
                        params={{ id: need.linkTo.id ?? '' }}
                        className="text-ink underline decoration-transparent underline-offset-4 transition-colors hover:decoration-rule"
                        style={
                          done
                            ? { color: 'var(--ink-faint)', textDecoration: 'line-through' }
                            : undefined
                        }
                      >
                        {need.label}
                      </Link>
                    )}
                  </span>
                  <span data-numeral className="shrink-0 text-ink-mute text-xs tabular-nums">
                    ×{need.quantity}
                  </span>
                </li>
              )
            })}
          </ul>
          <p className="mt-1.5 text-ink-faint text-xs">
            Ticks live on this device (and sync with your code, if you set one up in Settings).
          </p>
        </Section>
      )}

      {opinions.size > 0 && (
        <Section title="As a gift">
          {/* Chips with faces, the villager page's Family pattern — a chip
              list is where an icon belongs (§4a), and "who loves this" is
              answered faster by six faces than six names. A veiled villager
              keeps the chip and loses the face and the name: a sprite is as
              much a spoiler as the text beside it. */}
          <ul className="flex flex-col gap-2">
            {PREF_ORDER.filter((level) => opinions.has(level)).map((level) => (
              <li key={level} className="text-sm">
                <span className="text-ink capitalize">{level}</span>
                <ul className="mt-1 flex flex-wrap items-center gap-1.5">
                  {(opinions.get(level) ?? [])
                    .map((c) => ({ id: c, name: index[c]?.n ?? c.replace(/_/g, ' ') }))
                    .sort((a, b) => a.name.localeCompare(b.name))
                    .map((person) => {
                      const veiled = veilReasonOf(index[person.id])
                      return (
                        <li key={person.id}>
                          {veiled !== null && !spoilers.shown(person.id) ? (
                            <SpoilerChip reason={veiled} />
                          ) : (
                            <Link
                              to="/villager/$id"
                              params={{ id: person.id }}
                              className="flex items-center gap-1.5 rounded-tile border border-rule py-0.5 pr-2 pl-0.5 text-ink text-xs transition-colors hover:bg-sunk"
                            >
                              <ItemIcon
                                iconKey={iconKeyFor(person.id, index[person.id])}
                                name={person.name}
                                size="sm"
                              />
                              {person.name}
                            </Link>
                          )}
                        </li>
                      )
                    })}
                </ul>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <NotRecorded gaps={item.data_gaps} wikiPage={item.wiki_page} />
    </Column>
  )
}

/**
 * A capped, linked run of items. The terrarium accepts 86 different bugs — a
 * count and a tap beats 86 rows, and nothing is hidden: the button says
 * exactly how many more there are.
 *
 * Chips rather than a comma run, because every one of these is an item with a
 * sprite: "which bugs does the terrarium take" is answered far faster by
 * eighty-six pictures than by eighty-six names.
 */
function ItemLinkList({ ids, index }: { ids: string[]; index: DisplayIndex }) {
  const [expanded, setExpanded] = useState(false)
  const named = ids
    .map((id) => ({ id, name: index[id]?.n ?? id.replace(/_/g, ' ') }))
    .sort((a, b) => a.name.localeCompare(b.name))
  const shown = expanded ? named : named.slice(0, 10)

  return (
    <div className="mt-1 flex flex-wrap items-center gap-1.5">
      {shown.map((entry) => (
        <Link
          key={entry.id}
          to="/item/$id"
          params={{ id: entry.id }}
          className="flex items-center gap-1.5 rounded-tile border border-rule py-0.5 pr-2 pl-0.5 text-ink text-xs transition-colors hover:bg-sunk"
        >
          <ItemIcon iconKey={iconKeyFor(entry.id, index[entry.id])} name={entry.name} size="sm" />
          {entry.name}
        </Link>
      ))}
      {named.length > shown.length && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="tap-target text-ink-faint text-xs underline decoration-rule underline-offset-4 hover:text-ink"
        >
          and {named.length - shown.length} more
        </button>
      )}
    </div>
  )
}

/**
 * A run of gates, worded as things you do and linked where they have a page.
 *
 * Joined with "and" rather than a separator, because these are conjunctive:
 * every one has to be true before the line is stocked, and a "·" between them
 * reads as a choice.
 */
function GateRun({ gates, index }: { gates: Gate[]; index: DisplayIndex }) {
  return (
    <>
      {gates.map((gate, i) => {
        const parts = gateDisplay(gate, index[gate.key]?.n)
        return (
          <span key={`${gate.type}:${gate.key}`}>
            {i > 0 && ' and '}
            {parts.prefix}
            {parts.linkTo === null ? (
              parts.label
            ) : (
              <Link
                to={parts.linkTo.to}
                params={{ id: parts.linkTo.id }}
                className="underline decoration-current underline-offset-2"
              >
                {parts.label}
              </Link>
            )}
            {parts.suffix}
          </span>
        )
      })}
    </>
  )
}

/**
 * One way to learn a recipe.
 *
 * The wording lives in `recipeSourceLabel`, not here: a method with no entry
 * there falls back to its own label rather than reaching a player as
 * `chicken_statue`. What this owns is the *shape* — a lead-in, the named thing
 * as a link where one exists, then the gates and the price.
 *
 * **`skill_level` is the only inferred source and must not look like the
 * others.** No scroll for those recipes exists anywhere in the game, so the
 * level is a deduction rather than something a source states; it gets the same
 * `unverified` treatment every other inference on this screen gets.
 */
function RecipeSourceRow({
  source,
  shops,
  quests,
  mines,
  festivals,
  index,
}: {
  source: RecipeRecord['sources'][number]
  shops: Map<string, ShopRecord>
  quests: QuestLite[]
  mines: Map<string, MineRecord>
  festivals: Map<string, FestivalLite>
  index: DisplayIndex
}) {
  const spoilers = useSpoilers()
  const inferred = source.confidence === 'inferred'

  // A festival source names its festival and, where labelled, its stall — but
  // a festival the calendar veils stays veiled here too: the row keeps its
  // "festival stall" fact and the *which* waits behind the same tap-to-reveal
  // the calendar uses, since a festival has no detail page to do the asking.
  const festival = source.method === 'festival' ? festivals.get(source.source_id ?? '') : undefined
  const festivalVeil =
    festival === undefined
      ? null
      : festival.spoiler === true
        ? ('spoiler' as const)
        : festival.unreleased === true
          ? ('unreleased' as const)
          : null
  if (festival !== undefined && festivalVeil !== null && !spoilers.shown(festival.id)) {
    return (
      <li className="flex flex-wrap items-center gap-x-2 py-2 text-sm">
        <span className="text-ink">A festival stall</span>
        <button
          type="button"
          onClick={() => spoilers.reveal(festival.id)}
          className="tap-target inline-flex items-center gap-1.5"
        >
          <SpoilerChip size={18} reason={festivalVeil} />
          <span className="text-ink-faint text-xs">tap to show which</span>
        </button>
      </li>
    )
  }
  const stall = source.stall_key === null ? null : stallLabel(source.stall_key)

  const words =
    festival === undefined
      ? recipeSourceLabel(source.method)
      : // "Nora’s souvenir stall at the Animal Festival", falling back to
        // "A stall at the Animal Festival" when the stall has no label yet —
        // an internal token never renders raw.
        { lead: stall === null ? 'A stall at the ' : `${stall} at the `, standalone: '' }

  // The named thing, and where it links. The quest and the place have pages
  // of their own; a shop, a mine and a festival are named in place, and the
  // remaining methods read as the standalone phrase.
  const quest = quests.find((q) => q.id === source.source_id)
  const named: { text: string; to?: '/quest/$id' | '/place/$id'; id?: string } | null =
    source.method === 'shop' && source.source_id !== null
      ? { text: shops.get(source.source_id)?.name ?? titleCase(source.source_id) }
      : source.method === 'quest' && quest !== undefined
        ? { text: `“${quest.name}”`, to: '/quest/$id', id: quest.id }
        : source.method === 'mines_chest' && source.source_id !== null
          ? { text: mines.get(source.source_id)?.name ?? titleCase(source.source_id) }
          : source.method === 'treasure_chest' && source.source_id !== null
            ? // "A golden treasure box in the cave at The Beach" — the place
              // is the record; the cave is the sealed one its map pin marks.
              {
                text: index[source.source_id]?.n ?? titleCase(source.source_id),
                to: '/place/$id',
                id: source.source_id,
              }
            : source.method === 'perk' && source.source_id !== null
              ? // Perks are rows inside a skill record, not pages — named in
                // place; a title-cased id matches the perk's own title.
                { text: `${titleCase(source.source_id)} perk` }
              : festival !== undefined
                ? { text: festival.name }
                : null

  return (
    <li className="flex flex-wrap items-baseline gap-x-1.5 py-2 text-sm">
      <span className={inferred ? 'text-ink-mute' : 'text-ink'}>
        {named === null ? (
          words.standalone
        ) : (
          <>
            {words.lead}
            {named.to === undefined || named.id === undefined ? (
              named.text
            ) : (
              <Link
                to={named.to}
                params={{ id: named.id }}
                className="underline decoration-rule underline-offset-4"
              >
                {named.text}
              </Link>
            )}
          </>
        )}
        {/* The letter's sender, which is the only useful thing about a piece of
            post: "Nora sends it" beats "it arrives". */}
        {source.method === 'mail' && source.character_id !== null && (
          <> from {index[source.character_id]?.n ?? titleCase(source.character_id)}</>
        )}
      </span>

      {source.price !== null && (
        <span data-numeral className="text-ink-mute">
          — {source.price}
          {source.currency === 'tesserae' ? 't' : ` ${source.currency.replace(/_/g, ' ')}`}
        </span>
      )}

      {source.requires.length > 0 && (
        <span className="text-ink-mute text-xs">
          (<GateRun gates={source.requires} index={index} />)
        </span>
      )}

      {inferred && (
        <span className="unverified rounded-tile px-1.5 py-0.5 text-xs">
          inferred — no scroll for it exists in the game files
        </span>
      )}
    </li>
  )
}

/**
 * The places above, on the map.
 *
 * Moved here from the `/item/$id/where` screen when that screen was folded in.
 * Pins land on each opportunity's location; a single region focuses, several
 * show the whole valley. Rendered under the list because the list is the
 * answer and the map is where to point it — and skipped entirely when no
 * opportunity names a place, because an empty map answers nothing.
 */
function WhereMap({
  opportunities,
  locations,
  artUrl,
  onOpen,
}: {
  opportunities: { locationIds: string[] }[]
  locations: LocationLite[]
  artUrl: string | null
  onOpen: (placeId: string) => void
}) {
  const byId = new Map(locations.map((l) => [l.id, l]))
  // Every place across every window, deduplicated. This is where "three ponds
  // is three places to go" is actually answered — three pins, one row.
  const targets = [...new Set(opportunities.flatMap((o) => o.locationIds))]
    .map((locId) => byId.get(locId))
    .filter((l): l is LocationLite => l !== undefined)
  if (targets.length === 0) return null

  const regionOf = (l: LocationLite): string | null =>
    l.shape !== null ? l.id : (l.parent_id ?? null)
  const regionIds = [
    ...new Set(targets.flatMap((l) => (regionOf(l) === null ? [] : [regionOf(l)]))),
  ]
  const regions = locations
    .filter((l) => l.shape !== null)
    .map((l) => ({ id: l.id, name: l.name, shape: l.shape, anchor: l.anchor }))

  return (
    <div className="mt-4 rounded-card border border-rule bg-surface p-2">
      <ValleyMap
        viewBox="0 0 5442 3599"
        regions={regions}
        focusId={regionIds.length === 1 ? (regionIds[0] ?? null) : null}
        artUrl={artUrl}
        pins={targets.flatMap((l) =>
          l.anchor === null ? [] : [{ id: l.id, x: l.anchor.x, y: l.anchor.y, label: l.name }],
        )}
        onPinClick={onOpen}
      />
    </div>
  )
}
