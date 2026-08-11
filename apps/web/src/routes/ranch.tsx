import { Link } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { Column } from '~/app/AppShell'
import { ItemIcon } from '~/components/ItemIcon'
import { Section, Unknown } from '~/components/Section'
import { SpoilerChip, veilReasonOf } from '~/components/Spoiler'
import { type DisplayIndex, loadDataset, loadDisplayIndex } from '~/lib/data'
import { useDocumentTitle } from '~/lib/head'
import { iconKeyFor } from '~/lib/search'
import { useSpoilers } from '~/lib/spoilers'

/**
 * The ranch: every keepable animal, every pet, and the rulebook they share.
 *
 * The mechanics panels below the two lists render `ranching.json` — the
 * game's own heart-point economy, production tiers and festival scoring,
 * extracted verbatim from `fiddle/ranching/misc.toml`. Nothing here is a
 * guide's estimate; every number is the game's.
 */

interface AnimalLite {
  id: string
  name: string
  icon_key: string | null
  building: 'coop' | 'barn'
  purchase: { price: number } | null
}

interface PetLite {
  id: string
  name: string
  icon_key: string | null
  variants: { key: string }[]
}

interface RanchRules {
  min_hearts_to_breed: number | null
  heart_point_table: number[]
  production_tiers: {
    hearts_required: number
    normal: { count: number; additional_chance: number }
    golden: { count: number; additional_chance: number }
  }[]
  heart_actions: {
    pet: number | null
    feed: number | null
    go_outside: number | null
    left_outside_penalty: number | null
    feed_bonus: {
      normal: number | null
      quality: number | null
      deluxe: number | null
      ultimate: number | null
    } | null
    crop_bonus: number | null
    cooked_star_bonuses: number[]
    child_born: number | null
    toy: number | null
  } | null
  festival_scoring: { tier_points: number[]; heart_points: number[] } | null
}

const BUILDING_LABELS = { coop: 'Coop', barn: 'Barn' } as const

/** `+5` / `−5`, with the real minus sign a penalty deserves. */
const signed = (points: number): string => (points < 0 ? `−${-points}` : `+${points}`)

function rollLabel(roll: { count: number; additional_chance: number }): string {
  if (roll.count === 0 && roll.additional_chance === 0) return '—'
  const chance =
    roll.additional_chance > 0
      ? ` (+${Math.round(roll.additional_chance * 100)}% for one more)`
      : ''
  if (roll.count === 0) return `${Math.round(roll.additional_chance * 100)}% chance`
  return `${roll.count}${chance}`
}

export function RanchRoute() {
  useDocumentTitle('Ranch')
  const spoilers = useSpoilers()
  const [state, setState] = useState<{
    animals: AnimalLite[]
    pets: PetLite[]
    rules: RanchRules | null
    index: DisplayIndex
    loading: boolean
  }>({ animals: [], pets: [], rules: null, index: {}, loading: true })

  useEffect(() => {
    let live = true
    Promise.all([
      loadDataset<AnimalLite>('animals'),
      loadDataset<PetLite>('pets'),
      loadDataset<RanchRules>('ranching'),
      loadDisplayIndex(),
    ])
      .then(([animals, pets, ranching, index]) => {
        if (!live) return
        setState({ animals, pets, rules: ranching[0] ?? null, index, loading: false })
      })
      .catch(() => live && setState((s) => ({ ...s, loading: false })))
    return () => {
      live = false
    }
  }, [])

  const { animals, pets, rules, index, loading } = state
  const actions = rules?.heart_actions ?? null

  if (loading) {
    return (
      <Column>
        <p className="text-ink-mute text-sm">Loading…</p>
      </Column>
    )
  }

  return (
    <Column>
      <header>
        <h1 className="text-2xl">Ranch</h1>
        <p className="mt-1 text-ink-mute text-sm">
          The animals you can keep, the pets that follow you home, and the numbers behind hearts and
          golden produce.
        </p>
      </header>

      <Section title="Animals">
        {animals.length === 0 ? (
          <Unknown>No animals recorded.</Unknown>
        ) : (
          <ul className="flex flex-col divide-y divide-rule border-rule border-y">
            {animals.map((animal) => (
              <li key={animal.id}>
                <Link
                  to="/animal/$id"
                  params={{ id: animal.id }}
                  className="flex items-center gap-3 py-2 transition-colors hover:bg-sunk"
                >
                  <ItemIcon
                    iconKey={animal.icon_key ?? `animal/${animal.id}`}
                    name={animal.name}
                    size="sm"
                  />
                  <span className="min-w-0 flex-1 truncate text-ink text-sm">{animal.name}</span>
                  <span className="shrink-0 text-ink-faint text-xs">
                    {BUILDING_LABELS[animal.building]}
                  </span>
                  {animal.purchase !== null && (
                    <span data-numeral className="shrink-0 text-ink-mute text-xs">
                      {animal.purchase.price}t
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Pets">
        {pets.length === 0 ? (
          <Unknown>No pets recorded.</Unknown>
        ) : (
          <ul className="flex flex-col divide-y divide-rule border-rule border-y">
            {pets.map((pet) => {
              const veil = veilReasonOf(index[pet.id])
              const veiled = veil !== null && !spoilers.shown(pet.id)
              return (
                <li key={pet.id}>
                  <Link
                    to="/pet/$id"
                    params={{ id: pet.id }}
                    className="flex items-center gap-3 py-2 transition-colors hover:bg-sunk"
                  >
                    {veiled ? (
                      <SpoilerChip reason={veil} />
                    ) : (
                      <>
                        <ItemIcon
                          iconKey={iconKeyFor(pet.id, index[pet.id])}
                          name={pet.name}
                          size="sm"
                        />
                        <span className="min-w-0 flex-1 truncate text-ink text-sm">{pet.name}</span>
                        {pet.variants.length > 1 && (
                          <span data-numeral className="shrink-0 text-ink-faint text-xs">
                            {pet.variants.length} colours
                          </span>
                        )}
                      </>
                    )}
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </Section>

      {actions !== null && (
        <Section title="Raising hearts">
          <p className="max-w-prose text-ink-mute text-sm leading-relaxed">
            Heart points add up across days
            {rules !== null && rules.heart_point_table.length > 0 && (
              <>
                {' — the first heart at '}
                <span data-numeral>{rules.heart_point_table[0]}</span>
                {' points, the tenth at '}
                <span data-numeral>
                  {rules.heart_point_table[rules.heart_point_table.length - 1]}
                </span>
              </>
            )}
            .
          </p>
          <dl className="mt-2 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
            {(
              [
                ['Petting', actions.pet],
                ['Feeding', actions.feed],
                ['A day outside', actions.go_outside],
                ['Left outside overnight', actions.left_outside_penalty],
                ['Playing with a toy', actions.toy],
                ['A baby born', actions.child_born],
                ['Feed grown from crops', actions.crop_bonus],
              ] as const
            ).map(([label, points]) =>
              points === null ? null : (
                <span key={label} className="contents">
                  <dt className="text-ink-mute">{label}</dt>
                  <dd className="text-right text-ink" data-numeral>
                    {signed(points)}
                  </dd>
                </span>
              ),
            )}
          </dl>
          {actions.feed_bonus !== null && (
            <p className="mt-2 text-ink-faint text-xs">
              Better feed adds on top of the feeding points: quality{' '}
              <span data-numeral>{signed(actions.feed_bonus.quality ?? 0)}</span>, deluxe{' '}
              <span data-numeral>{signed(actions.feed_bonus.deluxe ?? 0)}</span>, ultimate{' '}
              <span data-numeral>{signed(actions.feed_bonus.ultimate ?? 0)}</span>
              {actions.cooked_star_bonuses.length > 0 && (
                <>
                  {'; a cooked dish adds '}
                  <span data-numeral>+{actions.cooked_star_bonuses[0]}</span>
                  {' to '}
                  <span data-numeral>
                    +{actions.cooked_star_bonuses[actions.cooked_star_bonuses.length - 1]}
                  </span>
                  {' by its star rating'}
                </>
              )}
              .
            </p>
          )}
        </Section>
      )}

      {rules !== null && rules.production_tiers.length > 0 && (
        <Section title="Produce by hearts">
          <p className="max-w-prose text-ink-mute text-sm leading-relaxed">
            What one production day yields as an animal's hearts rise. Golden produce becomes
            possible at{' '}
            <span data-numeral>
              {rules.production_tiers.find(
                (t) => t.golden.count > 0 || t.golden.additional_chance > 0,
              )?.hearts_required ?? '—'}
            </span>{' '}
            hearts and replaces the ordinary product entirely at{' '}
            <span data-numeral>
              {rules.production_tiers.find((t) => t.normal.count === 0 && t.golden.count > 0)
                ?.hearts_required ?? '—'}
            </span>
            .
          </p>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-ink-faint text-xs">
                  <th className="py-1 pr-4 font-normal">Hearts</th>
                  <th className="py-1 pr-4 font-normal">Produce</th>
                  <th className="py-1 font-normal">Golden</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-rule">
                {rules.production_tiers.map((tier) => (
                  <tr key={tier.hearts_required}>
                    <td className="py-1.5 pr-4 text-ink" data-numeral>
                      {tier.hearts_required}♥
                    </td>
                    <td className="py-1.5 pr-4 text-ink" data-numeral>
                      {rollLabel(tier.normal)}
                    </td>
                    <td className="py-1.5 text-ink" data-numeral>
                      {rollLabel(tier.golden)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {rules?.festival_scoring !== null && rules?.festival_scoring !== undefined && (
        <Section title="Animal Festival scoring">
          <p className="max-w-prose text-ink-mute text-sm leading-relaxed">
            An entry scores by its colour's rarity tier and by its hearts. Rarer colours score
            higher:
          </p>
          <dl className="mt-2 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
            {rules.festival_scoring.tier_points.map((points, tier) => (
              // Tier is positional by definition — six tiers, six entries.
              // biome-ignore lint/suspicious/noArrayIndexKey: the index IS the tier
              <span key={tier} className="contents">
                <dt className="text-ink-mute">Tier {tier + 1}</dt>
                <dd className="text-right text-ink" data-numeral>
                  {points}
                </dd>
              </span>
            ))}
          </dl>
          {rules.festival_scoring.heart_points.length > 0 && (
            <p className="mt-2 text-ink-faint text-xs">
              Hearts add{' '}
              <span data-numeral>{Math.min(...rules.festival_scoring.heart_points)}</span> to{' '}
              <span data-numeral>{Math.max(...rules.festival_scoring.heart_points)}</span> points on
              top, rising with the animal's heart level.
            </p>
          )}
        </Section>
      )}
    </Column>
  )
}
