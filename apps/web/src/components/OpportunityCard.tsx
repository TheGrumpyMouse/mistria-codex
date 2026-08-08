import { SEASONS } from '@mistria/schema'
import { Link } from '@tanstack/react-router'
import { KIND_LABELS } from '~/lib/findable'
import { formatClock, titleCase } from '~/lib/instant'
import { ruleRequirementPhrase, ruleToken } from '~/lib/labels'
import type { Opportunity, WeatherOddsTable } from '~/lib/opportunity'
import { oddsPhrase } from '~/lib/opportunity'

/**
 * One way to get one thing, and when.
 *
 * The same card appears on the item page, on `/item/$id/where`, and against a
 * missing museum row, because they are three placements of one question. Any
 * difference between them would be a difference the data does not have.
 *
 * **The card's job is to refuse to invent a date.** Weather is rolled per
 * season, so for anything weather-gated there is no next Tuesday to name — only
 * a frequency, and the frequency comes from the game's own seasonal counts.
 * A card that said "Fall 17" would be more satisfying and would be a lie, and
 * this component is the single place that temptation has to be resisted.
 */

export interface OpportunityCardProps {
  opportunity: Opportunity
  /** Location id -> display name. */
  locationNames: Map<string, string>
  odds: WeatherOddsTable | undefined
  /**
   * Quest display name -> quest id, unique names only. Shipped rule tokens
   * carry display names (`quest:Repair the Beach Bridge`), so linking one
   * means resolving the name back — and only an unambiguous match may link,
   * or a duplicate name would quietly point at the wrong record.
   */
  questIdByName?: Map<string, string>
}

export function OpportunityCard({
  opportunity,
  locationNames,
  odds,
  questIdByName,
}: OpportunityCardProps) {
  const { rule, seasons, weather, time, locationId, requires, daysAway, availableNow } = opportunity
  const place =
    locationId === null ? null : (locationNames.get(locationId) ?? locationId.replace(/_/g, ' '))

  return (
    <li className="py-2.5">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-ink text-sm">
          {KIND_LABELS[rule.k] ?? rule.k.replace(/_/g, ' ')}
          {place !== null && (
            <span className="text-ink-mute">
              {' · '}
              <Link
                to="/place/$id"
                params={{ id: opportunity.locationId ?? '' }}
                className="underline decoration-transparent underline-offset-2 transition-colors hover:decoration-rule"
              >
                {place}
              </Link>
            </span>
          )}
        </p>

        <p className="shrink-0 text-xs">
          {availableNow ? (
            <span style={{ color: 'var(--accent)' }}>right now</span>
          ) : daysAway !== null ? (
            <span className="text-ink-mute">
              in <span data-numeral>{daysAway}</span> {daysAway === 1 ? 'day' : 'days'}
            </span>
          ) : (
            // No date, and the reason is stated rather than left as a blank.
            <span className="text-ink-faint">no fixed date</span>
          )}
        </p>
      </div>

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
          ? // Two different empties. `ta` says the method has no clock — fish
            // bite around the clock, dig spots sit there all day — which is a
            // fact and renders plainly. Without it, nobody has sourced a time,
            // and the card says nothing rather than hedging.
            rule.ta === 1 && (
              <span className="rounded-tile px-1.5 py-0.5 text-[0.625rem] text-ink-faint">
                any time
              </span>
            )
          : time.map(([from, to]) => (
              <span key={`${from}-${to}`} data-numeral className="text-ink-faint text-[0.625rem]">
                {formatClock(from)}–{formatClock(to)}
              </span>
            ))}

        {requires.length > 0 && (
          <span
            className="rounded-pill px-1.5 py-0.5 text-[0.625rem]"
            style={{ background: 'var(--sunk)', color: 'var(--locked)' }}
          >
            needs{' '}
            {requires.map((token, i) => {
              const { type, name } = ruleToken(token)
              const questId = type === 'quest' ? questIdByName?.get(name) : undefined
              return (
                <span key={token}>
                  {i > 0 && ' · '}
                  {questId === undefined ? (
                    ruleRequirementPhrase(token)
                  ) : (
                    <>
                      finish{' '}
                      <Link
                        to="/quest/$id"
                        params={{ id: questId }}
                        className="underline decoration-current underline-offset-2"
                      >
                        “{name}”
                      </Link>
                    </>
                  )}
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
