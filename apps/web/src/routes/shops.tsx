import { Link } from '@tanstack/react-router'
import { Column } from '~/app/AppShell'
import { GateRun } from '~/components/GateRun'
import { ItemIcon } from '~/components/ItemIcon'
import { Section } from '~/components/Section'
import { type DisplayIndex, loadDataset, loadDisplayIndex } from '~/lib/data'
import { useDocumentTitle } from '~/lib/head'
import { type PlaceLabel, placeLabels } from '~/lib/labels'
import { useData } from '~/lib/use-data'

/**
 * Every place that sells something, in one list.
 *
 * The groups are read from the data, not declared here: a stall is "Saturday
 * Market" because its hours say Saturdays, not because its id is on a list —
 * a new stall in the dataset lands in the right group with no edit to this
 * file. The two challenge boards and the festival stall are the deliberate
 * exceptions: they are not shop records (nothing is for sale at a board, and
 * festival goods belong to festivals), so their rows are composed here.
 */

interface ShopRow {
  id: string
  name: string
  icon_key: string | null
  location_id: string | null
  owner_character_id: string | null
  hours: { days: string[] }[]
  unlock_requires: { type: string; key: string; op?: string; value?: unknown }[]
  stock: { rotation: boolean }[]
}

function ShopRowLink({
  shop,
  places,
  index,
}: {
  shop: ShopRow
  places: Map<string, PlaceLabel>
  index: DisplayIndex
}) {
  const rotating = shop.stock.some((line) => line.rotation)
  return (
    <li>
      <Link
        to="/shop/$id"
        params={{ id: shop.id }}
        className="flex items-center gap-2.5 rounded-tile border border-rule bg-surface p-2 transition-colors hover:bg-sunk"
      >
        <ItemIcon iconKey={shop.icon_key ?? `shop/${shop.id}`} name={shop.name} size="md" />
        <span className="min-w-0">
          <span className="block truncate text-ink text-sm">{shop.name}</span>
          {/* Plain text, not PlaceLink — the whole row is already an anchor,
              and an anchor inside an anchor is invalid HTML. The shop page
              itself carries the tappable place link. */}
          <span className="block truncate text-ink-faint text-xs">
            {shop.location_id !== null && places.get(shop.location_id)?.name}
            {shop.owner_character_id !== null &&
              index[shop.owner_character_id]?.n !== undefined && (
                <> · {index[shop.owner_character_id]?.n}</>
              )}
            {shop.hours.length > 0 && <> · Saturdays</>}
            {rotating && <> · rotating stock</>}
          </span>
        </span>
      </Link>
    </li>
  )
}

export function ShopsRoute() {
  useDocumentTitle('Shops')
  const { data } = useData('shops-index', async () => {
    const [shops, locations, index] = await Promise.all([
      loadDataset<ShopRow>('shops'),
      loadDataset<{ id: string; name: string }>('locations'),
      loadDisplayIndex(),
    ])
    return { shops, places: placeLabels(locations, []), index }
  })

  if (data === null) {
    return (
      <Column>
        <p className="text-ink-mute text-sm">Loading…</p>
      </Column>
    )
  }
  const { shops, places, index } = data

  const byName = (a: ShopRow, b: ShopRow): number => a.name.localeCompare(b.name)
  // Day-gated shops are the Saturday Market; everything else stands all week.
  const market = shops.filter((shop) => shop.hours.length > 0).sort(byName)
  const town = shops.filter((shop) => shop.hours.length === 0).sort(byName)
  // All six stalls share the one gate; state it once over the group rather
  // than six times in a row.
  const marketGates = market[0]?.unlock_requires ?? []

  const boards = ['stillwell', 'taliferro'].filter((id) => index[id] !== undefined)

  return (
    <Column>
      <h1 className="text-2xl">Shops</h1>
      <p className="text-ink-mute text-sm">Who sells what, and what it takes before they will.</p>

      <Section title="Around the valley">
        <ul className="flex flex-col gap-1.5">
          {town.map((shop) => (
            <ShopRowLink key={shop.id} shop={shop} places={places} index={index} />
          ))}
        </ul>
      </Section>

      {market.length > 0 && (
        <Section title="Saturday Market">
          {marketGates.length > 0 && (
            <p className="mb-1.5 text-xs" style={{ color: 'var(--locked)' }}>
              The market opens once you <GateRun gates={marketGates} index={index} />.
            </p>
          )}
          <ul className="flex flex-col gap-1.5">
            {market.map((shop) => (
              <ShopRowLink key={shop.id} shop={shop} places={places} index={index} />
            ))}
          </ul>
        </Section>
      )}

      {boards.length > 0 && (
        <Section title="Challenge boards">
          <p className="mb-1.5 text-ink-faint text-xs">
            Two market stalls sell nothing — they post challenges, and finishing one teaches a
            recipe.
          </p>
          <ul className="flex flex-col gap-1.5">
            {boards.map((id) => (
              <li key={id}>
                <Link
                  to="/shop/$id"
                  params={{ id }}
                  className="flex items-center gap-2.5 rounded-tile border border-rule bg-surface p-2 transition-colors hover:bg-sunk"
                >
                  <ItemIcon iconKey={`character/${id}`} name={index[id]?.n ?? id} size="md" />
                  <span className="min-w-0">
                    <span className="block truncate text-ink text-sm">
                      {index[id]?.n}’s challenges
                    </span>
                    <span className="block truncate text-ink-faint text-xs">
                      Saturday Market · challenge board
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="At the festivals">
        <ul className="flex flex-col gap-1.5">
          <li>
            <Link
              to="/shop/$id"
              params={{ id: 'souvenir_stall' }}
              className="flex items-center gap-2.5 rounded-tile border border-rule bg-surface p-2 transition-colors hover:bg-sunk"
            >
              <ItemIcon iconKey="character/nora" name="Souvenir Stall" size="md" />
              <span className="min-w-0">
                <span className="block truncate text-ink text-sm">Souvenir Stall</span>
                <span className="block truncate text-ink-faint text-xs">
                  Nora’s stall, on festival days
                </span>
              </span>
            </Link>
          </li>
        </ul>
        <p className="mt-1.5 text-ink-faint text-xs">
          Stalls run by one festival alone are listed on that festival’s page.
        </p>
      </Section>
    </Column>
  )
}
