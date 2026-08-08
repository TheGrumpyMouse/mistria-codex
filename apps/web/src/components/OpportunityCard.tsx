import { SEASONS } from '@mistria/schema'
import { KIND_LABELS } from '~/lib/findable'
import { formatClock, titleCase } from '~/lib/instant'
import type { Opportunity, WeatherOddsTable } from '~/lib/opportunity'
import { oddsPhrase } from '~/lib/opportunity'

/**
 * One way to get one thing, and when.
 *
 * The same card appears on the item page, on `/item/$id/when`, and against a
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
}

export function OpportunityCard({ opportunity, locationNames, odds }: OpportunityCardProps) {
  const { rule, seasons, weather, time, locationId, requires, daysAway, availableNow } = opportunity
  const place =
    locationId === null ? null : (locationNames.get(locationId) ?? locationId.replace(/_/g, ' '))

  return (
    <li className="py-2.5">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-ink text-sm">
          {KIND_LABELS[rule.k] ?? rule.k.replace(/_/g, ' ')}
          {place === null ? (
            <span className="unverified ml-1.5 rounded-tile px-1.5 py-0.5 text-[10px]">
              place unknown
            </span>
          ) : (
            <span className="text-ink-mute"> · {place}</span>
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
            className="rounded-pill px-1.5 py-0.5 text-[10px]"
            style={{ background: `var(--${season}-tint)`, color: `var(--${season})` }}
          >
            {season}
          </span>
        ))}

        {time.length === 0 ? (
          <span className="unverified rounded-tile px-1.5 py-0.5 text-[10px]">any time</span>
        ) : (
          time.map(([from, to]) => (
            <span key={`${from}-${to}`} data-numeral className="text-ink-faint text-[10px]">
              {formatClock(from)}–{formatClock(to)}
            </span>
          ))
        )}

        {requires.length > 0 && (
          <span
            className="rounded-pill px-1.5 py-0.5 text-[10px]"
            style={{ background: 'var(--sunk)', color: 'var(--locked)' }}
          >
            needs {requires.join(', ').replace(/_/g, ' ')}
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
