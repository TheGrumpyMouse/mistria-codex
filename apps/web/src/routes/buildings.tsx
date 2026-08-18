import { Link } from '@tanstack/react-router'
import { Column } from '~/app/AppShell'
import { ItemIcon } from '~/components/ItemIcon'
import { type DisplayIndex, loadDataset, loadDisplayIndex } from '~/lib/data'
import { useDocumentTitle } from '~/lib/head'
import { BUILDING_KIND_LABELS } from '~/lib/labels'
import { iconKeyFor } from '~/lib/search'
import { useData } from '~/lib/use-data'

/**
 * The buildings, briefly — what exists and where the blueprints are sold.
 *
 * Deliberately not in the nav: search, Browse, the Ranch screen and the
 * blueprint items all land here, and eight records do not earn a fifth
 * sidebar slot.
 */

interface BuildingRow {
  id: string
  name: string
  icon_key: string | null
  kind: string
  tiers: { level: number }[]
  vendor_shop_id: string | null
  repair_quest_id: string | null
  data_gaps: string[]
}

export function BuildingsRoute() {
  useDocumentTitle('Buildings')
  const { data } = useData('buildings-index', async () => {
    const [buildings, index] = await Promise.all([
      loadDataset<BuildingRow>('buildings'),
      loadDisplayIndex(),
    ])
    return { buildings, index }
  })

  if (data === null) {
    return (
      <Column>
        <p className="text-ink-mute text-sm">Loading…</p>
      </Column>
    )
  }
  const { buildings, index } = data as { buildings: BuildingRow[]; index: DisplayIndex }

  return (
    <Column>
      <h1 className="text-2xl">Buildings</h1>
      <p className="text-ink-mute text-sm">
        What can go up on the farm, what each stage costs, and where the blueprints are sold.
      </p>
      <ul className="flex flex-col gap-1.5">
        {buildings.map((building) => {
          const subtitle =
            building.repair_quest_id !== null
              ? 'restored through a quest'
              : building.tiers.length > 0
                ? building.tiers.length === 1
                  ? 'one stage'
                  : `${building.tiers.length} stages`
                : 'cost not recorded yet'
          return (
            <li key={building.id}>
              <Link
                to="/building/$id"
                params={{ id: building.id }}
                className="flex items-center gap-2.5 rounded-tile border border-rule bg-surface p-2 transition-colors hover:bg-sunk"
              >
                <ItemIcon
                  iconKey={iconKeyFor(building.id, index[building.id])}
                  name={building.name}
                  size="md"
                />
                <span className="min-w-0">
                  <span className="block truncate text-ink text-sm">{building.name}</span>
                  <span className="block truncate text-ink-faint text-xs">
                    {BUILDING_KIND_LABELS[building.kind] ?? 'Building'} · {subtitle}
                    {building.vendor_shop_id !== null &&
                      index[building.vendor_shop_id]?.n !== undefined && (
                        <> · at the {index[building.vendor_shop_id]?.n}</>
                      )}
                  </span>
                </span>
              </Link>
            </li>
          )
        })}
      </ul>
    </Column>
  )
}
