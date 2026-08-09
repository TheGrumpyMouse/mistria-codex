import { Link } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { Column } from '~/app/AppShell'
import { ItemIcon } from '~/components/ItemIcon'
import { Section, Unknown } from '~/components/Section'
import { SpoilerChip } from '~/components/Spoiler'
import { type DisplayIndex, loadDataset, loadDisplayIndex } from '~/lib/data'
import { useDocumentTitle } from '~/lib/head'
import { iconKeyFor } from '~/lib/search'
import { useSpoilers } from '~/lib/spoilers'

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
  /** `mine/<id>`. No mine sprite exists, so this always draws the pickaxe. */
  icon_key: string | null
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
  spoiler?: boolean
  quest_id: string
  required_items: { item_id: string; quantity: number }[]
  unlocks_mine_id: string | null
}

export function MinesRoute() {
  useDocumentTitle('The Mines')
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
  const spoilers = useSpoilers()

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
              <h2 className="flex items-center justify-between gap-2 font-display font-semibold text-ink">
                <span className="flex min-w-0 items-center gap-2">
                  <ItemIcon
                    iconKey={biome.icon_key ?? `mine/${biome.id}`}
                    name={biome.name}
                    size="sm"
                  />
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
                </span>
                <span data-numeral className="shrink-0 font-normal text-ink-mute text-xs">
                  floors {biome.floors.min}–{biome.floors.max}
                </span>
              </h2>

              {/* A late seal's name and price are story knowledge; the card
                  says a seal exists (that much the door itself tells you) and
                  asks before naming it. */}
              {seal !== undefined &&
                seal.spoiler === true &&
                !spoilers.shown(seal.id) &&
                seal.required_items.length > 0 && (
                  <div className="unverified mt-2 rounded-tile px-3 py-2 text-sm">
                    A seal bars this descent — what it asks for is late-story knowledge.{' '}
                    <button
                      type="button"
                      onClick={() => spoilers.reveal(seal.id)}
                      className="underline decoration-current underline-offset-2"
                    >
                      Show it anyway
                    </button>
                  </div>
                )}
              {seal !== undefined &&
                (seal.spoiler !== true || spoilers.shown(seal.id)) &&
                seal.required_items.length > 0 && (
                  <div
                    className="mt-2 rounded-tile px-3 py-2"
                    style={{ background: 'var(--museum-tint)' }}
                  >
                    <p className="text-ink text-sm">
                      To break{' '}
                      <Link
                        to="/quest/$id"
                        params={{ id: seal.quest_id }}
                        className="underline decoration-rule underline-offset-4 hover:text-ink"
                      >
                        {seal.name.replace(/^The /, 'the ')}
                      </Link>
                      , bring:
                    </p>
                    <ul className="mt-1.5 flex flex-wrap gap-1.5">
                      {seal.required_items.map((entry) => (
                        <li key={entry.item_id}>
                          <Link
                            to="/item/$id"
                            params={{ id: entry.item_id }}
                            className="tap-target flex items-center gap-1.5 rounded-tile border border-rule bg-surface py-1 pr-2 pl-1 text-ink text-xs transition-colors hover:bg-sunk"
                          >
                            <ItemIcon
                              iconKey={iconKeyFor(entry.item_id, index[entry.item_id])}
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
              {seal === undefined && biome.gate.length > 0 && biome.gate[0] !== undefined && (
                <p className="unverified mt-2 inline-block rounded-tile px-2 py-1 text-xs">
                  Opened by finishing “
                  {biome.gate[0].type === 'quest' ? (
                    <Link
                      to="/quest/$id"
                      params={{ id: biome.gate[0].key }}
                      className="underline decoration-rule underline-offset-2 hover:text-ink"
                    >
                      {index[biome.gate[0].key]?.n ?? biome.gate[0].key.replace(/_/g, ' ')}
                    </Link>
                  ) : (
                    (index[biome.gate[0].key]?.n ?? biome.gate[0].key.replace(/_/g, ' '))
                  )}
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
        {/* Deliberately vague prose: the named list below handles its own
            veiling, and a sentence that names the late seals would leak what
            the chips are hiding. */}
        <p className="text-ink-mute text-sm">
          More seals wait outside the mines, on the way through{' '}
          <Link
            to="/place/$id"
            params={{ id: 'the_western_ruins' }}
            className="underline decoration-rule underline-offset-4 hover:text-ink"
          >
            the Western Ruins
          </Link>{' '}
          and beyond. Their costs are on their quest pages:
        </p>
        <ul className="mt-1.5 flex flex-col gap-1">
          {seals
            .filter((s) => s.unlocks_mine_id === null)
            .map((seal) => (
              <li key={seal.id} className="flex items-center gap-2">
                {seal.spoiler === true && !spoilers.shown(seal.id) ? (
                  // The row exists and still navigates — the quest page it
                  // lands on is the one that asks. Only the name is withheld.
                  <Link
                    to="/quest/$id"
                    params={{ id: seal.quest_id }}
                    className="inline-flex items-center gap-1.5"
                  >
                    <SpoilerChip />
                  </Link>
                ) : (
                  <Link
                    to="/quest/$id"
                    params={{ id: seal.quest_id }}
                    className="flex items-center gap-2 text-ink text-sm hover:text-ink"
                  >
                    <ItemIcon
                      iconKey={iconKeyFor(seal.quest_id, index[seal.quest_id] ?? { c: 'quest' })}
                      name={index[seal.quest_id]?.n ?? seal.name}
                      size="sm"
                    />
                    <span className="underline decoration-rule underline-offset-4">
                      {seal.name}
                    </span>
                  </Link>
                )}
                {seal.required_items.length > 0 && (
                  <span data-numeral className="text-ink-faint text-xs">
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
  // The list is drawn from a route, not from the index, so an id the index
  // does not carry still knows what family it belongs to.
  const fallbackKind = { c: to === '/monster/$id' ? 'monster' : 'item' }
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
                iconKey={iconKeyFor(id, index[id] ?? fallbackKind)}
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
