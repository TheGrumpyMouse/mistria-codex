import { Link } from '@tanstack/react-router'
import { useEffect, useMemo, useState } from 'react'
import { Column } from '~/app/AppShell'
import { ItemIcon } from '~/components/ItemIcon'
import { type DisplayIndex, loadDataset, loadDisplayIndex } from '~/lib/data'
import { doneIn, setDone } from '~/lib/progress'

/**
 * The museum, and what it is still missing.
 *
 * Progress lives on the device, in one flat Dexie table, and the checkbox writes
 * a timestamp rather than a boolean — see `lib/progress.ts` for why that makes
 * the whole thing a CRDT before any sync code exists.
 *
 * The gap view is the point. A list of what you have is a trophy cabinet; a list
 * of what you are missing is a plan for the afternoon, and it is what the Today
 * screen will cross-reference at A5's other half.
 */

interface MuseumSet {
  id: string
  name: string
  wing: string
  item_ids: string[]
  required_count: number
  display_order: number
}

const WINGS = [
  { id: 'archaeology', label: 'Archaeology' },
  { id: 'fish', label: 'Fish' },
  { id: 'insects', label: 'Insects' },
  { id: 'flora', label: 'Flora' },
] as const

export function MuseumRoute() {
  const [sets, setSets] = useState<MuseumSet[] | null>(null)
  const [index, setIndex] = useState<DisplayIndex>({})
  const [donated, setDonated] = useState<Set<string>>(new Set())
  const [wing, setWing] = useState<string>('archaeology')
  const [gapsOnly, setGapsOnly] = useState(false)

  useEffect(() => {
    let live = true
    Promise.all([loadDataset<MuseumSet>('museum_sets'), loadDisplayIndex(), doneIn('museum')])
      .then(([loadedSets, loadedIndex, done]) => {
        if (!live) return
        setSets(loadedSets)
        setIndex(loadedIndex)
        setDonated(done)
      })
      .catch(() => live && setSets([]))
    return () => {
      live = false
    }
  }, [])

  const toggle = (id: string): void => {
    const next = new Set(donated)
    const nowDone = !next.has(id)
    if (nowDone) next.add(id)
    else next.delete(id)
    // Optimistic: the write is local and cannot meaningfully fail, and waiting
    // on IndexedDB to tick a checkbox is a visible stutter on a phone.
    setDonated(next)
    void setDone('museum', id, nowDone)
  }

  const totals = useMemo(() => {
    const all = (sets ?? []).flatMap((s) => s.item_ids)
    return { have: all.filter((id) => donated.has(id)).length, total: all.length }
  }, [sets, donated])

  const shown = useMemo(
    () =>
      (sets ?? [])
        .filter((s) => s.wing === wing)
        .filter((s) => !gapsOnly || s.item_ids.some((id) => !donated.has(id)))
        .sort((a, b) => a.display_order - b.display_order || a.name.localeCompare(b.name)),
    [sets, wing, gapsOnly, donated],
  )

  if (sets === null) {
    return (
      <Column>
        <p className="text-ink-mute text-sm">Loading the museum…</p>
      </Column>
    )
  }

  return (
    <Column>
      <header>
        <h1 className="text-2xl">Museum</h1>
        <p className="mt-1 text-ink-mute text-sm">
          <span data-numeral>{totals.have}</span> of <span data-numeral>{totals.total}</span>{' '}
          donated across {sets.length} sets. Kept on this device.
        </p>
      </header>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1">
          {WINGS.map((w) => {
            const items = sets.filter((s) => s.wing === w.id).flatMap((s) => s.item_ids)
            const have = items.filter((id) => donated.has(id)).length
            return (
              <button
                key={w.id}
                type="button"
                onClick={() => setWing(w.id)}
                className="rounded-pill border border-rule px-2.5 py-1 text-xs transition-colors"
                style={
                  wing === w.id
                    ? { background: 'var(--museum-tint)', color: 'var(--ink)', fontWeight: 600 }
                    : { color: 'var(--ink-mute)' }
                }
              >
                {w.label}{' '}
                <span data-numeral>
                  {have}/{items.length}
                </span>
              </button>
            )
          })}
        </div>

        <label className="flex items-center gap-1.5 text-ink-mute text-xs">
          <input
            type="checkbox"
            checked={gapsOnly}
            onChange={(event) => setGapsOnly(event.target.checked)}
          />
          Only what is missing
        </label>
      </div>

      <div className="mt-4 flex flex-col gap-5">
        {shown.map((set) => {
          const have = set.item_ids.filter((id) => donated.has(id)).length
          const complete = have >= set.required_count
          return (
            <section key={set.id}>
              <h2 className="flex items-baseline gap-2 font-display font-semibold text-ink text-sm">
                {set.name}
                <span
                  data-numeral
                  className="font-normal text-xs"
                  style={{ color: complete ? 'var(--museum)' : 'var(--ink-faint)' }}
                >
                  {have}/{set.required_count}
                </span>
              </h2>

              <ul className="mt-1.5 flex flex-col divide-y divide-rule border-rule border-y">
                {set.item_ids
                  .filter((id) => !gapsOnly || !donated.has(id))
                  .map((id) => {
                    const entry = index[id]
                    const isDone = donated.has(id)
                    return (
                      <li key={id} className="flex items-center gap-3 py-2">
                        <input
                          type="checkbox"
                          checked={isDone}
                          onChange={() => toggle(id)}
                          aria-label={`${entry?.n ?? id} donated`}
                        />
                        <ItemIcon
                          iconKey={entry?.i ?? `item/${id}`}
                          name={entry?.n ?? id}
                          size="sm"
                        />
                        <Link
                          to="/item/$id"
                          params={{ id }}
                          className="min-w-0 flex-1 truncate text-sm"
                          style={{
                            color: isDone ? 'var(--ink-faint)' : 'var(--ink)',
                            textDecoration: isDone ? 'line-through' : 'none',
                          }}
                        >
                          {entry?.n ?? id.replace(/_/g, ' ')}
                        </Link>

                        {/*
                          The most valuable placement of the reverse lookup:
                          this row is a thing you still need, and "when can I
                          get it" is the only question left about it. Not shown
                          on a donated row — that question is answered.
                        */}
                        {!isDone && (
                          <Link
                            to="/item/$id/when"
                            params={{ id }}
                            className="shrink-0 text-ink-faint text-xs underline decoration-rule underline-offset-4 hover:text-ink"
                          >
                            when?
                          </Link>
                        )}
                      </li>
                    )
                  })}
              </ul>
            </section>
          )
        })}
      </div>

      {shown.length === 0 && (
        <p className="mt-6 text-ink-mute text-sm">
          Nothing missing in this wing. That is the whole wing done.
        </p>
      )}

      <p className="mt-6 text-ink-faint text-xs leading-relaxed">
        Progress is stored on this device only. Nothing is sent anywhere — syncing to a second
        device arrives at S1, and will be something you opt into with a code.
      </p>
    </Column>
  )
}
