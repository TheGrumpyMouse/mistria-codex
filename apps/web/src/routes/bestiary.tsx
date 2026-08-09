import { getRouteApi, Link } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { Column } from '~/app/AppShell'
import { BackLink } from '~/components/BackLink'
import { ItemIcon } from '~/components/ItemIcon'
import { Section, Unknown } from '~/components/Section'
import { type DisplayIndex, loadDataset, loadDisplayIndex } from '~/lib/data'
import { iconKeyFor } from '~/lib/search'

const route = getRouteApi('/monster/$id')

/**
 * One monster: where it lives and what it drops.
 *
 * Short on purpose. The wiki records drops and biomes and almost never records
 * hit points, and the honest version of this page is mostly the drop table with
 * the missing fields said out loud rather than left blank.
 */

interface MonsterRecord {
  id: string
  name: string
  icon_key: string | null
  hp: number | null
  combat_xp: number | null
  biome_ids: string[]
  drops: { item_id: string; chance: number | null; quantity: number | null }[]
  data_gaps: string[]
}

export function BestiaryRoute() {
  const { id } = route.useParams()
  const [state, setState] = useState<{
    monster: MonsterRecord | null
    biomes: Map<string, { name: string; locationId: string | null }>
    index: DisplayIndex
    loading: boolean
  }>({ monster: null, biomes: new Map(), index: {}, loading: true })

  useEffect(() => {
    let live = true
    Promise.all([
      loadDataset<MonsterRecord>('monsters'),
      loadDataset<{ id: string; name: string; location_id: string | null }>('mines'),
      loadDisplayIndex(),
    ])
      .then(([monsters, mines, index]) => {
        if (!live) return
        setState({
          monster: monsters.find((m) => m.id === id) ?? null,
          biomes: new Map(mines.map((m) => [m.id, { name: m.name, locationId: m.location_id }])),
          index,
          loading: false,
        })
      })
      .catch(() => live && setState((s) => ({ ...s, loading: false })))
    return () => {
      live = false
    }
  }, [id])

  const { monster, biomes, index, loading } = state

  if (loading) {
    return (
      <Column>
        <p className="text-ink-mute text-sm">Loading…</p>
      </Column>
    )
  }

  if (monster === null) {
    return (
      <Column>
        <h1 className="text-2xl">Not found</h1>
        <p className="mt-1 text-ink-mute text-sm">
          Nothing here goes by “{id.replace(/_/g, ' ')}”.{' '}
          <Link to="/search" className="underline decoration-rule underline-offset-4">
            Search instead
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
        <ItemIcon
          iconKey={monster.icon_key ?? `monster/${monster.id}`}
          name={monster.name}
          size="lg"
        />
        <div className="min-w-0">
          <h1 className="truncate text-2xl">{monster.name}</h1>
          <p className="mt-0.5 text-ink-mute text-sm">
            {monster.biome_ids.length === 0
              ? 'home unknown'
              : monster.biome_ids.map((b, i) => {
                  const biome = biomes.get(b)
                  const label = biome?.name ?? b.replace(/_/g, ' ')
                  return (
                    <span key={b}>
                      {i > 0 && ' · '}
                      {biome?.locationId == null ? (
                        label
                      ) : (
                        <Link
                          to="/place/$id"
                          params={{ id: biome.locationId }}
                          className="underline decoration-rule underline-offset-4 hover:text-ink"
                        >
                          {label}
                        </Link>
                      )}
                    </span>
                  )
                })}
          </p>
        </div>
      </header>

      <Section title="Drops">
        {monster.drops.length === 0 ? (
          <Unknown>No drops recorded.</Unknown>
        ) : (
          <ul className="flex flex-col divide-y divide-rule border-rule border-y">
            {[...monster.drops]
              .sort((a, b) => (b.chance ?? 0) - (a.chance ?? 0))
              .map((drop) => (
                <li key={drop.item_id}>
                  <Link
                    to="/item/$id"
                    params={{ id: drop.item_id }}
                    className="flex items-center gap-3 py-2 transition-colors hover:bg-sunk"
                  >
                    <ItemIcon
                      iconKey={iconKeyFor(drop.item_id, index[drop.item_id])}
                      name={index[drop.item_id]?.n ?? drop.item_id}
                      size="sm"
                    />
                    <span className="min-w-0 flex-1 truncate text-ink text-sm">
                      {index[drop.item_id]?.n ?? drop.item_id.replace(/_/g, ' ')}
                    </span>
                    {/* A null chance is unknown, and unknown never renders as a
                        number — 0% would read as "never drops". */}
                    {drop.chance === null ? (
                      <span className="unverified shrink-0 rounded-tile px-1.5 py-0.5 text-[0.625rem]">
                        chance unknown
                      </span>
                    ) : (
                      <span data-numeral className="shrink-0 text-ink-faint text-xs">
                        {Math.round(drop.chance * 100)}%
                      </span>
                    )}
                  </Link>
                </li>
              ))}
          </ul>
        )}
      </Section>

      <Section title="In a fight">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-ink-mute">Health</dt>
          <dd className="text-ink">
            {monster.hp === null ? (
              <Unknown>not recorded</Unknown>
            ) : (
              <span data-numeral>{monster.hp}</span>
            )}
          </dd>
          <dt className="text-ink-mute">Combat XP</dt>
          <dd className="text-ink">
            {monster.combat_xp === null ? (
              <Unknown>not recorded</Unknown>
            ) : (
              <span data-numeral>{monster.combat_xp}</span>
            )}
          </dd>
        </dl>
      </Section>
    </Column>
  )
}
