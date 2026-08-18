import { getRouteApi, Link } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { Column } from '~/app/AppShell'
import { BackLink } from '~/components/BackLink'
import { GateRun } from '~/components/GateRun'
import { ItemIcon } from '~/components/ItemIcon'
import { PlaceLink } from '~/components/PlaceLink'
import { Section, Unknown } from '~/components/Section'
import { SpoilerChip, veilReasonOf } from '~/components/Spoiler'
import { type DisplayIndex, loadDataset, loadDisplayIndex } from '~/lib/data'
import { useDocumentTitle } from '~/lib/head'
import { gapLabels, type PlaceLabel, placeLabels, titleCase } from '~/lib/labels'
import { iconKeyFor } from '~/lib/search'
import { useSpoilers } from '~/lib/spoilers'

const route = getRouteApi('/shop/$id')

/**
 * One shop, and everything it will sell you.
 *
 * Three kinds of page share this route, because the shops list would be a lie
 * without them: the 14 shop records; the Souvenir Stall, whose stock is
 * festival goods rather than shop lines; and the two Saturday-Market challenge
 * boards, where nothing is for sale and the "stock" is quests that teach
 * recipes. The id decides which renderer answers.
 *
 * Product lines and recipe scrolls never share a section (§2c): the Inn sells
 * the Lemon Pie at 650 and the recipe for it at 400, and one list would print
 * two prices for what looks like one thing.
 */

interface Gate {
  type: string
  key: string
  op?: string
  value?: unknown
}

interface StockLine {
  item_id: string
  price: number | null
  currency: string
  requires: Gate[]
  seasons: string[] | null
  rotation: boolean
  teaches_recipe_id: string | null
}

interface ShopRecord {
  id: string
  name: string
  icon_key: string | null
  location_id: string | null
  owner_character_id: string | null
  staff_character_ids: string[]
  hours: { days: string[] }[]
  unlock_requires: Gate[]
  stock: StockLine[]
  data_gaps: string[]
}

interface QuestLite {
  id: string
  name: string
  kind: string
  giver_character_id: string | null
  required_items?: { item_id: string; quantity: number }[]
  /** The cooking challenges state their ask here — a delivery, not a cost. */
  objectives?: { type: string; target_id: string | null; quantity: number | null }[]
  teaches_recipe_ids?: string[]
}

interface RecipeLite {
  id: string
  output: { item_id: string | null } | null
}

interface FestivalLite {
  id: string
  name: string
  goods: { stall_key: string | null; item_id: string | null; teaches_recipe_id: string | null }[]
}

/** The two Saturday-Market boards. Their quests are the whole page. */
const BOARD_IDS = new Set(['stillwell', 'taliferro'])
const CHALLENGE_KINDS = new Set(['mission', 'cooking_challenge'])

/** An item chip that keeps the veil — a sprite is as much a spoiler as a name. */
function StockChip({
  id,
  index,
  prefix,
}: {
  id: string
  index: DisplayIndex
  prefix?: string | undefined
}) {
  const spoilers = useSpoilers()
  const veiled = veilReasonOf(index[id])
  if (veiled !== null && !spoilers.shown(id)) return <SpoilerChip reason={veiled} />
  const name = index[id]?.n ?? id.replace(/_/g, ' ')
  return (
    <Link
      to="/item/$id"
      params={{ id }}
      className="inline-flex items-center gap-1.5 rounded-tile border border-rule bg-surface py-0.5 pr-2 pl-1 text-ink text-sm transition-colors hover:bg-sunk"
    >
      <ItemIcon iconKey={iconKeyFor(id, index[id])} name={name} size="sm" />
      <span className="truncate">
        {prefix !== undefined && <span className="text-ink-mute">{prefix} </span>}
        {name}
      </span>
    </Link>
  )
}

/** A price with the coin. The `t` is the fact; the coin decorates (§4a). */
function Price({ amount }: { amount: number }) {
  return (
    <span className="inline-flex items-center gap-1 text-ink text-xs">
      <ItemIcon iconKey="ui/tesserae" name="tesserae" size="sm" />
      <span>
        <span data-numeral>{amount}</span>t
      </span>
    </span>
  )
}

/** One stock line: the chip, then the facts stated beside it. */
function StockRow({
  line,
  index,
  prefix,
}: {
  line: StockLine
  index: DisplayIndex
  prefix?: string
}) {
  return (
    <li className="flex flex-wrap items-center gap-x-2 gap-y-1 py-1">
      <StockChip id={line.item_id} index={index} prefix={prefix} />
      {/* A null price renders nothing — the header's gap note owns the hole. */}
      {line.price !== null && <Price amount={line.price} />}
      {line.requires.length > 0 && (
        <span className="text-xs" style={{ color: 'var(--locked)' }}>
          once you <GateRun gates={line.requires} index={index} />
        </span>
      )}
    </li>
  )
}

/** Group product lines by their stated seasons; year-round first. */
function seasonGroups(lines: StockLine[]): { label: string | null; lines: StockLine[] }[] {
  const keyOf = (line: StockLine): string =>
    line.seasons === null || line.seasons.length === 0 ? '' : line.seasons.join('_')
  const groups = new Map<string, StockLine[]>()
  for (const line of lines) {
    const key = keyOf(line)
    groups.set(key, [...(groups.get(key) ?? []), line])
  }
  const order = (key: string): number => (key === '' ? 0 : 1)
  return [...groups.entries()]
    .sort((a, b) => order(a[0]) - order(b[0]) || a[0].localeCompare(b[0]))
    .map(([key, grouped]) => ({
      label: key === '' ? null : key.split('_').map(titleCase).join(', '),
      lines: grouped.sort((a, b) => a.item_id.localeCompare(b.item_id)),
    }))
}

export function ShopRoute() {
  const { id } = route.useParams()
  const [state, setState] = useState<{
    shop: ShopRecord | null
    quests: QuestLite[]
    recipes: Map<string, RecipeLite>
    festivals: FestivalLite[]
    places: Map<string, PlaceLabel>
    index: DisplayIndex
    loading: boolean
  }>({
    shop: null,
    quests: [],
    recipes: new Map(),
    festivals: [],
    places: new Map(),
    index: {},
    loading: true,
  })

  useEffect(() => {
    let live = true
    const wants = BOARD_IDS.has(id)
      ? Promise.all([
          Promise.resolve<ShopRecord | null>(null),
          loadDataset<QuestLite>('quests'),
          loadDataset<RecipeLite>('recipes'),
          Promise.resolve<FestivalLite[]>([]),
        ])
      : id === 'souvenir_stall'
        ? Promise.all([
            Promise.resolve<ShopRecord | null>(null),
            Promise.resolve<QuestLite[]>([]),
            Promise.resolve<RecipeLite[]>([]),
            loadDataset<FestivalLite>('festivals'),
          ])
        : Promise.all([
            loadDataset<ShopRecord>('shops').then(
              (shops) => shops.find((s) => s.id === id) ?? null,
            ),
            Promise.resolve<QuestLite[]>([]),
            Promise.resolve<RecipeLite[]>([]),
            Promise.resolve<FestivalLite[]>([]),
          ])
    Promise.all([wants, loadDisplayIndex(), loadDataset<{ id: string; name: string }>('locations')])
      .then(([[shop, quests, recipes, festivals], index, locations]) => {
        if (!live) return
        setState({
          shop,
          quests,
          recipes: new Map(recipes.map((r) => [r.id, r])),
          festivals,
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

  const { shop, quests, recipes, festivals, places, index, loading } = state
  const boardName = BOARD_IDS.has(id) ? (index[id]?.n ?? null) : null
  useDocumentTitle(
    shop?.name ??
      (boardName !== null ? `${boardName}’s challenges` : null) ??
      (id === 'souvenir_stall' ? 'Souvenir Stall' : null),
  )

  if (loading) {
    return (
      <Column>
        <p className="text-ink-mute text-sm">Loading…</p>
      </Column>
    )
  }

  // ── The challenge boards ──────────────────────────────────────────────────
  if (BOARD_IDS.has(id) && boardName !== null) {
    const challenges = quests
      .filter((q) => q.giver_character_id === id && CHALLENGE_KINDS.has(q.kind))
      .sort((a, b) => a.name.localeCompare(b.name))
    return (
      <Column>
        <BackLink />
        <header className="flex items-center gap-3">
          <ItemIcon iconKey={iconKeyFor(id, index[id])} name={boardName} size="lg" />
          <div className="min-w-0">
            <h1 className="truncate text-2xl">{boardName}’s challenges</h1>
            <p className="mt-0.5 text-ink-mute text-sm">
              A Saturday Market board — nothing is for sale;{' '}
              <Link
                to="/villager/$id"
                params={{ id }}
                className="underline decoration-rule underline-offset-4 hover:text-ink"
              >
                {boardName}
              </Link>{' '}
              posts challenges, and finishing one teaches a recipe.
            </p>
          </div>
        </header>
        {challenges.length > 0 ? (
          <Section title="Challenges">
            <ul className="flex flex-col gap-2">
              {challenges.map((quest) => (
                <li key={quest.id} className="text-sm">
                  <Link
                    to="/quest/$id"
                    params={{ id: quest.id }}
                    className="text-ink underline decoration-rule underline-offset-4 hover:text-ink"
                  >
                    {quest.name}
                  </Link>
                  <span className="mt-1 flex flex-wrap items-center gap-1.5">
                    {/* Stillwell's hunts state a cost; Taliferro's cooking
                        challenges state a delivery objective. Same ask to a
                        player, two shapes in the data. */}
                    {[
                      ...(quest.required_items ?? []),
                      ...(quest.objectives ?? [])
                        .filter((o) => o.type === 'deliver' && o.target_id !== null)
                        .map((o) => ({ item_id: o.target_id ?? '', quantity: o.quantity ?? 1 })),
                    ].map((wanted) => (
                      <span key={wanted.item_id} className="inline-flex items-center gap-1">
                        <StockChip id={wanted.item_id} index={index} prefix="bring:" />
                        {wanted.quantity > 1 && (
                          <span className="text-ink-faint text-xs">×{wanted.quantity}</span>
                        )}
                      </span>
                    ))}
                    {(quest.teaches_recipe_ids ?? []).map((recipeId) => {
                      const product = recipes.get(recipeId)?.output?.item_id
                      return product == null ? null : (
                        <StockChip key={recipeId} id={product} index={index} prefix="recipe:" />
                      )
                    })}
                  </span>
                </li>
              ))}
            </ul>
          </Section>
        ) : (
          <Unknown>No challenges recorded yet.</Unknown>
        )}
      </Column>
    )
  }

  // ── The Souvenir Stall ────────────────────────────────────────────────────
  if (id === 'souvenir_stall') {
    const withGoods = festivals
      .map((festival) => ({
        festival,
        goods: festival.goods.filter((good) => good.stall_key === 'nora_souvenir_stall'),
      }))
      .filter((entry) => entry.goods.length > 0)
    return (
      <Column>
        <BackLink />
        <header className="flex items-center gap-3">
          <ItemIcon iconKey={iconKeyFor('nora', index.nora)} name="Souvenir Stall" size="lg" />
          <div className="min-w-0">
            <h1 className="truncate text-2xl">Souvenir Stall</h1>
            <p className="mt-0.5 text-ink-mute text-sm">
              Nora’s stall, set up on festival days — what it carries depends on the festival.
            </p>
          </div>
        </header>
        {withGoods.length === 0 && <Unknown>No stall goods recorded yet.</Unknown>}
        {withGoods.map(({ festival, goods }) => {
          const veiled = veilReasonOf(index[festival.id])
          return (
            <Section key={festival.id} title={veiled === null ? festival.name : 'A festival'}>
              {veiled !== null ? (
                // The festival's name is the spoiler, and its goods would name
                // it just as loudly — the whole group waits behind its page.
                <SpoilerChip reason={veiled} />
              ) : (
                <>
                  <ul className="flex flex-wrap gap-1.5">
                    {goods.map((good) =>
                      good.item_id === null ? null : (
                        <li key={good.item_id}>
                          <StockChip id={good.item_id} index={index} />
                        </li>
                      ),
                    )}
                  </ul>
                  <p className="mt-1.5 text-ink-faint text-xs">
                    <Link
                      to="/festival/$id"
                      params={{ id: festival.id }}
                      className="underline decoration-rule underline-offset-4 hover:text-ink"
                    >
                      More about the {festival.name}
                    </Link>
                  </p>
                </>
              )}
            </Section>
          )
        })}
      </Column>
    )
  }

  // ── A shop record ─────────────────────────────────────────────────────────
  if (shop === null) {
    return (
      <Column>
        <h1 className="text-2xl">Not found</h1>
        <p className="mt-1 text-ink-mute text-sm">
          Nothing here goes by “{id.replace(/_/g, ' ')}”.{' '}
          <Link to="/shops" className="underline decoration-rule underline-offset-4">
            Back to the shops
          </Link>
          .
        </p>
      </Column>
    )
  }

  const gaps = gapLabels(shop.data_gaps)
  const staff = shop.staff_character_ids.filter((person) => person !== shop.owner_character_id)
  const saturdays = shop.hours.length > 0
  const rotating = shop.stock.some((line) => line.rotation)
  const products = shop.stock.filter((line) => line.teaches_recipe_id === null)
  const scrolls = shop.stock.filter((line) => line.teaches_recipe_id !== null)
  const groups = seasonGroups(products)

  return (
    <Column>
      <BackLink />
      <header className="flex items-center gap-3">
        <ItemIcon iconKey={shop.icon_key ?? `shop/${shop.id}`} name={shop.name} size="lg" />
        <div className="min-w-0">
          <h1 className="truncate text-2xl">{shop.name}</h1>
          <p className="mt-0.5 text-ink-mute text-sm">
            A shop
            {shop.location_id !== null && (
              <>
                {' · in '}
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
                  {index[shop.owner_character_id]?.n ?? shop.owner_character_id.replace(/_/g, ' ')}
                </Link>
              </>
            )}
            {staff.length > 0 && (
              <>
                {' with '}
                {staff.map((person, i) => (
                  <span key={person}>
                    {i > 0 && ' and '}
                    <Link
                      to="/villager/$id"
                      params={{ id: person }}
                      className="underline decoration-rule underline-offset-4 hover:text-ink"
                    >
                      {index[person]?.n ?? person.replace(/_/g, ' ')}
                    </Link>
                  </span>
                ))}
              </>
            )}
            {saturdays && <span className="text-ink-faint"> · Saturdays only</span>}
          </p>
        </div>
      </header>

      {shop.unlock_requires.length > 0 && (
        <p className="text-xs" style={{ color: 'var(--locked)' }}>
          The stall opens once you <GateRun gates={shop.unlock_requires} index={index} />.
        </p>
      )}
      {rotating && (
        <p className="text-ink-faint text-xs">
          Rotating stock — each visit carries a changing selection drawn from this list.
        </p>
      )}
      {gaps.length > 0 && (
        <p className="text-ink-faint text-xs">Not recorded yet: {gaps.join(', ')}.</p>
      )}

      {products.length > 0 && (
        <Section title="Stock">
          {groups.map((group) => (
            <div key={group.label ?? 'year-round'} className="mt-2 first:mt-0">
              {group.label !== null && (
                <h3 className="mb-0.5 font-display font-semibold text-ink text-sm">
                  {group.label}
                </h3>
              )}
              <ul className="flex flex-col">
                {group.lines.map((line) => (
                  // Within one season group an item can still appear twice —
                  // behind two different gates — so the gates join the key.
                  <StockRow
                    key={`${line.item_id}:${line.requires.map((g) => `${g.type}=${g.key}`).join('+')}`}
                    line={line}
                    index={index}
                  />
                ))}
              </ul>
            </div>
          ))}
        </Section>
      )}

      {scrolls.length > 0 && (
        <Section title="Recipes taught">
          {/* The scroll, not the dish — §2c. The chip links the product the
              recipe makes; the price is the scroll's own. */}
          <ul className="flex flex-col">
            {scrolls.map((line) => (
              <StockRow key={`${line.item_id}-recipe`} line={line} index={index} prefix="recipe:" />
            ))}
          </ul>
        </Section>
      )}

      {products.length === 0 && scrolls.length === 0 && <Unknown>No stock recorded yet.</Unknown>}
    </Column>
  )
}
