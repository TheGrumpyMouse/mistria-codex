import { Link } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { Column } from '~/app/AppShell'
import { ItemIcon } from '~/components/ItemIcon'
import { Section, Unknown } from '~/components/Section'
import { type DisplayIndex, loadDataset, loadDisplayIndex } from '~/lib/data'

/**
 * The Mines, top to bottom: five biomes, and the seal that bars each descent.
 *
 * The headline of every biome card is the seal's shopping list — "to break the
 * Water Seal, bring a Lantern Moth, a Ruby, a Stone Loach and an Upper Mines
 * Mushroom" is the single thing a player climbs out of the mines to look up.
 * The list is the game's own (`supplied_items` on the seal quest), never a
 * guess, and every item links to its page, which knows where to find it.
 *
 * What's down there — ores, fish, monsters — is listed per biome underneath,
 * because "what am I unlocking" is the second question.
 */

interface MineRecord {
  id: string
  name: string
  floors: { min: number; max: number }
  gate: { type: string; key: string }[]
  ore_item_ids: string[]
  fish_item_ids: string[]
  monster_ids: string[]
  location_id: string | null
}

interface SealRecord {
  id: string
  name: string
  quest_id: string
  required_items: { item_id: string; quantity: number }[]
  unlocks_mine_id: string | null
}

export function MinesRoute() {
  const [state, setState] = useState<{
    mines: MineRecord[]
    seals: SealRecord[]
    index: DisplayIndex
    loading: boolean
  }>({ mines: [], seals: [], index: {}, loading: true })

  useEffect(() => {
    let live = true
    Promise.all([
      loadDataset<MineRecord>('mines'),
      loadDataset<SealRecord>('seals'),
      loadDisplayIndex(),
    ])
      .then(([mines, seals, index]) => {
        if (!live) return
        setState({
          mines: [...mines].sort((a, b) => a.floors.min - b.floors.min),
          seals,
          index,
          loading: false,
        })
      })
      .catch(() => live && setState((s) => ({ ...s, loading: false })))
    return () => {
      live = false
    }
  }, [])

  const { mines, seals, index, loading } = state

  if (loading) {
    return (
      <Column>
        <p className="text-ink-mute text-sm">Descending…</p>
      </Column>
    )
  }

  return (
    <Column>
      <header>
        <h1 className="text-2xl">The Mines</h1>
        <p className="mt-1 text-ink-mute text-sm">
          Five biomes, each behind a seal. Every seal is broken by bringing it the items it asks for
          — the lists below are the game’s own.
        </p>
      </header>

      <div className="mt-4 flex flex-col gap-6">
        {mines.map((biome) => {
          // The seal that OPENS this biome — matched through the gate quest, so
          // it stays right even if the biome order ever changes.
          const seal = seals.find((s) =>
            biome.gate.some((g) => g.type === 'quest' && g.key === s.quest_id),
          )
          return (
            <section key={biome.id} className="rounded-card border border-rule bg-surface p-4">
              <h2 className="flex items-baseline justify-between gap-2 font-display font-semibold text-ink">
                {biome.location_id === null ? (
                  biome.name
                ) : (
                  <Link
                    to="/place/$id"
                    params={{ id: biome.location_id }}
                    className="underline decoration-transparent underline-offset-4 transition-colors hover:decoration-rule"
                  >
                    {biome.name}
                  </Link>
                )}
                <span data-numeral className="font-normal text-ink-mute text-xs">
                  floors {biome.floors.min}–{biome.floors.max}
                </span>
              </h2>

              {seal !== undefined && seal.required_items.length > 0 && (
                <div
                  className="mt-2 rounded-tile px-3 py-2"
                  style={{ background: 'var(--museum-tint)' }}
                >
                  <p className="text-ink text-sm">
                    To break {seal.name.replace(/^The /, 'the ')}, bring:
                  </p>
                  <ul className="mt-1.5 flex flex-wrap gap-1.5">
                    {seal.required_items.map((entry) => (
                      <li key={entry.item_id}>
                        <Link
                          to="/item/$id"
                          params={{ id: entry.item_id }}
                          className="flex items-center gap-1.5 rounded-tile border border-rule bg-surface py-1 pr-2 pl-1 text-ink text-xs transition-colors hover:bg-sunk"
                        >
                          <ItemIcon
                            iconKey={index[entry.item_id]?.i ?? `item/${entry.item_id}`}
                            name={index[entry.item_id]?.n ?? entry.item_id}
                            size="sm"
                          />
                          {index[entry.item_id]?.n ?? entry.item_id.replace(/_/g, ' ')}
                          {entry.quantity > 1 && <span data-numeral>×{entry.quantity}</span>}
                        </Link>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-1.5 text-ink-faint text-xs">
                    Each item’s page says where to find it.
                  </p>
                </div>
              )}
              {seal === undefined && biome.gate.length > 0 && (
                <p className="unverified mt-2 inline-block rounded-tile px-2 py-1 text-xs">
                  Opened by finishing “
                  {biome.gate[0]?.key
                    .split('_')
                    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
                    .join(' ')}
                  ”
                </p>
              )}

              <MineList title="Ores" ids={biome.ore_item_ids} to="/item/$id" index={index} />
              <MineList title="Fish" ids={biome.fish_item_ids} to="/item/$id" index={index} />
              <MineList title="Monsters" ids={biome.monster_ids} to="/monster/$id" index={index} />
            </section>
          )
        })}
      </div>

      {mines.length === 0 && <Unknown>No mine data in this build.</Unknown>}

      <Section title="Beyond the mines">
        <p className="text-ink-mute text-sm">
          Two more seals sit outside the mines — the Ruins Seal and the Void Seal on the way through
          the Western Ruins, and the Final Seal past them. Their costs are on their quest pages:
        </p>
        <ul className="mt-1.5 flex flex-col gap-1">
          {seals
            .filter((s) => s.unlocks_mine_id === null)
            .map((seal) => (
              <li key={seal.id}>
                <Link
                  to="/quest/$id"
                  params={{ id: seal.quest_id }}
                  className="text-ink text-sm underline decoration-rule underline-offset-4 hover:text-ink"
                >
                  {seal.name}
                </Link>
                {seal.required_items.length > 0 && (
                  <span className="text-ink-faint text-xs">
                    {' '}
                    · {seal.required_items.length} items
                  </span>
                )}
              </li>
            ))}
        </ul>
      </Section>
    </Column>
  )
}

function MineList({
  title,
  ids,
  to,
  index,
}: {
  title: string
  ids: string[]
  to: '/item/$id' | '/monster/$id'
  index: DisplayIndex
}) {
  if (ids.length === 0) return null
  return (
    <div className="mt-3">
      <p className="text-ink-mute text-xs">{title}</p>
      <ul className="mt-1 flex flex-wrap gap-1.5">
        {ids.map((id) => (
          <li key={id}>
            <Link
              to={to}
              params={{ id }}
              className="flex items-center gap-1.5 rounded-tile border border-rule py-0.5 pr-2 pl-0.5 text-ink text-xs transition-colors hover:bg-sunk"
            >
              <ItemIcon
                iconKey={index[id]?.i ?? `item/${id}`}
                name={index[id]?.n ?? id}
                size="sm"
              />
              {index[id]?.n ?? id.replace(/_/g, ' ')}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
