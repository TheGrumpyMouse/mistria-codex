import { getRouteApi, Link } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { Column } from '~/app/AppShell'
import { BackLink } from '~/components/BackLink'
import { ItemIcon } from '~/components/ItemIcon'
import { NotRecorded, Section, Unknown } from '~/components/Section'
import { SpoilerAsk } from '~/components/Spoiler'
import { type DisplayIndex, loadDataset, loadDisplayIndex } from '~/lib/data'
import { routeFor } from '~/lib/search'
import { useSpoilers } from '~/lib/spoilers'

const route = getRouteApi('/quest/$id')

/**
 * One quest: who gives it, what it asks for, what it pays, and — for the
 * seals — what it costs.
 *
 * Exists because search covers quests, and a result has to land somewhere.
 * Objectives and prerequisites render only where the data has them (the 212
 * requests, mostly); story quests carry them as gaps because the wiki's quest
 * page is prose, and the honest version shows nothing rather than scaffolding.
 */

interface QuestRecord {
  id: string
  name: string
  spoiler?: boolean
  kind: string
  giver_character_id: string | null
  repeatable: boolean
  season_restriction: string[] | null
  prerequisites: { type: string; key: string; value?: number | null }[]
  objectives: { type: string; target_id: string | null; quantity: number | null }[]
  rewards: { item_ids: string[]; renown: number | null; tesserae: number | null } | null
  data_gaps: string[]
  wiki_page: string | null
}

interface SealRecord {
  id: string
  name: string
  quest_id: string
  required_items: { item_id: string; quantity: number }[]
}

/** Every kind the dataset ships; an unknown one falls back to "Quest". */
const KIND_LABELS: Record<string, string> = {
  story: 'Story quest',
  request: 'Request',
  heart: 'Heart event',
  crown: 'Crown quest',
  cooking_challenge: 'Cooking challenge',
  mission: 'Mission',
  important: 'Important quest',
  festival: 'Festival',
}

export function QuestRoute() {
  const { id } = route.useParams()
  const [state, setState] = useState<{
    quest: QuestRecord | null
    seal: SealRecord | null
    index: DisplayIndex
    loading: boolean
  }>({ quest: null, seal: null, index: {}, loading: true })

  useEffect(() => {
    let live = true
    Promise.all([
      loadDataset<QuestRecord>('quests'),
      loadDataset<SealRecord>('seals'),
      loadDisplayIndex(),
    ])
      .then(([quests, seals, index]) => {
        if (!live) return
        setState({
          quest: quests.find((q) => q.id === id) ?? null,
          seal: seals.find((s) => s.quest_id === id) ?? null,
          index,
          loading: false,
        })
      })
      .catch(() => live && setState((s) => ({ ...s, loading: false })))
    return () => {
      live = false
    }
  }, [id])

  const spoilers = useSpoilers()
  const { quest, seal, index, loading } = state

  if (loading) {
    return (
      <Column>
        <p className="text-ink-mute text-sm">Loading…</p>
      </Column>
    )
  }

  if (quest === null) {
    return (
      <Column>
        <h1 className="text-2xl">Not found</h1>
        <p className="mt-1 text-ink-mute text-sm">
          No quest here goes by “{id.replace(/_/g, ' ')}”.{' '}
          <Link to="/search" className="underline decoration-rule underline-offset-4">
            Search instead
          </Link>
          .
        </p>
      </Column>
    )
  }

  const giver = quest.giver_character_id

  // The veil covers the whole page, name included — the name is the spoiler.
  if (quest.spoiler === true && !spoilers.shown(quest.id)) {
    return (
      <Column>
        <BackLink />
        <SpoilerAsk id={quest.id} kind="quest" />
      </Column>
    )
  }

  return (
    <Column>
      <BackLink />
      <header>
        <h1 className="text-2xl">{quest.name}</h1>
        <p className="mt-0.5 text-ink-mute text-sm">
          {KIND_LABELS[quest.kind] ?? 'Quest'}
          {giver !== null && (
            <>
              {' · from '}
              <Link
                to="/villager/$id"
                params={{ id: giver }}
                className="underline decoration-rule underline-offset-4 hover:text-ink"
              >
                {index[giver]?.n ?? giver.replace(/_/g, ' ')}
              </Link>
            </>
          )}
          {quest.repeatable && ' · repeatable'}
        </p>
      </header>

      {quest.season_restriction !== null && quest.season_restriction.length > 0 && (
        <p className="mt-3 flex gap-1">
          {quest.season_restriction.map((season) => (
            <span
              key={season}
              className="rounded-pill px-1.5 py-0.5 text-[0.625rem]"
              style={{ background: `var(--${season}-tint)`, color: `var(--${season})` }}
            >
              {season} only
            </span>
          ))}
        </p>
      )}

      {/* A seal quest's real content is its price. The game states it as data,
          so it renders as a shopping list rather than a paragraph. */}
      {seal !== null && seal.required_items.length > 0 && (
        <Section title={`To break ${seal.name.replace(/^The /, 'the ')}, bring`}>
          <ul className="flex flex-col divide-y divide-rule border-rule border-y">
            {seal.required_items.map((entry) => (
              <li key={entry.item_id}>
                <Link
                  to="/item/$id"
                  params={{ id: entry.item_id }}
                  className="flex items-center gap-3 py-2 transition-colors hover:bg-sunk"
                >
                  <ItemIcon
                    iconKey={index[entry.item_id]?.i ?? `item/${entry.item_id}`}
                    name={index[entry.item_id]?.n ?? entry.item_id}
                    size="sm"
                  />
                  <span className="min-w-0 flex-1 truncate text-ink text-sm">
                    {index[entry.item_id]?.n ?? entry.item_id.replace(/_/g, ' ')}
                  </span>
                  <span data-numeral className="shrink-0 text-ink-mute text-xs">
                    ×{entry.quantity}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* What the quest wants handed over or done — recorded for the requests
          (the wiki states their items) and mostly a gap for story quests. */}
      {quest.objectives.some((o) => o.target_id !== null) && seal === null && (
        <Section title="What it asks for">
          <ul className="flex flex-col divide-y divide-rule border-rule border-y">
            {quest.objectives.flatMap((objective) =>
              objective.target_id === null
                ? []
                : [
                    <li key={objective.target_id}>
                      <Link
                        to={routeFor(index[objective.target_id]?.c ?? 'misc')}
                        params={{ id: objective.target_id }}
                        className="flex items-center gap-3 py-2 transition-colors hover:bg-sunk"
                      >
                        <ItemIcon
                          iconKey={index[objective.target_id]?.i ?? `item/${objective.target_id}`}
                          name={index[objective.target_id]?.n ?? objective.target_id}
                          size="sm"
                        />
                        <span className="min-w-0 flex-1 truncate text-ink text-sm">
                          {index[objective.target_id]?.n ?? objective.target_id.replace(/_/g, ' ')}
                        </span>
                        <span data-numeral className="shrink-0 text-ink-mute text-xs">
                          ×{objective.quantity ?? 1}
                        </span>
                      </Link>
                    </li>,
                  ],
            )}
          </ul>
        </Section>
      )}

      {quest.prerequisites.length > 0 && (
        <Section title="Before it appears">
          <ul className="flex flex-col gap-1 text-ink-mute text-sm">
            {quest.prerequisites.map((r) => (
              <li key={`${r.type}:${r.key}`}>
                <Prerequisite requirement={r} index={index} />
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Rewards">
        {quest.rewards === null ? (
          <Unknown>No rewards recorded.</Unknown>
        ) : (
          <>
            {(quest.rewards.tesserae !== null || quest.rewards.renown !== null) && (
              <p className="text-ink-mute text-sm">
                {quest.rewards.tesserae !== null && (
                  <span data-numeral>{quest.rewards.tesserae}t</span>
                )}
                {quest.rewards.tesserae !== null && quest.rewards.renown !== null && ' · '}
                {quest.rewards.renown !== null && (
                  <>
                    <span data-numeral>{quest.rewards.renown}</span> renown
                  </>
                )}
              </p>
            )}
            {quest.rewards.item_ids.length > 0 && (
              <ul className="mt-1.5 flex flex-col divide-y divide-rule border-rule border-y">
                {quest.rewards.item_ids.map((itemId) => (
                  <li key={itemId}>
                    <Link
                      to="/item/$id"
                      params={{ id: itemId }}
                      className="flex items-center gap-3 py-2 transition-colors hover:bg-sunk"
                    >
                      <ItemIcon
                        iconKey={index[itemId]?.i ?? `item/${itemId}`}
                        name={index[itemId]?.n ?? itemId}
                        size="sm"
                      />
                      <span className="min-w-0 flex-1 truncate text-ink text-sm">
                        {index[itemId]?.n ?? itemId.replace(/_/g, ' ')}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            {quest.rewards.item_ids.length === 0 &&
              quest.rewards.tesserae === null &&
              quest.rewards.renown === null && <Unknown>No rewards recorded.</Unknown>}
          </>
        )}
      </Section>

      <NotRecorded gaps={quest.data_gaps} wikiPage={quest.wiki_page} />
    </Column>
  )
}

/**
 * One prerequisite as a sentence fragment, with the named thing linked when it
 * has a page. The wording matches the board's gate labels, so the same fact
 * reads the same everywhere.
 */
function Prerequisite({
  requirement,
  index,
}: {
  requirement: { type: string; key: string; value?: number | null }
  index: DisplayIndex
}) {
  const entry = index[requirement.key]
  const name = entry?.n ?? requirement.key.replace(/_/g, ' ')
  const linked =
    entry === undefined ? (
      name
    ) : (
      <Link
        to={routeFor(entry.c)}
        params={{ id: requirement.key }}
        className="underline decoration-rule underline-offset-4 hover:text-ink"
      >
        {name}
      </Link>
    )

  switch (requirement.type) {
    case 'quest':
      return <>after {linked}</>
    case 'location':
      return <>{linked} unlocked</>
    case 'skill':
      return (
        <>
          {name} Lv.{requirement.value ?? '?'}
        </>
      )
    case 'year':
      return <>Year {requirement.value ?? '?'}</>
    case 'building':
      return <>a {name}</>
    case 'tool':
    case 'item':
      return <>holding a {linked}</>
    default:
      return <>{linked}</>
  }
}
