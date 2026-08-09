import { SEASONS } from '@mistria/schema'
import { Link } from '@tanstack/react-router'
import { PlaceLink } from '~/components/PlaceLink'
import { titleCase } from '~/lib/instant'
import { METHOD_LABELS, type PlaceLabel, requirementDisplay } from '~/lib/labels'
import type { Opportunity, WeatherOddsTable } from '~/lib/opportunity'
import { oddsPhrase } from '~/lib/opportunity'

/**
 * One way to get one thing, and what it takes.
 *
 * The item page's "Where to find it" is a list of these, one per place. It used
 * to be a lesser copy of a second screen at `/item/$id/where` that rendered the
 * same facts more fully — weather, frequencies, a map — from directly under a
 * link to it. The two were folded together; this is what survived.
 *
 * **The card's job is to refuse to invent a date.** Weather is rolled per
 * season, so for anything weather-gated there is no next Tuesday to name — only
 * a frequency, and the frequency comes from the game's own seasonal counts.
 * A card that said "Fall 17" would be more satisfying and would be a lie.
 *
 * It states no date at all, not even a countdown, and that is deliberate: the
 * item page carries no instant to count from, and the clock ranges it renders
 * are the record's own, ten of which still wrap midnight. Dates belong to the
 * calendar and the map, which both have a date to work with.
 */

export interface OpportunityCardProps {
  opportunity: Opportunity
  /** Location id -> its name and, for a mine biome, its floor range. */
  places: Map<string, PlaceLabel>
  odds: WeatherOddsTable | undefined
  /** Display index, for naming the quest or perk a requirement points at. */
  names?: Record<string, { n: string } | undefined>
}

export function OpportunityCard({ opportunity, places, odds, names }: OpportunityCardProps) {
  const {
    method,
    seasons,
    weather,
    time,
    timeIsAnyTime,
    locationIds,
    rarity,
    requires,
    placesInferred,
    habitat,
  } = opportunity

  return (
    <li className="py-2.5">
      <p className="text-ink text-sm">
        {METHOD_LABELS[method] ?? method.replace(/_/g, ' ')}
        {rarity !== null && rarity !== 'common' && (
          <span className="text-ink-faint"> · {rarity.replace(/_/g, ' ')}</span>
        )}
      </p>

      {locationIds.length > 0 && (
        <p className="text-ink-mute text-xs">
          {locationIds.map((locationId, i) => (
            <span key={locationId}>
              {i > 0 && ' · '}
              {/* An inference must never render identically to a fact: where
                  the places were deduced from a habitat rather than sourced,
                  the links themselves carry the hedge. */}
              <PlaceLink
                id={locationId}
                places={places}
                className={
                  placesInferred
                    ? 'unverified px-1 underline decoration-transparent underline-offset-4 hover:text-ink'
                    : 'underline decoration-rule underline-offset-4 hover:text-ink'
                }
              />
            </span>
          ))}
        </p>
      )}

      {/* Why the places are hedged, rather than only that they are. The bare
          chip this replaces said "place inferred" in the tag row and read as a
          fact about the window; 123 of the 153 inferred windows name the
          habitat they were expanded from, so the common case can say so. */}
      {placesInferred && (
        <p className="text-ink-faint text-xs">
          {habitat === null
            ? locationIds.length === 1
              ? 'place inferred'
              : 'places inferred'
            : `${locationIds.length === 1 ? 'place' : 'places'} inferred from its ${habitat} habitat`}
        </p>
      )}

      <div className="mt-1 flex flex-wrap items-center gap-1">
        {SEASONS.filter((season) => seasons.includes(season)).map((season) => (
          <span
            key={season}
            className="rounded-pill px-1.5 py-0.5 text-[0.625rem]"
            style={{ background: `var(--${season}-tint)`, color: `var(--${season})` }}
          >
            {season}
          </span>
        ))}

        {time.length === 0
          ? // Two different empties. `timeIsAnyTime` says the method has no
            // clock — fish bite around the clock, dig spots sit there all day —
            // which is a fact and renders plainly. Without it, nobody has
            // sourced a time, and the card says nothing rather than hedging.
            timeIsAnyTime && (
              <span className="rounded-tile px-1.5 py-0.5 text-[0.625rem] text-ink-faint">
                any time
              </span>
            )
          : time.map((range) => (
              <span
                key={`${range.from}-${range.to}`}
                data-numeral
                className="text-ink-faint text-[0.625rem]"
              >
                {range.from}–{range.to}
              </span>
            ))}

        {requires.length > 0 && (
          <span
            className="rounded-pill px-1.5 py-0.5 text-[0.625rem]"
            style={{ background: 'var(--sunk)', color: 'var(--locked)' }}
          >
            needs{' '}
            {requires.map((requirement, i) => {
              const parts = requirementDisplay(requirement, names?.[requirement.key]?.n)
              return (
                <span key={`${requirement.type}:${requirement.key}`}>
                  {i > 0 && ' · '}
                  {parts.prefix}
                  {parts.linkTo === null ? (
                    parts.label
                  ) : (
                    <Link
                      to={parts.linkTo.to}
                      params={{ id: parts.linkTo.id }}
                      className="underline decoration-current underline-offset-2"
                    >
                      {parts.label}
                    </Link>
                  )}
                  {parts.suffix}
                </span>
              )
            })}
          </span>
        )}
      </div>

      {weather !== null && (
        <p className="mt-1 text-ink-mute text-xs">
          Needs {joinWords(weather.map(titleCase))}
          {/*
            The frequency, from the game's own seasonal counts — and nothing at
            all when they were not shipped. An invented percentage would read
            exactly like a real one, which is why there is no fallback here.
          */}
          {(() => {
            const phrase = oddsPhrase(odds, seasons, weather)
            return phrase === null ? null : <span className="text-ink-faint"> — {phrase}</span>
          })()}
        </p>
      )}
    </li>
  )
}

/** `a`, `a or b`, `a, b or c`. */
function joinWords(words: string[]): string {
  if (words.length <= 1) return words[0] ?? ''
  return `${words.slice(0, -1).join(', ')} or ${words[words.length - 1]}`
}
