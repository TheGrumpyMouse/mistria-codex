import { getRouteApi, Link } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { Column } from '~/app/AppShell'
import { BackLink } from '~/components/BackLink'
import { GateRun } from '~/components/GateRun'
import { ItemIcon } from '~/components/ItemIcon'
import { Section, Unknown } from '~/components/Section'
import { type DisplayIndex, loadDataset, loadDisplayIndex } from '~/lib/data'
import { useDocumentTitle } from '~/lib/head'
import { BUILDING_KIND_LABELS, buildingTierLabel, gapLabels } from '~/lib/labels'
import { iconKeyFor } from '~/lib/search'

const route = getRouteApi('/building/$id')

/**
 * One building: every stage, what it costs, and where the blueprint is sold.
 *
 * The mill is the deliberate exception — it is restored through a quest, not
 * bought, so its section names the quest and lists that quest's own supplied
 * items as the cost, and prints no tesserae figure: the game states none, and
 * a number here would be invented.
 */

interface Gate {
  type: string
  key: string
  op?: string
  value?: unknown
}

interface BuildingTier {
  level: number
  cost: { tesserae: number | null; materials: { item_id: string; quantity: number }[] }
  capacity: number | null
  incubators: number | null
  requires: Gate[]
  blueprint_item_ids: string[]
}

interface BuildingRecord {
  id: string
  name: string
  icon_key: string | null
  kind: string
  tiers: BuildingTier[]
  vendor_shop_id: string | null
  repair_quest_id: string | null
  data_gaps: string[]
}

interface QuestLite {
  id: string
  name: string
  required_items?: { item_id: string; quantity: number }[]
}

function ItemChip({ id, index, quantity }: { id: string; index: DisplayIndex; quantity?: number }) {
  const name = index[id]?.n ?? id.replace(/_/g, ' ')
  return (
    <span className="inline-flex items-center gap-1">
      <Link
        to="/item/$id"
        params={{ id }}
        className="inline-flex items-center gap-1.5 rounded-tile border border-rule bg-surface py-0.5 pr-2 pl-1 text-ink text-sm transition-colors hover:bg-sunk"
      >
        <ItemIcon iconKey={iconKeyFor(id, index[id])} name={name} size="sm" />
        <span className="truncate">{name}</span>
      </Link>
      {quantity !== undefined && quantity > 1 && (
        <span className="text-ink-faint text-xs">×{quantity}</span>
      )}
    </span>
  )
}

export function BuildingRoute() {
  const { id } = route.useParams()
  const [state, setState] = useState<{
    building: BuildingRecord | null
    quest: QuestLite | null
    index: DisplayIndex
    loading: boolean
  }>({ building: null, quest: null, index: {}, loading: true })

  useEffect(() => {
    let live = true
    loadDataset<BuildingRecord>('buildings')
      .then(async (buildings) => {
        const building = buildings.find((b) => b.id === id) ?? null
        const [index, quests] = await Promise.all([
          loadDisplayIndex(),
          building?.repair_quest_id != null
            ? loadDataset<QuestLite>('quests')
            : Promise.resolve<QuestLite[]>([]),
        ])
        if (!live) return
        setState({
          building,
          quest: quests.find((q) => q.id === building?.repair_quest_id) ?? null,
          index,
          loading: false,
        })
      })
      .catch(() => live && setState((s) => ({ ...s, loading: false })))
    return () => {
      live = false
    }
  }, [id])

  const { building, quest, index, loading } = state
  useDocumentTitle(building?.name ?? null)

  if (loading) {
    return (
      <Column>
        <p className="text-ink-mute text-sm">Loading…</p>
      </Column>
    )
  }

  if (building === null) {
    return (
      <Column>
        <h1 className="text-2xl">Not found</h1>
        <p className="mt-1 text-ink-mute text-sm">
          Nothing here goes by “{id.replace(/_/g, ' ')}”.{' '}
          <Link to="/buildings" className="underline decoration-rule underline-offset-4">
            Back to the buildings
          </Link>
          .
        </p>
      </Column>
    )
  }

  const gaps = gapLabels(building.data_gaps)
  const vendorName =
    building.vendor_shop_id === null ? undefined : index[building.vendor_shop_id]?.n

  return (
    <Column>
      <BackLink />
      <header className="flex items-center gap-3">
        <ItemIcon
          iconKey={iconKeyFor(building.id, index[building.id])}
          name={building.name}
          size="lg"
        />
        <div className="min-w-0">
          <h1 className="truncate text-2xl">{building.name}</h1>
          <p className="mt-0.5 text-ink-mute text-sm">
            {BUILDING_KIND_LABELS[building.kind] ?? 'Building'}
            {building.vendor_shop_id !== null && vendorName !== undefined && (
              <>
                {' · at the '}
                <Link
                  to="/shop/$id"
                  params={{ id: building.vendor_shop_id }}
                  className="underline decoration-rule underline-offset-4 hover:text-ink"
                >
                  {vendorName}
                </Link>
              </>
            )}
          </p>
        </div>
      </header>

      {gaps.length > 0 && (
        <p className="text-ink-faint text-xs">Not recorded yet: {gaps.join(', ')}.</p>
      )}

      {building.repair_quest_id !== null && (
        <Section title="How it's restored">
          <p className="text-ink-mute text-sm">
            Not bought — it comes back through{' '}
            {quest === null ? (
              'a quest'
            ) : (
              <Link
                to="/quest/$id"
                params={{ id: quest.id }}
                className="text-ink underline decoration-rule underline-offset-4 hover:text-ink"
              >
                “{quest.name}”
              </Link>
            )}
            {(quest?.required_items?.length ?? 0) > 0 && <>, which asks for:</>}
          </p>
          {(quest?.required_items?.length ?? 0) > 0 && (
            <ul className="mt-1.5 flex flex-wrap gap-1.5">
              {(quest?.required_items ?? []).map((wanted) => (
                <li key={wanted.item_id}>
                  <ItemChip id={wanted.item_id} index={index} quantity={wanted.quantity} />
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}

      {building.tiers.map((tier) => (
        <Section
          key={tier.level}
          title={buildingTierLabel(building.kind, tier.level, building.tiers.length)}
        >
          <div className="flex flex-col gap-1.5 text-sm">
            {tier.cost.tesserae !== null && (
              <p className="flex items-center gap-1 text-ink">
                <ItemIcon iconKey="ui/tesserae" name="tesserae" size="sm" />
                <span>
                  <span data-numeral>{tier.cost.tesserae}</span>t
                </span>
              </p>
            )}
            {tier.cost.materials.length > 0 && (
              <ul className="flex flex-wrap gap-1.5">
                {tier.cost.materials.map((material) => (
                  <li key={material.item_id}>
                    <ItemChip id={material.item_id} index={index} quantity={material.quantity} />
                  </li>
                ))}
              </ul>
            )}
            {tier.capacity !== null && (
              <p className="text-ink-mute">
                Houses up to <span data-numeral>{tier.capacity}</span> animals
                {tier.incubators !== null && tier.incubators > 0 && (
                  <>
                    {' · '}
                    <span data-numeral>{tier.incubators}</span>{' '}
                    {tier.incubators === 1 ? 'incubator' : 'incubators'}
                  </>
                )}
              </p>
            )}
            {tier.requires.length > 0 && (
              <p className="text-xs" style={{ color: 'var(--locked)' }}>
                Available once you <GateRun gates={tier.requires} index={index} />
              </p>
            )}
            {tier.blueprint_item_ids.length > 0 && (
              <p className="flex flex-wrap items-center gap-1.5 text-ink-mute">
                <span>Buy:</span>
                {tier.blueprint_item_ids.map((blueprintId) => (
                  <ItemChip key={blueprintId} id={blueprintId} index={index} />
                ))}
              </p>
            )}
          </div>
        </Section>
      ))}

      {building.tiers.length === 0 && building.repair_quest_id === null && (
        <Unknown>What it costs to build isn’t recorded yet.</Unknown>
      )}
    </Column>
  )
}
