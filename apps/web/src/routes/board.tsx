import { getRouteApi, Link } from '@tanstack/react-router'
import { ChevronDown } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Column } from '~/app/AppShell'
import { ItemIcon } from '~/components/ItemIcon'
import { LoadError } from '~/components/Section'
import { SpoilerChip } from '~/components/Spoiler'
import { loadRequestBoard } from '~/lib/data'
import { useDocumentTitle } from '~/lib/head'
import { CATEGORY_LABELS } from '~/lib/labels'
import { doneIn, setDone } from '~/lib/progress'
import type { BoardRequest } from '~/lib/request-board'
import { itemsWanted } from '~/lib/request-board'
import { useSpoilers } from '~/lib/spoilers'
import { useData } from '~/lib/use-data'

const route = getRouteApi('/board')

/**
 * Which groups are folded shut, remembered across visits — the museum's
 * pattern (see museum.tsx). One key holds both views' folds, namespaced
 * `items:<category>` / `villager:<giver>` so the two lists cannot collide.
 * A corrupt value reads as "nothing collapsed".
 */
const COLLAPSED_KEY = 'mistria-codex:board-collapsed'

function readCollapsed(): Set<string> {
  try {
    const raw = JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? '[]') as unknown
    return new Set(Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string') : [])
  } catch {
    return new Set()
  }
}

function writeCollapsed(keys: Set<string>): void {
  try {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...keys].sort()))
  } catch {
    // Private mode: the fold still works for this session via state.
  }
}

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
  useDocumentTitle('Request board')
  // View, season and filter live in the URL so back restores this screen
  // as it was — same grouping, same rows, same scroll.
  const searchParams = route.useSearch()
  const navigate = route.useNavigate()
  const view: View = searchParams.view === 'villagers' ? 'villagers' : 'items'
  const season = (searchParams.season ?? 'all') as SeasonFilter
  const query = searchParams.q ?? ''
  const setView = (v: View): void =>
    void navigate({
      search: ({ view: _, ...rest }) => (v === 'items' ? rest : { ...rest, view: v }),
      replace: true,
    })
  const setSeason = (next: SeasonFilter): void =>
    void navigate({
      search: ({ season: _, ...rest }) => (next === 'all' ? rest : { ...rest, season: next }),
      replace: true,
    })
  const setQuery = (q: string): void =>
    void navigate({
      search: ({ q: _, ...rest }) => (q === '' ? rest : { ...rest, q }),
      replace: true,
    })

  const { data, error } = useData('request-board', loadRequestBoard)
  const requests = data?.requests ?? null
  const spoilers = useSpoilers()

  // What has been handed in, from the same progress domain the item page's
  // "needed for" ticks write — `request:<request_id>/<item_id>` — so a tick
  // made on either screen is simply the other screen's state.
  const [given, setGiven] = useState<Set<string>>(new Set())
  useEffect(() => {
    let live = true
    doneIn('request').then((done) => live && setGiven(done))
    return () => {
      live = false
    }
  }, [])
  // One row can stand for several (request, item) pairs, so a toggle writes
  // them all. Optimistic, like the museum: the write is local.
  const setManyGiven = (keys: string[], done: boolean): void => {
    setGiven((current) => {
      const next = new Set(current)
      for (const key of keys) {
        if (done) next.add(key)
        else next.delete(key)
      }
      return next
    })
    for (const key of keys) void setDone('request', key, done)
  }

  // The fold is a preference, not part of the answer, so it lives in
  // localStorage rather than the URL — two identical answers should not be
  // two different links (the same call the museum and list-sort made).
  const [collapsed, setCollapsed] = useState<Set<string>>(() => readCollapsed())
  const toggleCollapsed = (key: string): void => {
    setCollapsed((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      writeCollapsed(next)
      return next
    })
  }
  // Folds or opens only the given keys, so "Collapse all" on one view leaves
  // the other view's folds alone.
  const setManyCollapsed = (keys: string[], fold: boolean): void => {
    setCollapsed((current) => {
      const next = new Set(current)
      for (const key of keys) {
        if (fold) next.add(key)
        else next.delete(key)
      }
      writeCollapsed(next)
      return next
    })
  }

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

  const needle = query.trim().toLowerCase()
  const searched = useMemo(
    () =>
      needle === ''
        ? filtered
        : filtered.filter(
            (request) =>
              (request.giver_name ?? '').toLowerCase().includes(needle) ||
              request.name.toLowerCase().includes(needle) ||
              request.items.some((item) => item.name.toLowerCase().includes(needle)),
          ),
    [filtered, needle],
  )

  const wanted = useMemo(
    () =>
      itemsWanted(searched).filter(
        (entry) =>
          needle === '' ||
          entry.name.toLowerCase().includes(needle) ||
          entry.askers.some((asker) => asker.name.toLowerCase().includes(needle)),
      ),
    [searched, needle],
  )

  if (error !== null) {
    return (
      <Screen>
        <LoadError />
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

      <input
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Filter by item or villager"
        aria-label="Filter requests"
        className="mt-3 w-full rounded-tile border border-rule bg-surface px-3 py-2 text-ink text-sm placeholder:text-ink-faint"
      />

      {view === 'items' ? (
        <ItemList
          wanted={wanted}
          collapsed={collapsed}
          searchActive={needle !== ''}
          onToggle={toggleCollapsed}
          onFoldAll={setManyCollapsed}
          given={given}
          onGive={setManyGiven}
          shown={spoilers.shown}
        />
      ) : (
        <VillagerList
          requests={searched}
          collapsed={collapsed}
          searchActive={needle !== ''}
          onToggle={toggleCollapsed}
          onFoldAll={setManyCollapsed}
          given={given}
          onGive={setManyGiven}
          shown={spoilers.shown}
        />
      )}

      <p className="mt-6 text-ink-faint text-xs leading-relaxed">
        “Keep” is the largest quantity anyone asks for in one request, so holding that many covers
        the worst case. A request with no season shown can turn up at any time of year.
      </p>
    </Screen>
  )
}

/** The fold plumbing both views share; state lives on the route. */
interface FoldProps {
  collapsed: Set<string>
  /**
   * A live search overrides the fold — hiding a hit inside a collapsed group
   * would read as "nobody asks for this", which is a lie (the museum's rule).
   */
  searchActive: boolean
  onToggle: (key: string) => void
  onFoldAll: (keys: string[], fold: boolean) => void
}

/** The give-tracking plumbing both views share; state lives on the route. */
interface TrackProps {
  /** Done `<request_id>/<item_id>` keys, domain `request` in the progress store. */
  given: Set<string>
  onGive: (keys: string[], done: boolean) => void
  /** Whether a spoiler record may be named — `useSpoilers().shown`. */
  shown: (id: string) => boolean
}

/**
 * One tick over several `(request, item)` pairs: checked when all are handed
 * in, indeterminate when the item page ticked some of them.
 */
function GivenBox({
  keys,
  given,
  onGive,
  label,
}: {
  keys: string[]
  label: string
} & Pick<TrackProps, 'given' | 'onGive'>) {
  const done = keys.filter((key) => given.has(key)).length
  const all = done === keys.length
  return (
    <input
      type="checkbox"
      checked={all}
      ref={(el) => {
        if (el !== null) el.indeterminate = !all && done > 0
      }}
      onChange={() => onGive(keys, !all)}
      aria-label={label}
    />
  )
}

/** The item page's done treatment, so "given" reads the same on both screens. */
const doneStyle = (done: boolean): React.CSSProperties | undefined =>
  done ? { color: 'var(--ink-faint)', textDecoration: 'line-through' } : undefined

function FoldControls({ keys, onFoldAll }: { keys: string[]; onFoldAll: FoldProps['onFoldAll'] }) {
  return (
    <div className="flex items-center justify-end gap-2 text-xs">
      <button
        type="button"
        onClick={() => onFoldAll(keys, true)}
        className="tap-target text-ink-faint underline decoration-rule underline-offset-4 hover:text-ink"
      >
        Collapse all
      </button>
      <button
        type="button"
        onClick={() => onFoldAll(keys, false)}
        className="tap-target text-ink-faint underline decoration-rule underline-offset-4 hover:text-ink"
      >
        Expand all
      </button>
    </div>
  )
}

/** Group order = the one canonical category order, shared with Browse. */
const CATEGORY_ORDER = Object.keys(CATEGORY_LABELS)

function ItemList({
  wanted,
  collapsed,
  searchActive,
  onToggle,
  onFoldAll,
  given,
  onGive,
  shown,
}: { wanted: ReturnType<typeof itemsWanted> } & FoldProps & TrackProps) {
  const groups = useMemo(() => {
    const byCategory = new Map<string, ReturnType<typeof itemsWanted>>()
    for (const entry of wanted) {
      // A category the label map does not know shelves under "Other" rather
      // than leaking a raw token or dropping the row (rule 8).
      const key = CATEGORY_LABELS[entry.category] === undefined ? 'misc' : entry.category
      byCategory.set(key, [...(byCategory.get(key) ?? []), entry])
    }
    return [...byCategory.entries()].sort(
      (a, b) => CATEGORY_ORDER.indexOf(a[0]) - CATEGORY_ORDER.indexOf(b[0]),
    )
  }, [wanted])

  if (wanted.length === 0) return <Empty>Nothing is asked for in this season.</Empty>

  return (
    <div className="mt-4 flex flex-col gap-4">
      <FoldControls keys={groups.map(([category]) => `items:${category}`)} onFoldAll={onFoldAll} />
      {groups.map(([category, entries]) => {
        const foldKey = `items:${category}`
        const folded = collapsed.has(foldKey) && !searchActive
        return (
          <section key={category}>
            <h2>
              <button
                type="button"
                onClick={() => onToggle(foldKey)}
                aria-expanded={!folded}
                className="tap-target flex w-full items-center gap-2 text-left font-display font-semibold text-ink text-sm"
              >
                <ChevronDown
                  aria-hidden
                  size={14}
                  strokeWidth={2}
                  className={`shrink-0 text-ink-faint transition-transform ${folded ? '-rotate-90' : ''}`}
                />
                {CATEGORY_LABELS[category]}
                <span data-numeral className="font-normal text-ink-faint text-xs">
                  {entries.length}
                </span>
              </button>
            </h2>
            {folded ? null : (
              <ItemRows entries={entries} given={given} onGive={onGive} shown={shown} />
            )}
          </section>
        )
      })}
    </div>
  )
}

function ItemRows({
  entries,
  given,
  onGive,
  shown,
}: { entries: ReturnType<typeof itemsWanted> } & TrackProps) {
  return (
    <ul className="mt-1.5 flex flex-col divide-y divide-rule border-rule border-y">
      {entries.map((entry) => {
        // The row aggregates every request wanting this item, so its tick
        // covers all of them; a tick made on one request's item page renders
        // as the in-between (indeterminate) state.
        const keys = entry.request_ids.map((requestId) => `${requestId}/${entry.id}`)
        const allGiven = keys.every((key) => given.has(key))
        return (
          <li key={entry.id} className="flex items-center gap-3 py-2.5">
            <GivenBox keys={keys} given={given} onGive={onGive} label={`${entry.name} — given`} />
            <ItemIcon iconKey={entry.icon_key ?? `item/${entry.id}`} name={entry.name} size="sm" />

            <div className="min-w-0 flex-1">
              <p className="truncate text-sm">
                <Link
                  to="/item/$id"
                  params={{ id: entry.id }}
                  className="text-ink underline decoration-transparent underline-offset-4 transition-colors hover:decoration-rule"
                  style={doneStyle(allGiven)}
                >
                  {entry.name}
                </Link>
              </p>
              <p className="truncate text-ink-faint text-xs">
                {entry.askers.length > 1 && `${entry.askers.length} villagers · `}
                {entry.askers.slice(0, 3).map((asker, i) => {
                  // A spoiler asker keeps their place in the run and loses the
                  // name — the chip is the redaction, and the link still goes
                  // where it went (the villager page is the one that asks).
                  const veiled = asker.spoiler === true && (asker.id === null || !shown(asker.id))
                  return (
                    <span key={asker.name}>
                      {i > 0 && ', '}
                      {asker.id === null ? (
                        veiled ? (
                          <SpoilerChip size={14} />
                        ) : (
                          asker.name
                        )
                      ) : (
                        <Link
                          to="/villager/$id"
                          params={{ id: asker.id }}
                          className="underline decoration-transparent underline-offset-4 transition-colors hover:text-ink hover:decoration-rule"
                        >
                          {veiled ? <SpoilerChip size={14} /> : asker.name}
                        </Link>
                      )}
                    </span>
                  )
                })}
                {/* Name the gate rather than hedging. 106 of the 193 items are
                  gated, and they all used to read "not from the start" — which
                  is true of every one and tells you nothing about any. "The
                  Mines unlocked" or "Year 2" is the same sentence's worth of
                  space and is the answer. Several labels are alternative
                  routes, so they join with "or". */}
                {entry.gated && entry.gateLabels.length > 0 && (
                  <> · {entry.gateLabels.slice(0, 2).join(' or ')}</>
                )}
                {entry.gated && entry.gateLabels.length > 2 && (
                  <> or {entry.gateLabels.length - 2} other ways</>
                )}
                {entry.gated && entry.gateLabels.length === 0 && ' · not from the start'}
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
        )
      })}
    </ul>
  )
}

function VillagerList({
  requests,
  collapsed,
  searchActive,
  onToggle,
  onFoldAll,
  given,
  onGive,
  shown,
}: { requests: BoardRequest[] } & FoldProps & TrackProps) {
  const byVillager = useMemo(() => {
    const groups = new Map<string, { name: string; spoiler: boolean; requests: BoardRequest[] }>()
    for (const request of requests) {
      const key = request.giver_id ?? 'unknown'
      const group = groups.get(key) ?? {
        name: request.giver_name ?? 'Not attributed',
        spoiler: request.giver_spoiler === true,
        requests: [],
      }
      group.requests.push(request)
      groups.set(key, group)
    }
    // Sorted by what actually renders: a veiled group files under its
    // placeholder, because alphabetising by the real name would leak its
    // initial through its position.
    const label = (id: string, group: { name: string; spoiler: boolean }): string =>
      group.spoiler && id !== 'unknown' && !shown(id) ? 'Hidden villager' : group.name
    return [...groups.entries()].sort((a, b) => label(a[0], a[1]).localeCompare(label(b[0], b[1])))
  }, [requests, shown])

  if (byVillager.length === 0) return <Empty>Nobody asks for anything in this season.</Empty>

  return (
    <div className="mt-4 flex flex-col gap-4">
      <FoldControls keys={byVillager.map(([id]) => `villager:${id}`)} onFoldAll={onFoldAll} />
      {byVillager.map(([id, group]) => {
        const foldKey = `villager:${id}`
        const folded = collapsed.has(foldKey) && !searchActive
        // A veiled giver keeps the group and the link and loses the name and
        // the face — a sprite is as much a spoiler as the text beside it. The
        // villager page is the one that asks.
        const veiled = group.spoiler && id !== 'unknown' && !shown(id)
        return (
          <section key={id}>
            <h2 className="flex items-center gap-2 font-display font-semibold text-ink text-sm">
              {/* The chevron is its own button beside the name — a link inside
                a fold button would be one click with two meanings. */}
              <button
                type="button"
                onClick={() => onToggle(foldKey)}
                aria-expanded={!folded}
                aria-label={veiled ? "Hidden villager's requests" : `${group.name}'s requests`}
                className="tap-target flex items-center"
              >
                <ChevronDown
                  aria-hidden
                  size={14}
                  strokeWidth={2}
                  className={`shrink-0 text-ink-faint transition-transform ${folded ? '-rotate-90' : ''}`}
                />
              </button>
              {/* `character/<id>` is the icon key by convention, so the face
                needs no display index — this screen ships its own joined
                form and deliberately never loads one. */}
              {id !== 'unknown' && !veiled && (
                <ItemIcon iconKey={`character/${id}`} name={group.name} size="sm" />
              )}
              {id === 'unknown' ? (
                group.name
              ) : (
                <Link
                  to="/villager/$id"
                  params={{ id }}
                  className={
                    veiled
                      ? 'inline-flex items-center gap-1.5'
                      : 'underline decoration-transparent underline-offset-4 transition-colors hover:decoration-rule'
                  }
                >
                  {veiled ? <SpoilerChip /> : group.name}
                </Link>
              )}
              <span className="font-normal text-ink-faint">· {group.requests.length}</span>
            </h2>
            {folded ? null : (
              <ul className="mt-1.5 flex flex-col divide-y divide-rule border-rule border-y">
                {group.requests.map((request) => {
                  // One tick per request, over every item it wants — the same
                  // keys the item page's "needed for" section writes. A
                  // request the wiki lists no items for has nothing to hand
                  // in, so it gets no box rather than a box that tracks
                  // nothing.
                  const keys = request.items.map((item) => `${request.id}/${item.id}`)
                  const allGiven = keys.length > 0 && keys.every((key) => given.has(key))
                  return (
                    <li key={request.id} className="flex items-center gap-3 py-2">
                      {keys.length > 0 && (
                        <GivenBox
                          keys={keys}
                          given={given}
                          onGive={onGive}
                          label={`${request.name} — given`}
                        />
                      )}
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
                        <p className="truncate text-ink text-sm" style={doneStyle(allGiven)}>
                          {request.items.length === 0 ? (
                            // A request whose items the wiki never listed still has a
                            // quest page — the name is the way in, not a dead label.
                            <Link
                              to="/quest/$id"
                              params={{ id: request.id }}
                              className="underline decoration-transparent underline-offset-4 transition-colors hover:decoration-rule"
                            >
                              {request.name}
                            </Link>
                          ) : (
                            request.items.map((i, idx) => (
                              <span key={i.id}>
                                {idx > 0 && ', '}
                                <Link
                                  to="/item/$id"
                                  params={{ id: i.id }}
                                  className="underline decoration-transparent underline-offset-4 transition-colors hover:decoration-rule"
                                >
                                  {i.name}
                                </Link>
                                {i.quantity > 1 && ` ×${i.quantity}`}
                              </span>
                            ))
                          )}
                        </p>
                        {request.gates.length > 0 && (
                          <p className="truncate text-ink-faint text-xs">
                            {request.gates.map((g, idx) => (
                              <span key={`${g.type}:${g.key ?? g.label}`}>
                                {idx > 0 && ' · '}
                                {g.key !== undefined &&
                                (g.type === 'quest' || g.type === 'location') ? (
                                  <Link
                                    to={g.type === 'quest' ? '/quest/$id' : '/place/$id'}
                                    params={{ id: g.key }}
                                    className="underline decoration-transparent underline-offset-4 transition-colors hover:text-ink hover:decoration-rule"
                                  >
                                    {g.label}
                                  </Link>
                                ) : (
                                  g.label
                                )}
                              </span>
                            ))}
                          </p>
                        )}
                      </div>
                      {request.rewards?.tesserae != null && (
                        <span data-numeral className="shrink-0 text-ink-mute text-xs tabular-nums">
                          {request.rewards.tesserae}t
                        </span>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        )
      })}
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
          className="tap-target px-3 py-1 text-xs transition-colors"
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
      className="tap-target rounded-pill border border-rule px-2.5 py-1 text-xs transition-colors"
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
