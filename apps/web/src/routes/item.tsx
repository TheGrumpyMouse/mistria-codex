import { SEASONS } from '@mistria/schema'
import { getRouteApi, Link } from '@tanstack/react-router'
import { useEffect, useMemo, useState } from 'react'
import { Column } from '~/app/AppShell'
import { BackLink } from '~/components/BackLink'
import { FishShadow } from '~/components/FishShadow'
import { ItemIcon } from '~/components/ItemIcon'
import { NotRecorded, Section, Unknown } from '~/components/Section'
import { SpoilerAsk, SpoilerChip, veilReasonOf } from '~/components/Spoiler'
import {
  type DisplayIndex,
  loadDataset,
  loadDisplayIndex,
  loadItemRecord,
  loadRequestBoard,
} from '~/lib/data'
import { categoryLabelOne, METHOD_LABELS, requirementDisplay, WORN_ON_LABELS } from '~/lib/labels'
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
    time: { from: string; to: string }[] | null
    time_precision: string
    weather_precision: string
    rarity: string | null
    confidence: string
    requires: { type: string; key: string }[]
  }[]
}

interface RecipeRecord {
  id: string
  kind: string
  station: string | null
  station_level: number | null
  craft_minutes: number | null
  ingredients: { item_id: string | null; tag: string | null; quantity: number }[]
  output: { item_id: string | null; quantity: number }
}

interface GiftPrefs {
  character_id: string
  prefs: Record<string, string[]>
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
  stock: { item_id: string; rotation: boolean }[]
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
    names: Map<string, string>
    shops: Map<string, ShopRecord>
    recipes: RecipeRecord[]
    seals: SealRecord[]
    quests: QuestLite[]
    board: BoardRequest[]
    machines: MachineRecord[]
    fishFacets: FishFacetLite[]
    loading: boolean
  }>({
    item: null,
    index: {},
    prefs: [],
    names: new Map(),
    shops: new Map(),
    recipes: [],
    seals: [],
    quests: [],
    board: [],
    machines: [],
    fishFacets: [],
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
      loadDataset<{ id: string; name: string }>('locations'),
      loadDataset<ShopRecord>('shops'),
      loadDataset<RecipeRecord>('recipes'),
      loadDataset<SealRecord>('seals'),
      loadDataset<QuestLite>('quests'),
      loadDataset<MachineRecord>('machines'),
      loadDataset<FishFacetLite>('fish'),
      loadRequestBoard(),
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
          shops,
          recipes,
          seals,
          quests,
          machines,
          fishFacets,
          board,
          done,
        ]) => {
          if (!live) return
          setState({
            item,
            index,
            prefs,
            names: new Map(locations.map((l) => [l.id, l.name])),
            shops: new Map(shops.map((s) => [s.id, s])),
            recipes,
            seals,
            quests,
            board: board.requests,
            machines,
            fishFacets,
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
  const {
    item,
    index,
    prefs,
    names,
    shops,
    recipes,
    seals,
    quests,
    board,
    machines,
    fishFacets,
    loading,
  } = state

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
      out.push({
        domain: 'request',
        progressId: `${request.id}/${id}`,
        label:
          request.giver_name === null ? request.name : `${request.giver_name} — ${request.name}`,
        linkTo: { to: '/quest/$id', id: request.id },
        quantity: wanted.quantity,
        aboutId: request.id,
      })
    }
    return out
  }, [seals, quests, board, id])

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

      <Section title="Where to find it">
        {item.availability.length === 0 ? (
          <Unknown>No source recorded.</Unknown>
        ) : (
          <ul className="flex flex-col divide-y divide-rule border-rule border-y">
            {item.availability.map((window) => (
              // Keyed by what makes the window distinct rather than by its
              // position: an array index changes meaning the moment a window is
              // inserted, and these are ordered by the source, not by us.
              <li
                key={`${window.method}:${window.seasons.join()}:${window.locations.join()}`}
                className="py-2"
              >
                <p className="text-ink text-sm">
                  {METHOD_LABELS[window.method] ?? window.method}
                  {window.rarity !== null && window.rarity !== 'common' && (
                    <span className="text-ink-faint"> · {window.rarity.replace(/_/g, ' ')}</span>
                  )}
                </p>
                <p className="text-ink-mute text-xs">
                  {window.locations.map((l, i) => (
                    <span key={l}>
                      {i > 0 && ' · '}
                      <Link
                        to="/place/$id"
                        params={{ id: l }}
                        className="underline decoration-rule underline-offset-4 hover:text-ink"
                      >
                        {names.get(l) ?? l.replace(/_/g, ' ')}
                      </Link>
                    </span>
                  ))}
                  {window.requires.length > 0 && (
                    <span className="text-ink-faint">
                      {' — needs '}
                      {window.requires.map((r, i) => {
                        const parts = requirementDisplay(r, index[r.key]?.n)
                        return (
                          <span key={`${r.type}:${r.key}`}>
                            {i > 0 && ' and '}
                            {parts.prefix}
                            {parts.linkTo === null ? (
                              parts.label
                            ) : (
                              <Link
                                to={parts.linkTo.to}
                                params={{ id: parts.linkTo.id }}
                                className="underline decoration-rule underline-offset-2 hover:text-ink"
                              >
                                {parts.label}
                              </Link>
                            )}
                            {parts.suffix}
                          </span>
                        )
                      })}
                    </span>
                  )}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-1">
                  {SEASONS.filter((s) => window.seasons.includes(s)).map((season) => (
                    <span
                      key={season}
                      className="rounded-pill px-1.5 py-0.5 text-[0.625rem]"
                      style={{ background: `var(--${season}-tint)`, color: `var(--${season})` }}
                    >
                      {season}
                    </span>
                  ))}
                  {window.time === null
                    ? // Two different nulls. 'Not applicable' is a fact — dig
                      // spots sit there all day — and renders plainly; 'unknown'
                      // renders nothing, and data_gaps still records the hole.
                      window.time_precision === 'not_applicable' && (
                        <span className="rounded-tile px-1.5 py-0.5 text-[0.625rem] text-ink-faint">
                          any time
                        </span>
                      )
                    : window.time.map((range) => (
                        <span
                          key={`${range.from}-${range.to}`}
                          data-numeral
                          className="text-ink-faint text-[0.625rem]"
                        >
                          {range.from}–{range.to}
                        </span>
                      ))}
                  {/* An inference must never render identically to a fact. */}
                  {window.confidence === 'inferred' && (
                    <span className="unverified rounded-tile px-1.5 py-0.5 text-[0.625rem]">
                      place inferred
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}

        {/*
          The reverse lookup runs off the availability index the app has already
          downloaded, so offering it costs nothing — and it answers the question
          the list above raises: yes, but *where*, with the clock only where
          the method has one.
        */}
        {item.availability.length > 0 && (
          <p className="mt-2">
            <Link
              to="/item/$id/where"
              params={{ id: item.id }}
              className="tap-target text-ink-mute text-xs underline decoration-rule underline-offset-4 hover:text-ink"
            >
              Where can I get this? →
            </Link>
          </p>
        )}
      </Section>

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
            {recipe.craft_minutes !== null && (
              <>
                {recipe.station !== null ? ' · ' : ''}takes{' '}
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
              const rotates = shop.stock.some((line) => line.item_id === item.id && line.rotation)
              return (
                <li key={shopId} className="flex items-center gap-2.5">
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
                        <Link
                          to="/place/$id"
                          params={{ id: shop.location_id }}
                          className="underline decoration-rule underline-offset-4 hover:text-ink"
                        >
                          {names.get(shop.location_id) ?? shop.location_id.replace(/_/g, ' ')}
                        </Link>
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
                    {(days.length > 0 || rotates) && (
                      <span className="text-ink-faint">
                        {days.length > 0 && <> — {days.join(', ')} only</>}
                        {rotates && <> · rotating stock</>}
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
          <ul className="flex flex-col gap-1.5">
            {PREF_ORDER.filter((level) => opinions.has(level)).map((level) => (
              <li key={level} className="text-sm">
                <span className="text-ink capitalize">{level}</span>
                <span className="text-ink-mute">
                  {' — '}
                  {(opinions.get(level) ?? [])
                    .map((c) => ({ id: c, name: index[c]?.n ?? c.replace(/_/g, ' ') }))
                    .sort((a, b) => a.name.localeCompare(b.name))
                    .map((person, i) => (
                      <span key={person.id}>
                        {i > 0 && ', '}
                        <Link
                          to="/villager/$id"
                          params={{ id: person.id }}
                          className="underline decoration-rule underline-offset-4 hover:text-ink"
                        >
                          {person.name}
                        </Link>
                      </span>
                    ))}
                </span>
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
