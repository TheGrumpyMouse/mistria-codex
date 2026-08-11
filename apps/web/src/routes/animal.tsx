import { getRouteApi, Link } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { Column } from '~/app/AppShell'
import { BackLink } from '~/components/BackLink'
import { ItemIcon } from '~/components/ItemIcon'
import { Section, Unknown } from '~/components/Section'
import { type DisplayIndex, loadDataset, loadDisplayIndex } from '~/lib/data'
import { useDocumentTitle } from '~/lib/head'
import {
  FEED_KIND_LABELS,
  PETTING_LABELS,
  type Requirement,
  requirementDisplay,
  titleCase,
} from '~/lib/labels'
import { iconKeyFor } from '~/lib/search'

const route = getRouteApi('/animal/$id')

/**
 * One ranch animal: what it makes, what its colours are, and what it costs.
 *
 * Everything numeric here is the game's own ranching table, per sex where the
 * game states a difference — a hen lays daily, a rooster moults a feather
 * every three days, and collapsing those into one row was the old dataset's
 * whole gap. The tier sell multipliers exist in the data but not on this page:
 * their index semantics are unverified, and an absent number beats a possibly
 * wrong one.
 */

interface AnimalProduct {
  item_id: string
  sex: 'male' | 'female' | null
  days_to_produce: number | null
  hearts_required: number | null
  quality: string | null
}

interface AnimalVariant {
  key: string
  name: string | null
  tier: number
  born_in: string[]
  purchasable: boolean
  acquirable: boolean
  default_cosmetic_item_id: string | null
}

interface AnimalRecord {
  id: string
  name: string
  icon_key: string | null
  building: 'coop' | 'barn'
  matures_days: number | null
  products: AnimalProduct[]
  breeding: {
    treat_item_id: string | null
    gestation_days: number | null
    uses_egg: boolean | null
    incubation_days: number | null
  } | null
  feed_item_ids: string[]
  purchase: {
    price: number
    shop_id: string
    requires: Requirement[]
    available_from: { season: string; day: number; year: number } | null
  } | null
  sell: { baby: number | null; adult_by_heart: number[] } | null
  variants: AnimalVariant[]
  is_mount: boolean | null
  petting: { kind: 'pet' | 'pick_up'; stamina_cost: number | null } | null
  eats: 'seed' | 'hay' | null
}

interface RanchRulesLite {
  min_hearts_to_breed: number | null
}

const SEX_LABELS = { male: 'males', female: 'females' } as const
const ALL_SEASONS = ['spring', 'summer', 'fall', 'winter']

const everyDays = (days: number | null): string | null =>
  days === null ? null : days === 1 ? 'daily' : `every ${days} days`

function ItemChip({ id, index }: { id: string; index: DisplayIndex }) {
  return (
    <Link
      to="/item/$id"
      params={{ id }}
      className="inline-flex items-center gap-1.5 rounded-tile border border-rule bg-surface py-0.5 pr-2 pl-1 text-ink text-sm transition-colors hover:bg-sunk"
    >
      <ItemIcon iconKey={iconKeyFor(id, index[id])} name={index[id]?.n ?? id} size="sm" />
      <span className="truncate">{index[id]?.n ?? id.replace(/_/g, ' ')}</span>
    </Link>
  )
}

export function AnimalRoute() {
  const { id } = route.useParams()
  const [state, setState] = useState<{
    animal: AnimalRecord | null
    rules: RanchRulesLite | null
    shopNames: Map<string, string>
    index: DisplayIndex
    loading: boolean
  }>({ animal: null, rules: null, shopNames: new Map(), index: {}, loading: true })

  useEffect(() => {
    let live = true
    Promise.all([
      loadDataset<AnimalRecord>('animals'),
      loadDataset<RanchRulesLite>('ranching'),
      loadDataset<{ id: string; name: string }>('shops'),
      loadDisplayIndex(),
    ])
      .then(([animals, ranching, shops, index]) => {
        if (!live) return
        setState({
          animal: animals.find((a) => a.id === id) ?? null,
          rules: ranching[0] ?? null,
          shopNames: new Map(shops.map((s) => [s.id, s.name])),
          index,
          loading: false,
        })
      })
      .catch(() => live && setState((s) => ({ ...s, loading: false })))
    return () => {
      live = false
    }
  }, [id])

  const { animal, rules, shopNames, index, loading } = state
  useDocumentTitle(animal?.name ?? null)

  if (loading) {
    return (
      <Column>
        <p className="text-ink-mute text-sm">Loading…</p>
      </Column>
    )
  }

  if (animal === null) {
    return (
      <Column>
        <h1 className="text-2xl">Not found</h1>
        <p className="mt-1 text-ink-mute text-sm">
          Nothing here goes by “{id.replace(/_/g, ' ')}”.{' '}
          <Link to="/ranch" className="underline decoration-rule underline-offset-4">
            Back to the Ranch
          </Link>
          .
        </p>
      </Column>
    )
  }

  const byTier = new Map<number, AnimalVariant[]>()
  for (const variant of animal.variants) {
    if (!variant.acquirable) continue
    byTier.set(variant.tier, [...(byTier.get(variant.tier) ?? []), variant])
  }
  // The non-acquirable oddities (the horse's Big Chicken) are real content and
  // "locked is shown, not hidden" applies — they get their own line below.
  const unobtainable = animal.variants.filter((v) => !v.acquirable)

  return (
    <Column>
      <BackLink />
      <header className="flex items-center gap-3">
        <ItemIcon iconKey={animal.icon_key ?? `animal/${animal.id}`} name={animal.name} size="lg" />
        <div className="min-w-0">
          <h1 className="truncate text-2xl">{animal.name}</h1>
          <p className="mt-0.5 text-ink-mute text-sm">
            {animal.building === 'coop' ? 'Lives in a coop' : 'Lives in a barn'}
            {animal.eats !== null && <> · eats {FEED_KIND_LABELS[animal.eats]}</>}
            {animal.is_mount === true && <> · can be ridden</>}
          </p>
        </div>
      </header>

      <Section title="Produce">
        {animal.products.length === 0 ? (
          <Unknown>No produce recorded.</Unknown>
        ) : (
          <ul className="flex flex-col divide-y divide-rule border-rule border-y">
            {animal.products.map((product) => (
              <li
                key={`${product.item_id}:${product.sex ?? 'both'}`}
                className="flex items-center gap-3 py-2"
              >
                <ItemIcon
                  iconKey={iconKeyFor(product.item_id, index[product.item_id])}
                  name={index[product.item_id]?.n ?? product.item_id}
                  size="sm"
                />
                <span className="min-w-0 flex-1">
                  <Link
                    to="/item/$id"
                    params={{ id: product.item_id }}
                    className="text-ink text-sm underline decoration-rule underline-offset-4 hover:text-ink"
                  >
                    {index[product.item_id]?.n ?? product.item_id.replace(/_/g, ' ')}
                  </Link>
                  <span className="block text-ink-faint text-xs">
                    {product.sex !== null && <>{SEX_LABELS[product.sex]}, </>}
                    {everyDays(product.days_to_produce) ?? 'rate unknown'}
                  </span>
                </span>
                {product.quality === 'golden' && product.hearts_required !== null && (
                  <span data-numeral className="shrink-0 text-ink-faint text-xs">
                    from {product.hearts_required}♥
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Buying & selling">
        {animal.purchase === null ? (
          <Unknown>No price recorded.</Unknown>
        ) : (
          <div className="text-ink-mute text-sm leading-relaxed">
            <p>
              <span className="text-ink" data-numeral>
                {animal.purchase.price}t
              </span>{' '}
              at {shopNames.get(animal.purchase.shop_id) ?? titleCase(animal.purchase.shop_id)}
              {animal.purchase.available_from !== null && (
                <>
                  {', from '}
                  <span className="text-ink">
                    {titleCase(animal.purchase.available_from.season)}{' '}
                    <span data-numeral>{animal.purchase.available_from.day}</span> of year{' '}
                    <span data-numeral>{animal.purchase.available_from.year}</span>
                  </span>
                </>
              )}
              .
            </p>
            {animal.purchase.requires.map((req) => {
              const parts = requirementDisplay(req, index[req.key]?.n)
              return (
                <p key={`${req.type}:${req.key}`} className="mt-0.5">
                  Unlocked once you {parts.prefix}
                  {parts.linkTo === null ? (
                    parts.label
                  ) : (
                    <Link
                      to={parts.linkTo.to}
                      params={{ id: parts.linkTo.id }}
                      className="underline decoration-rule underline-offset-4 hover:text-ink"
                    >
                      {parts.label}
                    </Link>
                  )}
                  {parts.suffix}.
                </p>
              )
            })}
          </div>
        )}
        {animal.sell !== null && animal.sell.adult_by_heart.length > 0 && (
          <>
            <h3 className="mt-3 font-display font-semibold text-ink text-sm">Sells for</h3>
            <p className="mt-1 text-ink-mute text-sm">
              {animal.sell.baby !== null && (
                <>
                  A baby brings <span data-numeral>{animal.sell.baby}t</span>; an adult rises with
                  hearts —{' '}
                </>
              )}
              <span data-numeral>{animal.sell.adult_by_heart[0]}t</span> at 0♥ to{' '}
              <span data-numeral>
                {animal.sell.adult_by_heart[animal.sell.adult_by_heart.length - 1]}t
              </span>{' '}
              at {animal.sell.adult_by_heart.length - 1}♥. Rarer colours sell for more.
            </p>
          </>
        )}
      </Section>

      <Section title="Breeding & care">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          {animal.breeding?.treat_item_id != null && (
            <>
              <dt className="text-ink-mute">Breeding treat</dt>
              <dd>
                <ItemChip id={animal.breeding.treat_item_id} index={index} />
              </dd>
            </>
          )}
          {rules?.min_hearts_to_breed != null && (
            <>
              <dt className="text-ink-mute">Breeds from</dt>
              <dd className="text-ink" data-numeral>
                {rules.min_hearts_to_breed}♥ (both parents)
              </dd>
            </>
          )}
          {animal.breeding?.uses_egg === true && animal.breeding.incubation_days !== null && (
            <>
              <dt className="text-ink-mute">Egg hatches in</dt>
              <dd className="text-ink" data-numeral>
                {animal.breeding.incubation_days} days
              </dd>
            </>
          )}
          {animal.breeding?.uses_egg === false && animal.breeding.gestation_days !== null && (
            <>
              <dt className="text-ink-mute">Baby arrives in</dt>
              <dd className="text-ink" data-numeral>
                {animal.breeding.gestation_days} days
              </dd>
            </>
          )}
          {animal.matures_days !== null && (
            <>
              <dt className="text-ink-mute">Grows up in</dt>
              <dd className="text-ink" data-numeral>
                {animal.matures_days} days
              </dd>
            </>
          )}
          {animal.petting !== null && (
            <>
              <dt className="text-ink-mute">Affection</dt>
              <dd className="text-ink">likes being {PETTING_LABELS[animal.petting.kind]}</dd>
            </>
          )}
        </dl>
        {animal.feed_item_ids.length > 0 && (
          <>
            <h3 className="mt-3 font-display font-semibold text-ink text-sm">Eats</h3>
            <ul className="mt-1.5 flex flex-wrap gap-1.5">
              {animal.feed_item_ids.map((feedId) => (
                <li key={feedId}>
                  <ItemChip id={feedId} index={index} />
                </li>
              ))}
            </ul>
          </>
        )}
      </Section>

      {animal.variants.length > 0 && (
        <Section title="Colours">
          <p className="max-w-prose text-ink-mute text-sm leading-relaxed">
            Higher tiers are rarer, sell for more, and score higher at the Animal Festival. A colour
            Hayden doesn't stock has to be bred.
          </p>
          {[...byTier.keys()]
            .sort((a, b) => a - b)
            .map((tier) => (
              <div key={tier} className="mt-2.5">
                <h3 className="font-display font-semibold text-ink text-sm">
                  Tier <span data-numeral>{tier}</span>
                </h3>
                <ul className="mt-1 flex flex-col gap-0.5 text-sm">
                  {(byTier.get(tier) ?? []).map((variant) => (
                    <li key={variant.key} className="flex flex-wrap items-baseline gap-x-2">
                      <span className="text-ink">{variant.name ?? titleCase(variant.key)}</span>
                      <span className="text-ink-faint text-xs">
                        {variant.purchasable ? "at Hayden's" : 'bred only'}
                        {variant.born_in.length > 0 &&
                          variant.born_in.length < ALL_SEASONS.length && (
                            <> · born in {variant.born_in.map(titleCase).join(', ')}</>
                          )}
                      </span>
                      {variant.default_cosmetic_item_id !== null && (
                        <span className="text-ink-faint text-xs">
                          born wearing{' '}
                          <Link
                            to="/item/$id"
                            params={{ id: variant.default_cosmetic_item_id }}
                            className="underline decoration-rule underline-offset-4 hover:text-ink"
                          >
                            {index[variant.default_cosmetic_item_id]?.n ?? 'an accessory'}
                          </Link>
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          {unobtainable.length > 0 && (
            <p className="mt-2.5 text-ink-faint text-xs">
              {unobtainable.map((variant) => variant.name ?? titleCase(variant.key)).join(' and ')}{' '}
              exist{unobtainable.length === 1 ? 's' : ''} in the game's files but can't be adopted
              or bred.
            </p>
          )}
        </Section>
      )}
    </Column>
  )
}
