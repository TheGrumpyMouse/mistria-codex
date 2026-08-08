import { useEffect, useMemo, useState } from 'react'
import { Column } from '~/app/AppShell'
import { ItemIcon } from '~/components/ItemIcon'
import { loadRequestBoard } from '~/lib/data'
import type { BoardRequest } from '~/lib/request-board'
import { itemsWanted } from '~/lib/request-board'

/**
 * The request board.
 *
 * The question this screen answers is not "what quests exist" — it is **"what
 * should I be hanging on to"**. The board posts a handful of villager requests
 * at a time, drawn at random, so any single one is unpredictable; the *pool* is
 * a fixed list of 212 and is entirely knowable. Sorting that pool by item turns
 * an unpredictable board into a shopping list, which is the useful shape.
 *
 * By item is therefore the default view. By villager is there because "what
 * does Juniper ever want" is a real second question, not because the data
 * happens to group that way.
 */

type View = 'items' | 'villagers'

const SEASONS = ['spring', 'summer', 'fall', 'winter'] as const
type SeasonFilter = (typeof SEASONS)[number] | 'all'

export function BoardRoute() {
  const [requests, setRequests] = useState<BoardRequest[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<View>('items')
  const [season, setSeason] = useState<SeasonFilter>('all')

  useEffect(() => {
    let live = true
    loadRequestBoard()
      .then((board) => live && setRequests(board.requests))
      .catch((err: unknown) => live && setError(err instanceof Error ? err.message : String(err)))
    return () => {
      live = false
    }
  }, [])

  // A request with no season restriction is available all year, so it belongs in
  // every season's list — `null` here means "no restriction", never "unknown".
  const filtered = useMemo(
    () =>
      (requests ?? []).filter(
        (request) =>
          season === 'all' || request.seasons === null || request.seasons.includes(season),
      ),
    [requests, season],
  )

  const wanted = useMemo(() => itemsWanted(filtered), [filtered])

  if (error !== null) {
    return (
      <Screen>
        <p className="text-gap text-sm">
          The request board could not be loaded. Run <code>pnpm build:ship</code> and reload.
        </p>
        <p className="mt-2 text-ink-faint text-xs">{error}</p>
      </Screen>
    )
  }

  if (requests === null) {
    return (
      <Screen>
        <p className="text-ink-mute text-sm">Reading the board…</p>
      </Screen>
    )
  }

  return (
    <Screen>
      <header>
        <h1 className="text-2xl">Request board</h1>
        <p className="mt-1 max-w-prose text-ink-mute text-sm leading-relaxed">
          The board posts a few villager requests at a time and which ones it picks is random — but
          it picks from a fixed list, and this is all of it. {requests.length} requests,{' '}
          {wanted.length} different things people ask for.
        </p>
      </header>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Toggle value={view} onChange={setView} />
        <div className="flex flex-wrap gap-1">
          <Chip active={season === 'all'} onClick={() => setSeason('all')}>
            All year
          </Chip>
          {SEASONS.map((s) => (
            <Chip key={s} active={season === s} onClick={() => setSeason(s)}>
              {s[0]?.toUpperCase()}
              {s.slice(1)}
            </Chip>
          ))}
        </div>
      </div>

      {view === 'items' ? <ItemList wanted={wanted} /> : <VillagerList requests={filtered} />}

      <p className="mt-6 text-ink-faint text-xs leading-relaxed">
        “Keep” is the largest quantity anyone asks for in one request, so holding that many covers
        the worst case. A request with no season shown can turn up at any time of year.
      </p>
    </Screen>
  )
}

function ItemList({ wanted }: { wanted: ReturnType<typeof itemsWanted> }) {
  if (wanted.length === 0) return <Empty>Nothing is asked for in this season.</Empty>

  return (
    <ul className="mt-4 flex flex-col divide-y divide-rule border-rule border-y">
      {wanted.map((entry) => (
        <li key={entry.id} className="flex items-center gap-3 py-2.5">
          <ItemIcon iconKey={entry.icon_key ?? `item/${entry.id}`} name={entry.name} size="sm" />

          <div className="min-w-0 flex-1">
            <p className="truncate text-ink text-sm">{entry.name}</p>
            <p className="truncate text-ink-faint text-xs">
              {entry.askers.length === 1
                ? entry.askers[0]
                : `${entry.askers.length} villagers · ${entry.askers.slice(0, 3).join(', ')}`}
              {entry.gated ? ' · not from the start' : ''}
            </p>
          </div>

          {entry.seasons.length > 0 && entry.seasons.length < 4 && (
            // One label for the group rather than one per swatch: a screen
            // reader should hear "spring, fall", not two anonymous images.
            <span
              className="flex shrink-0 gap-1"
              role="img"
              aria-label={`Asked in ${entry.seasons.join(', ')}`}
              title={entry.seasons.join(', ')}
            >
              {entry.seasons.map((s) => (
                <span
                  key={s}
                  aria-hidden
                  className="size-2 rounded-[1px]"
                  style={{ background: `var(--${s})` }}
                />
              ))}
            </span>
          )}

          <span data-numeral className="shrink-0 text-ink-mute text-sm tabular-nums">
            keep {entry.keep}
          </span>
        </li>
      ))}
    </ul>
  )
}

function VillagerList({ requests }: { requests: BoardRequest[] }) {
  const byVillager = useMemo(() => {
    const groups = new Map<string, { name: string; requests: BoardRequest[] }>()
    for (const request of requests) {
      const key = request.giver_id ?? 'unknown'
      const group = groups.get(key) ?? {
        name: request.giver_name ?? 'Not attributed',
        requests: [],
      }
      group.requests.push(request)
      groups.set(key, group)
    }
    return [...groups.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name))
  }, [requests])

  if (byVillager.length === 0) return <Empty>Nobody asks for anything in this season.</Empty>

  return (
    <div className="mt-4 flex flex-col gap-5">
      {byVillager.map(([id, group]) => (
        <section key={id}>
          <h2 className="font-display font-semibold text-ink text-sm">
            {group.name}{' '}
            <span className="font-normal text-ink-faint">· {group.requests.length}</span>
          </h2>
          <ul className="mt-1.5 flex flex-col divide-y divide-rule border-rule border-y">
            {group.requests.map((request) => (
              <li key={request.id} className="flex items-center gap-3 py-2">
                <div className="flex shrink-0 gap-1">
                  {request.items.map((item) => (
                    <ItemIcon
                      key={item.id}
                      iconKey={item.icon_key ?? `item/${item.id}`}
                      name={item.name}
                      size="sm"
                    />
                  ))}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-ink text-sm">
                    {request.items
                      .map((i) => `${i.name}${i.quantity > 1 ? ` ×${i.quantity}` : ''}`)
                      .join(', ') || request.name}
                  </p>
                  {request.gates.length > 0 && (
                    <p className="truncate text-ink-faint text-xs">
                      {request.gates.map((g) => g.label).join(' · ')}
                    </p>
                  )}
                </div>
                {request.rewards?.tesserae != null && (
                  <span data-numeral className="shrink-0 text-ink-mute text-xs tabular-nums">
                    {request.rewards.tesserae}t
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

function Toggle({ value, onChange }: { value: View; onChange: (v: View) => void }) {
  return (
    <div className="flex overflow-hidden rounded-tile border border-rule">
      {(
        [
          ['items', 'By item'],
          ['villagers', 'By villager'],
        ] as const
      ).map(([key, label]) => (
        <button
          key={key}
          type="button"
          onClick={() => onChange(key)}
          className="px-3 py-1 text-xs transition-colors"
          style={
            value === key
              ? { background: 'var(--accent-tint)', color: 'var(--accent)', fontWeight: 600 }
              : { color: 'var(--ink-mute)' }
          }
        >
          {label}
        </button>
      ))}
    </div>
  )
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-pill border border-rule px-2.5 py-1 text-xs transition-colors"
      style={
        active
          ? { background: 'var(--accent-tint)', color: 'var(--accent)', fontWeight: 600 }
          : { color: 'var(--ink-mute)' }
      }
    >
      {children}
    </button>
  )
}

const Empty = ({ children }: { children: React.ReactNode }) => (
  <p className="mt-6 text-ink-mute text-sm">{children}</p>
)

function Screen({ children }: { children: React.ReactNode }) {
  return (
    <Column>
      <div className="flex flex-col">{children}</div>
    </Column>
  )
}
