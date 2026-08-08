import { SEASONS } from '@mistria/schema'
import { getRouteApi, Link } from '@tanstack/react-router'
import { useEffect, useMemo, useState } from 'react'
import { Column } from '~/app/AppShell'
import { ItemIcon } from '~/components/ItemIcon'
import { type DisplayIndex, loadDataset, loadDisplayIndex } from '~/lib/data'

const route = getRouteApi('/item/$id')

/**
 * One item: what it is worth, where it comes from, and who wants it.
 *
 * This is the screen that needs the full record, so it is the one screen that
 * loads `items.json`. That is the right trade — you arrive here having chosen a
 * single thing, so a one-off second of loading buys every field — and it is why
 * no *list* screen loads it.
 */

interface ItemRecord {
  id: string
  name: string
  icon_key: string | null
  category: string
  sell_value: number | null
  buy_value: number | null
  is_giftable: boolean | null
  data_gaps: string[]
  museum: { donatable: boolean; set_id: string | null; wing: string | null }
  sold_by: string[]
  availability: {
    method: string
    seasons: string[]
    weather: string[] | null
    locations: string[]
    time: { from: string; to: string }[] | null
    rarity: string | null
    confidence: string
  }[]
}

interface GiftPrefs {
  character_id: string
  prefs: Record<string, string[]>
}

const METHOD_LABELS: Record<string, string> = {
  fishing: 'Fishing',
  diving: 'Diving',
  fish_trap: 'The fish trap',
  bug_net: 'Bug net',
  foraging: 'Foraging',
  crop_harvest: 'Harvesting',
  dig_spot: 'Digging',
  shop: 'Bought',
  mine_drop: 'In the mines',
}

/** The four levels the wiki records, best first. */
const PREF_ORDER = ['loved', 'liked', 'neutral', 'disliked', 'hated'] as const

export function ItemRoute() {
  const { id } = route.useParams()
  const [state, setState] = useState<{
    item: ItemRecord | null
    index: DisplayIndex
    prefs: GiftPrefs[]
    names: Map<string, string>
    loading: boolean
  }>({ item: null, index: {}, prefs: [], names: new Map(), loading: true })

  useEffect(() => {
    let live = true
    Promise.all([
      loadDataset<ItemRecord>('items'),
      loadDisplayIndex(),
      loadDataset<GiftPrefs>('gift_prefs'),
      loadDataset<{ id: string; name: string }>('locations'),
    ])
      .then(([items, index, prefs, locations]) => {
        if (!live) return
        setState({
          item: items.find((i) => i.id === id) ?? null,
          index,
          prefs,
          names: new Map(locations.map((l) => [l.id, l.name])),
          loading: false,
        })
      })
      .catch(() => live && setState((s) => ({ ...s, loading: false })))
    return () => {
      live = false
    }
  }, [id])

  const { item, index, prefs, names, loading } = state

  // Who feels how about this item, from the reverse of the gift table.
  const opinions = useMemo(() => {
    const byLevel = new Map<string, string[]>()
    for (const record of prefs) {
      for (const [level, ids] of Object.entries(record.prefs)) {
        if (!ids.includes(id)) continue
        byLevel.set(level, [...(byLevel.get(level) ?? []), record.character_id])
      }
    }
    return byLevel
  }, [prefs, id])

  if (loading) {
    return (
      <Column>
        <p className="text-ink-mute text-sm">Loading…</p>
      </Column>
    )
  }

  if (item === null) {
    return (
      <Column>
        <h1 className="text-2xl">Not found</h1>
        <p className="mt-1 text-ink-mute text-sm">
          Nothing here is called <code>{id}</code>.{' '}
          <Link to="/browse" className="underline decoration-rule underline-offset-4">
            Browse instead
          </Link>
          .
        </p>
      </Column>
    )
  }

  return (
    <Column>
      <header className="flex items-center gap-3">
        <ItemIcon iconKey={item.icon_key ?? `item/${item.id}`} name={item.name} size="lg" />
        <div className="min-w-0">
          <h1 className="truncate text-2xl">{item.name}</h1>
          <p className="mt-0.5 text-ink-mute text-sm">
            {item.category.replace(/_/g, ' ')}
            {item.sell_value !== null && (
              <>
                {' · sells for '}
                <span data-numeral>{item.sell_value}t</span>
              </>
            )}
          </p>
        </div>
      </header>

      {item.museum.donatable && (
        <p
          className="mt-3 rounded-card px-3 py-2 text-sm"
          style={{ background: 'var(--museum-tint)', color: 'var(--ink)' }}
        >
          The museum wants this — {item.museum.wing?.replace(/_/g, ' ') ?? 'wing unknown'} wing.
        </p>
      )}

      <Section title="Where to find it">
        {item.availability.length === 0 ? (
          <Unknown>No source recorded.</Unknown>
        ) : (
          <ul className="flex flex-col divide-y divide-rule border-rule border-y">
            {item.availability.map((window) => (
              // Keyed by what makes the window distinct rather than by its
              // position: an array index changes meaning the moment a window is
              // inserted, and these are ordered by the source, not by us.
              <li
                key={`${window.method}:${window.seasons.join()}:${window.locations.join()}`}
                className="py-2"
              >
                <p className="text-ink text-sm">
                  {METHOD_LABELS[window.method] ?? window.method}
                  {window.rarity !== null && window.rarity !== 'common' && (
                    <span className="text-ink-faint"> · {window.rarity.replace(/_/g, ' ')}</span>
                  )}
                </p>
                <p className="text-ink-mute text-xs">
                  {window.locations.length === 0
                    ? 'place unknown'
                    : window.locations.map((l) => names.get(l) ?? l).join(' · ')}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-1">
                  {SEASONS.filter((s) => window.seasons.includes(s)).map((season) => (
                    <span
                      key={season}
                      className="rounded-pill px-1.5 py-0.5 text-[10px]"
                      style={{ background: `var(--${season}-tint)`, color: `var(--${season})` }}
                    >
                      {season}
                    </span>
                  ))}
                  {window.time === null ? (
                    <span className="unverified rounded-tile px-1.5 py-0.5 text-[10px]">
                      any time
                    </span>
                  ) : (
                    window.time.map((range) => (
                      <span
                        key={`${range.from}-${range.to}`}
                        data-numeral
                        className="text-ink-faint text-[10px]"
                      >
                        {range.from}–{range.to}
                      </span>
                    ))
                  )}
                  {/* An inference must never render identically to a fact. */}
                  {window.confidence === 'inferred' && (
                    <span className="unverified rounded-tile px-1.5 py-0.5 text-[10px]">
                      place inferred
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {opinions.size > 0 && (
        <Section title="As a gift">
          <ul className="flex flex-col gap-1.5">
            {PREF_ORDER.filter((level) => opinions.has(level)).map((level) => (
              <li key={level} className="text-sm">
                <span className="text-ink capitalize">{level}</span>
                <span className="text-ink-mute">
                  {' — '}
                  {(opinions.get(level) ?? [])
                    .map((c) => index[c]?.n ?? c.replace(/_/g, ' '))
                    .sort()
                    .join(', ')}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {item.data_gaps.length > 0 && (
        <p className="mt-6 text-ink-faint text-xs">
          Not recorded: {item.data_gaps.join(', ').replace(/_/g, ' ')}.
        </p>
      )}
    </Column>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-5">
      <h2 className="font-display font-semibold text-ink text-sm">{title}</h2>
      <div className="mt-1.5">{children}</div>
    </section>
  )
}

const Unknown = ({ children }: { children: React.ReactNode }) => (
  <p className="unverified inline-block rounded-tile px-2 py-1 text-xs">{children}</p>
)
