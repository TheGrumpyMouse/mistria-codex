import { SEASONS } from '@mistria/schema'
import { getRouteApi, Link } from '@tanstack/react-router'
import { useEffect, useMemo, useState } from 'react'
import { Column } from '~/app/AppShell'
import { BackLink } from '~/components/BackLink'
import { ItemIcon } from '~/components/ItemIcon'
import { NotRecorded, Section, Unknown } from '~/components/Section'
import { type DisplayIndex, loadDataset, loadDisplayIndex } from '~/lib/data'
import { categoryLabelOne, METHOD_LABELS, requirementPhrase } from '~/lib/labels'

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
  icon_key: string | null
  category: string
  sell_value: number | null
  buy_value: number | null
  is_giftable: boolean | null
  data_gaps: string[]
  museum: { donatable: boolean; set_id: string | null; wing: string | null }
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

/** The four levels the wiki records, best first. */
const PREF_ORDER = ['loved', 'liked', 'neutral', 'disliked', 'hated'] as const

export function ItemRoute() {
  const { id } = route.useParams()
  const [state, setState] = useState<{
    item: ItemRecord | null
    index: DisplayIndex
    prefs: GiftPrefs[]
    names: Map<string, string>
    shopNames: Map<string, string>
    recipes: RecipeRecord[]
    loading: boolean
  }>({
    item: null,
    index: {},
    prefs: [],
    names: new Map(),
    shopNames: new Map(),
    recipes: [],
    loading: true,
  })

  useEffect(() => {
    let live = true
    Promise.all([
      loadDataset<ItemRecord>('items'),
      loadDisplayIndex(),
      loadDataset<GiftPrefs>('gift_prefs'),
      loadDataset<{ id: string; name: string }>('locations'),
      loadDataset<{ id: string; name: string }>('shops'),
      loadDataset<RecipeRecord>('recipes'),
    ])
      .then(([items, index, prefs, locations, shops, recipes]) => {
        if (!live) return
        setState({
          item: items.find((i) => i.id === id) ?? null,
          index,
          prefs,
          names: new Map(locations.map((l) => [l.id, l.name])),
          shopNames: new Map(shops.map((s) => [s.id, s.name])),
          recipes,
          loading: false,
        })
      })
      .catch(() => live && setState((s) => ({ ...s, loading: false })))
    return () => {
      live = false
    }
  }, [id])

  const { item, index, prefs, names, shopNames, recipes, loading } = state
  const recipe = item === null ? undefined : recipes.find((r) => r.output.item_id === item.id)

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

  return (
    <Column>
      <BackLink />
      <header className="flex items-center gap-3">
        <ItemIcon iconKey={item.icon_key ?? `item/${item.id}`} name={item.name} size="lg" />
        <div className="min-w-0">
          <h1 className="truncate text-2xl">{item.name}</h1>
          <p className="mt-0.5 text-ink-mute text-sm">
            {categoryLabelOne(item.category)}
            {item.sell_value !== null && (
              <>
                {' · sells for '}
                <span data-numeral>{item.sell_value}t</span>
              </>
            )}
          </p>
        </div>
      </header>

      {item.museum.donatable && (
        <p
          className="mt-3 rounded-card px-3 py-2 text-sm"
          style={{ background: 'var(--museum-tint)', color: 'var(--ink)' }}
        >
          <Link to="/museum" className="underline decoration-rule underline-offset-4">
            The museum wants this
          </Link>{' '}
          — {item.museum.wing?.replace(/_/g, ' ') ?? 'wing unknown'} wing.
        </p>
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
                  {window.locations.length === 0
                    ? 'place unknown'
                    : window.locations.map((l, i) => (
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
                      {window.requires.map((r) => requirementPhrase(r)).join(' and ')}
                    </span>
                  )}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-1">
                  {SEASONS.filter((s) => window.seasons.includes(s)).map((season) => (
                    <span
                      key={season}
                      className="rounded-pill px-1.5 py-0.5 text-[10px]"
                      style={{ background: `var(--${season}-tint)`, color: `var(--${season})` }}
                    >
                      {season}
                    </span>
                  ))}
                  {window.time === null ? (
                    // Two different nulls. 'Not applicable' is a fact — dig
                    // spots sit there all day — and renders plainly; 'unknown'
                    // keeps the dashed hedge, because nobody has checked.
                    window.time_precision === 'not_applicable' ? (
                      <span className="rounded-tile px-1.5 py-0.5 text-[10px] text-ink-faint">
                        any time
                      </span>
                    ) : (
                      <span className="unverified rounded-tile px-1.5 py-0.5 text-[10px]">
                        time unknown
                      </span>
                    )
                  ) : (
                    window.time.map((range) => (
                      <span
                        key={`${range.from}-${range.to}`}
                        data-numeral
                        className="text-ink-faint text-[10px]"
                      >
                        {range.from}–{range.to}
                      </span>
                    ))
                  )}
                  {/* An inference must never render identically to a fact. */}
                  {window.confidence === 'inferred' && (
                    <span className="unverified rounded-tile px-1.5 py-0.5 text-[10px]">
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
          the list above raises: yes, but *when*.
        */}
        {item.availability.length > 0 && (
          <p className="mt-2">
            <Link
              to="/item/$id/when"
              params={{ id: item.id }}
              className="text-ink-mute text-xs underline decoration-rule underline-offset-4 hover:text-ink"
            >
              When can I get this? →
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
                        iconKey={index[ingredient.item_id]?.i ?? `item/${ingredient.item_id}`}
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

      {/* Declared on the record since D3 and never rendered until now. There is
          no shop route yet, so the names stand alone — but "the General Store
          sells this" answers the question even without a page behind it. */}
      {item.sold_by.length > 0 && (
        <Section title="Sold by">
          <p className="text-ink-mute text-sm">
            {item.sold_by.map((shop) => shopNames.get(shop) ?? shop.replace(/_/g, ' ')).join(' · ')}
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
