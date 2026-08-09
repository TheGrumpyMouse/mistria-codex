import { SEASONS } from '@mistria/schema'
import { weatherRestriction } from '~/lib/findable'
import { seasonsOf } from '~/lib/opportunity'

/**
 * How wide a thing's window is, in two tags.
 *
 * Shared by the calendar's rows and the place/map list so the same fact cannot
 * render two ways on two screens — the reason `FoundHereList` is shared at all,
 * applied one level down.
 *
 * Both tags are deliberately quiet, and both can be absent:
 *
 * - **Weather** appears only when it excludes something the seasons could
 *   otherwise produce. A rule with no weather of its own ships as every legal
 *   weather and is indistinguishable from unrestricted, correctly — neither
 *   narrows anything. 122 of 610 entities carry this tag, which is what keeps
 *   it worth reading. See `weatherRestriction`.
 * - **Seasons** collapse to a flat "all year" at four, because four pills is a
 *   wall that says the same thing as two words.
 */
export function AvailabilityTags({
  seasonMask,
  weatherMask,
}: {
  seasonMask: number
  weatherMask: number
}) {
  const seasons = seasonsOf(seasonMask)
  const weather = weatherRestriction(seasonMask, weatherMask)

  return (
    <>
      {/* Weather before season, because it is the rarer and therefore more
          surprising constraint — "only in rain" changes a plan in a way
          "spring" does not. */}
      {weather !== null && (
        <span className="rounded-pill border border-rule px-1.5 py-0.5 text-[0.625rem] text-ink-mute">
          {weather.kind === 'except' && 'not in '}
          {weather.weathers.join(' / ')}
        </span>
      )}
      {seasons.length === SEASONS.length ? (
        <span className="text-ink-faint text-[0.625rem]">all year</span>
      ) : (
        seasons.map((season) => (
          <span
            key={season}
            className="rounded-pill px-1.5 py-0.5 text-[0.625rem]"
            style={{ background: `var(--${season}-tint)`, color: `var(--${season})` }}
          >
            {season}
          </span>
        ))
      )}
    </>
  )
}
