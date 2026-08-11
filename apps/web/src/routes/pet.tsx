import { getRouteApi, Link } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { Column } from '~/app/AppShell'
import { BackLink } from '~/components/BackLink'
import { ItemIcon } from '~/components/ItemIcon'
import { PlaceLink } from '~/components/PlaceLink'
import { Section, Unknown } from '~/components/Section'
import { SpoilerAsk, veilReasonOf } from '~/components/Spoiler'
import { type DisplayIndex, loadDataset, loadDisplayIndex } from '~/lib/data'
import { useDocumentTitle } from '~/lib/head'
import { gapLabels, PET_JOB_LABELS, type PlaceLabel, placeLabels } from '~/lib/labels'
import { iconKeyFor } from '~/lib/search'
import { useSpoilers } from '~/lib/spoilers'

const route = getRouteApi('/pet/$id')

/**
 * One pet kind: its colourways and the jobs any pet can be sent on.
 *
 * The jobs are global — every pet works the same three, and the reward grows
 * with the pet's hearts. They render on each pet's page rather than only on
 * the Ranch because "what does my cat actually do" is asked about the cat.
 */

interface PetRecord {
  id: string
  name: string
  icon_key: string | null
  variants: { key: string; name: string | null }[]
  data_gaps: string[]
}

interface PetJob {
  job: 'wood' | 'stone' | 'forageables'
  location_id: string | null
  reward_item_id: string | null
  reward_custom: boolean
  reward_by_heart: [number, number][]
}

const range = ([min, max]: [number, number]): string => (min === max ? `${max}` : `${min}–${max}`)

export function PetRoute() {
  const { id } = route.useParams()
  const spoilers = useSpoilers()
  const [state, setState] = useState<{
    pet: PetRecord | null
    jobs: PetJob[]
    places: Map<string, PlaceLabel>
    index: DisplayIndex
    loading: boolean
  }>({ pet: null, jobs: [], places: new Map(), index: {}, loading: true })

  useEffect(() => {
    let live = true
    Promise.all([
      loadDataset<PetRecord>('pets'),
      loadDataset<{ pet_jobs: PetJob[] }>('ranching'),
      loadDataset<{ id: string; name: string }>('locations'),
      loadDisplayIndex(),
    ])
      .then(([pets, ranching, locations, index]) => {
        if (!live) return
        setState({
          pet: pets.find((p) => p.id === id) ?? null,
          jobs: ranching[0]?.pet_jobs ?? [],
          places: placeLabels(locations, []),
          index,
          loading: false,
        })
      })
      .catch(() => live && setState((s) => ({ ...s, loading: false })))
    return () => {
      live = false
    }
  }, [id])

  const { pet, jobs, places, index, loading } = state
  const veil = pet === null ? null : veilReasonOf(index[pet.id])
  const veiled = pet !== null && veil !== null && !spoilers.shown(pet.id)
  useDocumentTitle(pet === null || veiled ? null : pet.name)

  if (loading) {
    return (
      <Column>
        <p className="text-ink-mute text-sm">Loading…</p>
      </Column>
    )
  }

  if (pet === null) {
    return (
      <Column>
        <h1 className="text-2xl">Not found</h1>
        <p className="mt-1 text-ink-mute text-sm">
          Nothing here goes by “{id.replace(/_/g, ' ')}”.{' '}
          <Link to="/ranch" className="underline decoration-rule underline-offset-4">
            Back to the Ranch
          </Link>
          .
        </p>
      </Column>
    )
  }

  if (veiled) {
    return (
      <Column>
        <BackLink />
        <SpoilerAsk id={pet.id} kind="pet" reason={veil ?? 'spoiler'} />
      </Column>
    )
  }

  const gaps = gapLabels(pet.data_gaps)

  return (
    <Column>
      <BackLink />
      <header className="flex items-center gap-3">
        <ItemIcon iconKey={iconKeyFor(pet.id, index[pet.id])} name={pet.name} size="lg" />
        <div className="min-w-0">
          <h1 className="truncate text-2xl">{pet.name}</h1>
          <p className="mt-0.5 text-ink-mute text-sm">
            A pet
            {pet.variants.length > 1 && (
              <>
                {' · '}
                <span data-numeral>{pet.variants.length}</span> colours
              </>
            )}
          </p>
        </div>
      </header>

      {gaps.length > 0 && (
        <p className="text-ink-faint text-xs">Not recorded yet: {gaps.join(', ')}.</p>
      )}

      {pet.variants.length > 1 && (
        <Section title="Colours">
          <ul className="flex flex-wrap gap-1.5">
            {pet.variants.map((variant) => (
              <li
                key={variant.key}
                className="rounded-tile border border-rule bg-surface px-2 py-0.5 text-ink text-sm"
              >
                {variant.name ?? variant.key.replace(/_/g, ' ')}
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Jobs">
        {jobs.length === 0 ? (
          <Unknown>No jobs recorded.</Unknown>
        ) : (
          <>
            <p className="max-w-prose text-ink-mute text-sm leading-relaxed">
              Any pet can be sent on one job a day, and brings back more as its hearts grow:
            </p>
            <ul className="mt-2 flex flex-col gap-3">
              {jobs.map((job) => (
                <li key={job.job} className="text-sm">
                  <span className="font-display font-semibold text-ink">
                    {PET_JOB_LABELS[job.job]}
                  </span>
                  {job.location_id !== null && (
                    <>
                      {' — in '}
                      <PlaceLink
                        id={job.location_id}
                        places={places}
                        className="underline decoration-rule underline-offset-4 hover:text-ink"
                      />
                    </>
                  )}
                  <span className="mt-0.5 block text-ink-mute">
                    {job.reward_item_id !== null ? (
                      <>
                        Brings back{' '}
                        <Link
                          to="/item/$id"
                          params={{ id: job.reward_item_id }}
                          className="underline decoration-rule underline-offset-4 hover:text-ink"
                        >
                          {index[job.reward_item_id]?.n ?? job.reward_item_id.replace(/_/g, ' ')}
                        </Link>
                      </>
                    ) : job.reward_custom ? (
                      <>Brings back a mix of forageables</>
                    ) : (
                      <>Reward not recorded</>
                    )}
                    {(() => {
                      const first = job.reward_by_heart[0]
                      const last = job.reward_by_heart[job.reward_by_heart.length - 1]
                      if (first === undefined || last === undefined) return null
                      return (
                        <>
                          {' — '}
                          <span data-numeral>{range(first)}</span>
                          {' at 0♥, up to '}
                          <span data-numeral>{range(last)}</span>
                          {' at '}
                          <span data-numeral>{job.reward_by_heart.length - 1}♥</span>
                        </>
                      )
                    })()}.
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </Section>
    </Column>
  )
}
