import { getRouteApi, Link } from '@tanstack/react-router'
import { useEffect, useMemo, useState } from 'react'
import { Column } from '~/app/AppShell'
import { useAtlas } from '~/app/AtlasProvider'
import { ItemIcon } from '~/components/ItemIcon'
import { Section, Unknown } from '~/components/Section'
import { type DisplayIndex, loadDataset, loadDisplayIndex } from '~/lib/data'

const route = getRouteApi('/villager/$id')

/**
 * One villager: when their birthday is, and what to give them.
 *
 * It exists because search already found them. Characters, monsters and places
 * are all in the display index, so typing a name has always returned them — and
 * every one of those rows pointed at `/item/$id`, which loads `items.json` and
 * says "not found" for anyone who is not an item. A search result that leads
 * nowhere is worse than no result: it reads as missing data rather than as a
 * missing screen.
 *
 * Gifts are the reason to be here, so they are the body of the page rather than
 * a footnote. Loved and liked come first and hated is kept — knowing what to
 * never hand over is worth as much as knowing what to bring.
 */

interface CharacterRecord {
  id: string
  name: string
  also_known_as: string[]
  icon_key: string | null
  birthday: { season: string; day: number } | null
  romanceable: boolean | null
  species: string | null
  gender: string | null
  occupation: string | null
  affiliation: string | null
  family: { relation: string; character_id: string | null }[]
  data_gaps: string[]
}

interface GiftPrefsRecord {
  character_id: string
  prefs: Record<string, string[]>
}

/** Best first, and hated last rather than dropped. */
const PREF_ORDER = ['loved', 'liked', 'disliked', 'hated'] as const

/**
 * Above this many, a gift list folds itself away.
 *
 * Set from the shape of the data rather than by taste: loved and liked run to
 * about twenty, and disliked runs to over a hundred because it is the residue
 * of everything else. Thirty separates the two without a special case for which
 * level it is.
 */
const COLLAPSE_OVER = 30

const PREF_LABELS: Record<string, string> = {
  loved: 'Loves',
  liked: 'Likes',
  disliked: 'Dislikes',
  hated: 'Hates',
}

export function VillagerRoute() {
  const { id } = route.useParams()
  const [state, setState] = useState<{
    person: CharacterRecord | null
    prefs: GiftPrefsRecord | null
    index: DisplayIndex
    loading: boolean
  }>({ person: null, prefs: null, index: {}, loading: true })

  useEffect(() => {
    let live = true
    Promise.all([
      loadDataset<CharacterRecord>('characters'),
      loadDataset<GiftPrefsRecord>('gift_prefs'),
      loadDisplayIndex(),
    ])
      .then(([characters, prefs, index]) => {
        if (!live) return
        setState({
          person: characters.find((c) => c.id === id) ?? null,
          prefs: prefs.find((p) => p.character_id === id) ?? null,
          index,
          loading: false,
        })
      })
      .catch(() => live && setState((s) => ({ ...s, loading: false })))
    return () => {
      live = false
    }
  }, [id])

  const { person, prefs, index, loading } = state
  const portrait = useAtlas().portrait(person?.icon_key ?? null)

  // Sorted by the name they will be read under, not by id — `ore_copper` next
  // to `apple` is alphabetical by nothing anyone can see.
  const gifts = useMemo(() => {
    const named = (ids: string[]): { id: string; name: string }[] =>
      ids
        .map((itemId) => ({ id: itemId, name: index[itemId]?.n ?? itemId.replace(/_/g, ' ') }))
        .sort((a, b) => a.name.localeCompare(b.name))

    return PREF_ORDER.flatMap((level) => {
      const ids = prefs?.prefs[level] ?? []
      return ids.length === 0 ? [] : [{ level, items: named(ids) }]
    })
  }, [prefs, index])

  if (loading) {
    return (
      <Column>
        <p className="text-ink-mute text-sm">Loading…</p>
      </Column>
    )
  }

  if (person === null) {
    return (
      <Column>
        <h1 className="text-2xl">Not found</h1>
        <p className="mt-1 text-ink-mute text-sm">
          Nobody here is called <code>{id}</code>.{' '}
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
      <header className="flex items-center gap-3">
        {/*
          The portrait, where there is one, and the sprite otherwise.
          `atlas.portrait` has existed since AS1 and nothing used it: 28
          portraits shipped in the bundle and the app never drew one. Nine
          villagers have no small sprite at all — the Priestess among them — so
          before this her page was a hashed glyph next to a portrait sitting
          unused in the same directory.
        */}
        {portrait === null ? (
          <ItemIcon
            iconKey={person.icon_key ?? `character/${person.id}`}
            name={person.name}
            size="lg"
          />
        ) : (
          <img
            src={portrait}
            alt=""
            width={72}
            height={72}
            className="sprite shrink-0 rounded-tile object-cover"
            style={{ width: 72, height: 72 }}
          />
        )}
        <div className="min-w-0">
          <h1 className="truncate text-2xl">{person.name}</h1>
          {/*
            The game and the wiki both name her correctly and differently: the
            wiki uses the title because that is what you see until she tells you
            her name. Showing both is the only version that is not misleading to
            one half of the people reading it.
          */}
          {person.also_known_as.length > 0 && (
            <p className="mt-0.5 text-ink-mute text-sm">
              also known as {person.also_known_as.join(', ')}
            </p>
          )}
          {person.occupation !== null && (
            <p className="mt-0.5 text-ink-mute text-sm">{person.occupation}</p>
          )}
        </div>
      </header>

      <Section title="About">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <Fact label="Birthday">
            {person.birthday === null ? (
              <Unknown>not recorded</Unknown>
            ) : (
              <span
                className="rounded-pill px-1.5 py-0.5 text-xs"
                style={{
                  background: `var(--${person.birthday.season}-tint)`,
                  color: `var(--${person.birthday.season})`,
                }}
              >
                {person.birthday.season} <span data-numeral>{person.birthday.day}</span>
              </span>
            )}
          </Fact>
          {person.species !== null && <Fact label="Species">{person.species}</Fact>}
          {person.gender !== null && <Fact label="Gender">{person.gender}</Fact>}
          {person.affiliation !== null && <Fact label="Affiliation">{person.affiliation}</Fact>}
          {/* Null is unknown, and unknown is not "no". Only a stated `false`
              earns the word. */}
          {person.romanceable !== null && (
            <Fact label="Romanceable">{person.romanceable ? 'Yes' : 'No'}</Fact>
          )}
        </dl>
      </Section>

      <Section title="Gifts">
        {gifts.length === 0 ? (
          <Unknown>No gift preferences recorded.</Unknown>
        ) : (
          <ul className="flex flex-col gap-3">
            {gifts.map(({ level, items }) => {
              const list = (
                <p className="mt-0.5 text-ink-mute text-sm leading-relaxed">
                  {items.map((item, i) => (
                    <span key={item.id}>
                      {i > 0 && ', '}
                      <Link
                        to="/item/$id"
                        params={{ id: item.id }}
                        className="underline decoration-rule underline-offset-4 hover:text-ink"
                      >
                        {item.name}
                      </Link>
                    </span>
                  ))}
                </p>
              )

              // Collapsed past a threshold, and only the long ones collapse.
              // The Priestess dislikes 116 things and loves 10, and printed
              // flat the answer you came for is a screen and a half above the
              // one you did not. `<details>` rather than a state hook: it is
              // keyboard-operable, announced, and findable by the browser's own
              // find-in-page when open.
              const label = (
                <>
                  {PREF_LABELS[level] ?? level}
                  <span className="text-ink-faint"> · {items.length}</span>
                </>
              )

              return (
                <li key={level}>
                  {items.length <= COLLAPSE_OVER ? (
                    <>
                      <p className="text-ink text-sm">{label}</p>
                      {list}
                    </>
                  ) : (
                    <details>
                      <summary className="cursor-pointer text-ink text-sm">{label}</summary>
                      {list}
                    </details>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </Section>

      {person.family.length > 0 && (
        <Section title="Family">
          {/* The wiki writes these as free text — "Eiland (Brother)" — and they
              are not resolved to character ids yet, so they are shown as written
              rather than linked to a page that might be the wrong person. */}
          <p className="text-ink-mute text-sm">
            {person.family.map((entry) => entry.relation).join(' · ')}
          </p>
        </Section>
      )}

      {person.data_gaps.length > 0 && (
        <p className="mt-6 text-ink-faint text-xs">
          Not recorded: {person.data_gaps.join(', ').replace(/_/g, ' ')}.
        </p>
      )}
    </Column>
  )
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-ink-mute">{label}</dt>
      <dd className="text-ink">{children}</dd>
    </>
  )
}
