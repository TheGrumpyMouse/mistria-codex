import { getRouteApi, Link } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { Column } from '~/app/AppShell'
import { BackLink } from '~/components/BackLink'
import { ItemIcon } from '~/components/ItemIcon'
import { PlaceLink } from '~/components/PlaceLink'
import { Section, Unknown } from '~/components/Section'
import { SpoilerAsk, veilReasonOf } from '~/components/Spoiler'
import { type DisplayIndex, loadDataset, loadDisplayIndex } from '~/lib/data'
import { useDocumentTitle } from '~/lib/head'
import {
  FESTIVAL_ACTIVITY_LABELS,
  gapLabels,
  type PlaceLabel,
  placeLabels,
  type Requirement,
  requirementPhrase,
  titleCase,
} from '~/lib/labels'
import { iconKeyFor } from '~/lib/search'
import { useSpoilers } from '~/lib/spoilers'

const route = getRouteApi('/festival/$id')

/**
 * One festival: when, where, what happens, and what the stalls sell.
 *
 * The goods list is the game's own stall stock (`festivals.toml`), resolved at
 * build time against the records that ship — see the `goods` field on the
 * Festival schema. The six festivals the wiki describes but the game does not
 * run keep their pages behind the unreleased veil, and even revealed they wear
 * the "not yet in the game" badge: a date someone can plan around must not
 * come from a festival that never fires.
 */

interface FestivalGood {
  stall_key: string | null
  item_id: string | null
  teaches_recipe_id: string | null
}

interface FestivalRecord {
  id: string
  name: string
  icon_key: string | null
  date: { season: string; day: number } | null
  implemented: boolean
  unreleased?: boolean
  location_id: string | null
  currency_item_id: string | null
  activities: string[]
  rewards: string[]
  prerequisites: Requirement[]
  goods: FestivalGood[]
  data_gaps: string[]
}

interface RecipeLite {
  id: string
  name: string
  output: { item_id: string } | null
}

function ItemChip({ id, index, prefix }: { id: string; index: DisplayIndex; prefix?: string }) {
  return (
    <Link
      to="/item/$id"
      params={{ id }}
      className="inline-flex items-center gap-1.5 rounded-tile border border-rule bg-surface py-0.5 pr-2 pl-1 text-ink text-sm transition-colors hover:bg-sunk"
    >
      <ItemIcon iconKey={iconKeyFor(id, index[id])} name={index[id]?.n ?? id} size="sm" />
      <span className="truncate">
        {prefix !== undefined && <span className="text-ink-mute">{prefix} </span>}
        {index[id]?.n ?? id.replace(/_/g, ' ')}
      </span>
    </Link>
  )
}

export function FestivalRoute() {
  const { id } = route.useParams()
  const spoilers = useSpoilers()
  const [state, setState] = useState<{
    festival: FestivalRecord | null
    recipes: Map<string, RecipeLite>
    places: Map<string, PlaceLabel>
    index: DisplayIndex
    loading: boolean
  }>({ festival: null, recipes: new Map(), places: new Map(), index: {}, loading: true })

  useEffect(() => {
    let live = true
    loadDataset<FestivalRecord>('festivals')
      .then(async (festivals) => {
        const festival = festivals.find((f) => f.id === id) ?? null
        // The recipe names are only needed when a stall teaches one — most
        // festivals sell things, not scrolls, and 867 recipes is a fetch this
        // page usually has no use for.
        const wantsRecipes = festival?.goods.some((g) => g.teaches_recipe_id !== null) ?? false
        const [index, locations, recipes] = await Promise.all([
          loadDisplayIndex(),
          loadDataset<{ id: string; name: string }>('locations'),
          wantsRecipes ? loadDataset<RecipeLite>('recipes') : Promise.resolve([]),
        ])
        if (!live) return
        setState({
          festival,
          recipes: new Map(recipes.map((r) => [r.id, r])),
          places: placeLabels(locations, []),
          index,
          loading: false,
        })
      })
      .catch(() => live && setState((s) => ({ ...s, loading: false })))
    return () => {
      live = false
    }
  }, [id])

  const { festival, recipes, places, index, loading } = state
  const veil = festival === null ? null : veilReasonOf(index[festival.id])
  const veiled = festival !== null && veil !== null && !spoilers.shown(festival.id)
  useDocumentTitle(festival === null || veiled ? null : festival.name)

  if (loading) {
    return (
      <Column>
        <p className="text-ink-mute text-sm">Loading…</p>
      </Column>
    )
  }

  if (festival === null) {
    return (
      <Column>
        <h1 className="text-2xl">Not found</h1>
        <p className="mt-1 text-ink-mute text-sm">
          Nothing here goes by “{id.replace(/_/g, ' ')}”.{' '}
          <Link to="/" className="underline decoration-rule underline-offset-4">
            Back to the calendar
          </Link>
          .
        </p>
      </Column>
    )
  }

  if (veiled) {
    return (
      <Column>
        <BackLink />
        <SpoilerAsk id={festival.id} kind="festival" reason={veil ?? 'unreleased'} />
      </Column>
    )
  }

  const gaps = gapLabels(festival.data_gaps)
  const activities = festival.activities
    .map((token) => FESTIVAL_ACTIVITY_LABELS[token])
    .filter((label): label is string => label !== undefined)

  // Grouped by stall, in a stable order; goods with no stall come last under
  // no heading rather than under a made-up one.
  const byStall = new Map<string | null, FestivalGood[]>()
  for (const good of festival.goods) {
    byStall.set(good.stall_key, [...(byStall.get(good.stall_key) ?? []), good])
  }
  const stalls = [...byStall.keys()].sort((a, b) => (a ?? '￿').localeCompare(b ?? '￿'))

  return (
    <Column>
      <BackLink />
      <header className="flex items-center gap-3">
        <ItemIcon
          iconKey={festival.icon_key ?? `festival/${festival.id}`}
          name={festival.name}
          size="lg"
        />
        <div className="min-w-0">
          <h1 className="truncate text-2xl">{festival.name}</h1>
          <p className="mt-0.5 text-ink-mute text-sm">
            A festival
            {festival.date !== null && (
              <>
                {' · '}
                {titleCase(festival.date.season)} <span data-numeral>{festival.date.day}</span>
              </>
            )}
            {festival.location_id !== null && (
              <>
                {' · at '}
                <PlaceLink
                  id={festival.location_id}
                  places={places}
                  className="underline decoration-rule underline-offset-4 hover:text-ink"
                />
              </>
            )}
            {!festival.implemented && (
              <span className="unverified ml-2 rounded-tile px-1.5 py-0.5 text-[0.625rem]">
                not yet in the game
              </span>
            )}
          </p>
        </div>
      </header>

      {gaps.length > 0 && (
        <p className="text-ink-faint text-xs">Not recorded yet: {gaps.join(', ')}.</p>
      )}

      {(activities.length > 0 ||
        festival.currency_item_id !== null ||
        festival.prerequisites.length > 0) && (
        <Section title="On the day">
          {activities.length > 0 && (
            <p className="text-ink text-sm leading-relaxed">{activities.join(' · ')}</p>
          )}
          {festival.currency_item_id !== null && (
            <p className="mt-1.5 flex items-center gap-1.5 text-ink-mute text-sm">
              The stalls trade in <ItemChip id={festival.currency_item_id} index={index} />
            </p>
          )}
          {festival.prerequisites.length > 0 && (
            <p className="mt-1.5 text-ink-mute text-sm">
              Happens once you{' '}
              {festival.prerequisites.map((r) => requirementPhrase(r)).join(' and ')}.
            </p>
          )}
        </Section>
      )}

      {festival.goods.length > 0 && (
        <Section title="At the stalls">
          {stalls.map((stall) => (
            <div key={stall ?? 'unstalled'} className="mt-2 first:mt-0">
              {stall !== null && (
                <h3 className="mb-1 font-display font-semibold text-ink text-sm">
                  {titleCase(stall)}
                </h3>
              )}
              <ul className="flex flex-wrap gap-1.5">
                {(byStall.get(stall) ?? []).map((good) => {
                  if (good.item_id !== null) {
                    return (
                      <li key={`${good.item_id}-item`}>
                        <ItemChip id={good.item_id} index={index} />
                      </li>
                    )
                  }
                  if (good.teaches_recipe_id !== null) {
                    const recipe = recipes.get(good.teaches_recipe_id)
                    const productId = recipe?.output?.item_id
                    return productId === undefined ? null : (
                      // The scroll, not the dish — the same two-things rule as
                      // the shop stock lines.
                      <li key={`${good.teaches_recipe_id}-recipe`}>
                        <ItemChip id={productId} index={index} prefix="recipe:" />
                      </li>
                    )
                  }
                  return null
                })}
              </ul>
            </div>
          ))}
        </Section>
      )}

      {festival.rewards.length > 0 && (
        <Section title="Rewards">
          <ul className="flex flex-wrap gap-1.5">
            {festival.rewards.map((itemId) => (
              <li key={itemId}>
                <ItemChip id={itemId} index={index} />
              </li>
            ))}
          </ul>
        </Section>
      )}

      {festival.id === 'animal_festival' && (
        <Section title="Scoring">
          <p className="text-ink-mute text-sm leading-relaxed">
            Entries are judged on the animal's colour tier and its hearts — the point tables are on
            the{' '}
            <Link
              to="/ranch"
              className="underline decoration-rule underline-offset-4 hover:text-ink"
            >
              Ranch screen
            </Link>
            .
          </p>
        </Section>
      )}

      {festival.goods.length === 0 && festival.rewards.length === 0 && activities.length === 0 && (
        <Unknown>
          Nothing recorded about the day itself yet — the date{' '}
          {festival.implemented ? 'is' : 'would be'} the one stated fact.
        </Unknown>
      )}
    </Column>
  )
}
