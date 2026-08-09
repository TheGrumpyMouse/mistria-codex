import { DAYS_PER_SEASON, SEASONS, type Weather } from '@mistria/schema'
import { CloudRain, CloudSnow, Snowflake, Sun, Wind, Zap } from 'lucide-react'
import type { ComponentType, CSSProperties, ReactNode } from 'react'
import { ItemIcon } from '~/components/ItemIcon'
import {
  DAY_NAMES,
  formatClock,
  type Instant,
  legalWeather,
  SEASON_WEATHER,
  titleCase,
  weekdayOf,
} from '~/lib/instant'

/**
 * The Day Dial — the thing this app is remembered by.
 *
 * The instant picker is not a form. It is a mosaic: a 4x7 grid of tesserae for
 * the season, a row of weather tiles, and a band for the time. The shape is not
 * decoration — a Mistria season is 28 days, which is four seven-day weeks
 * exactly, so the calendar genuinely is a 4x7 grid and the weekday of a day
 * number never drifts. The currency is tesserae, literally mosaic tiles, which
 * is what makes the vocabulary honest rather than borrowed.
 *
 * It is also the only place in the app that spends any boldness. Everything
 * around it stays quiet.
 *
 * The whole state lives in the URL, so a chosen instant is linkable and
 * survives a reload. This component never owns it.
 */

const WEATHER_ICONS: Record<Weather, ComponentType<{ size?: number; strokeWidth?: number }>> = {
  clear: Sun,
  rain: CloudRain,
  storm: Zap,
  wind: Wind,
  snow: CloudSnow,
  blizzard: Snowflake,
}

/**
 * A tile that is really a radio.
 *
 * A styled `<button role="radio">` looks the same and is not the same: native
 * radios give arrow-key navigation within the group, one tab stop for the whole
 * group, and correct announcement, all for free. The input is visually hidden
 * rather than replaced, so none of that has to be reimplemented badly.
 */
function TileRadio({
  name,
  checked,
  onSelect,
  label,
  title,
  className,
  style,
  children,
}: {
  name: string
  checked: boolean
  onSelect: () => void
  label?: string
  title?: string
  className: string
  style: CSSProperties
  children: ReactNode
}) {
  return (
    <label className={className} style={style} title={title}>
      <input
        type="radio"
        name={name}
        checked={checked}
        onChange={onSelect}
        aria-label={label}
        className="sr-only"
      />
      {children}
    </label>
  )
}

/** Something that happens on a day: a birthday or a festival, with its face. */
export interface DayMark {
  kind: 'festival' | 'birthday'
  /** The sprite to draw on the tile — a villager's icon, a festival's. */
  iconKey: string | null
  label: string
}

export interface DayDialProps {
  value: Instant
  onChange: (next: Partial<Instant>) => void
  /** Day-of-season -> what happens that day, drawn onto the tile itself. */
  marks?: Record<number, DayMark[]>
}

export function DayDial({ value, onChange, marks = {} }: DayDialProps) {
  return (
    <div className="rounded-card border border-rule bg-surface p-4 shadow-card sm:p-5">
      <SeasonRow value={value} onChange={onChange} />
      <DayGrid value={value} onChange={onChange} marks={marks} />
      <WeatherRow value={value} onChange={onChange} />
      <TimeBand value={value} onChange={onChange} />
    </div>
  )
}

function SeasonRow({ value, onChange }: Pick<DayDialProps, 'value' | 'onChange'>) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3">
      {/* There is no year control here, and that is deliberate.
          Nothing on this screen — or in the dataset — varies by year: not one
          of the 1,459 availability rules carries a `min_year`, and no game file
          gates a spawn by year, so the input filtered nothing and changed
          nothing but its own label. A control that does nothing is worse than
          no control, because people reasonably assume it works.
          Year is not meaningless in the game, just not *here*: six board
          requests unlock in year two, and the Board names that gate itself.
          The `min_year` field and the matcher's year clause stay — they are
          correct, and dormant is not the same as wrong. */}
      <fieldset className="flex min-w-0 flex-1 overflow-hidden rounded-tile border border-rule">
        <legend className="sr-only">Season</legend>
        {SEASONS.map((season) => {
          const active = season === value.season
          return (
            <TileRadio
              key={season}
              name="season"
              checked={active}
              onSelect={() => onChange({ season, weather: legalWeather(season, value.weather) })}
              className="flex-1 cursor-pointer px-2 py-1.5 text-center font-display font-semibold text-[0.8125rem] transition-colors sm:px-3 sm:text-sm"
              style={{
                background: active ? `var(--${season}-tint)` : 'transparent',
                color: active ? `var(--${season})` : 'var(--ink-mute)',
              }}
            >
              {titleCase(season)}
            </TileRadio>
          )
        })}
      </fieldset>
    </div>
  )
}

function DayGrid({ value, onChange, marks = {} }: DayDialProps) {
  const days = Array.from({ length: DAYS_PER_SEASON }, (_, i) => i + 1)

  return (
    <div>
      <div className="mb-1 grid grid-cols-7 gap-1">
        {DAY_NAMES.map((name) => (
          <div
            key={name}
            className="text-center text-[0.625rem] text-ink-faint uppercase tracking-wide"
          >
            {name}
          </div>
        ))}
      </div>

      <fieldset className="grid grid-cols-7 gap-1">
        <legend className="sr-only">Day of season</legend>
        {days.map((day) => {
          const active = day === value.day
          const dayMarks = marks[day] ?? []
          const spoken =
            dayMarks.length === 0 ? '' : ` — ${dayMarks.map((m) => m.label).join(', ')}`
          return (
            <TileRadio
              key={day}
              name="day"
              checked={active}
              onSelect={() => onChange({ day })}
              label={`${titleCase(value.season)} ${day}, ${weekdayOf(day)}${spoken}`}
              className="relative grid aspect-square cursor-pointer place-items-center rounded-tile border text-[0.8125rem] transition-colors"
              style={{
                background: active ? 'var(--accent)' : 'var(--sunk)',
                color: active ? 'var(--surface)' : 'var(--ink-mute)',
                borderColor: active ? 'var(--accent)' : 'transparent',
                fontWeight: active ? 600 : 400,
              }}
            >
              {/* The number cedes the centre of the tile to whatever happens
                  that day — a face says "Reina's birthday" faster than any dot,
                  and the day is still legible in the corner. */}
              {dayMarks.length > 0 ? (
                <>
                  <span
                    data-numeral
                    className="absolute top-0.5 left-1 text-[0.5625rem] opacity-80"
                  >
                    {day}
                  </span>
                  <span aria-hidden className="flex items-center">
                    {dayMarks.slice(0, 2).map((mark, i) => (
                      <span
                        key={mark.label}
                        className={i > 0 ? '-ml-2' : undefined}
                        title={mark.label}
                      >
                        <ItemIcon iconKey={mark.iconKey ?? ''} name={mark.label} size="sm" />
                      </span>
                    ))}
                  </span>
                </>
              ) : (
                <span data-numeral>{day}</span>
              )}
            </TileRadio>
          )
        })}
      </fieldset>
    </div>
  )
}

function WeatherRow({ value, onChange }: Pick<DayDialProps, 'value' | 'onChange'>) {
  // Only the weather the season can physically have. Winter has no rain, and
  // offering it would let a player ask a question the game cannot answer.
  const available = SEASON_WEATHER[value.season]

  return (
    <fieldset className="mt-4 flex gap-1">
      <legend className="sr-only">Weather</legend>
      {available.map((weather) => {
        const Icon = WEATHER_ICONS[weather]
        const active = weather === value.weather
        return (
          <TileRadio
            key={weather}
            name="weather"
            checked={active}
            onSelect={() => onChange({ weather })}
            label={titleCase(weather)}
            title={titleCase(weather)}
            className="grid flex-1 cursor-pointer place-items-center rounded-tile border py-2 transition-colors"
            style={{
              background: active ? 'var(--accent-tint)' : 'var(--sunk)',
              color: active ? 'var(--accent)' : 'var(--ink-mute)',
              borderColor: active ? 'var(--accent)' : 'transparent',
            }}
          >
            <Icon size={18} strokeWidth={2} />
          </TileRadio>
        )
      })}
    </fieldset>
  )
}

/**
 * The time band.
 *
 * A Mistria day runs 6am to 2am, which is twenty hours and wraps past midnight
 * — so the slider is in minutes from 06:00 and the label converts. No runtime
 * code compares a start to an end to work out which side of midnight it is on.
 */
const DAY_STARTS_AT = 6 * 60
const DAY_LENGTH = 20 * 60

function TimeBand({ value, onChange }: Pick<DayDialProps, 'value' | 'onChange'>) {
  const minutes = value.time
  const offset = minutes === null ? 0 : (minutes - DAY_STARTS_AT + 1440) % 1440

  return (
    <div className="mt-5">
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-ink-mute text-sm">Time</span>
        <div className="flex items-center gap-3">
          {minutes !== null && (
            <span data-numeral className="font-semibold text-ink">
              {formatClock(minutes)}
            </span>
          )}
          <button
            type="button"
            onClick={() => onChange({ time: minutes === null ? 12 * 60 : null })}
            className="tap-target rounded-pill border border-rule px-2.5 py-1 text-ink-mute text-xs transition-colors hover:text-ink"
            style={
              minutes === null ? { background: 'var(--accent-tint)', color: 'var(--accent)' } : {}
            }
          >
            {/* Null time is a real answer — "I have not narrowed by time" —
                and the query returns everything rather than assuming midnight. */}
            Any time
          </button>
        </div>
      </div>

      <input
        type="range"
        min={0}
        max={DAY_LENGTH}
        step={10}
        value={offset}
        disabled={minutes === null}
        aria-label="Time of day"
        onChange={(event) =>
          onChange({ time: (DAY_STARTS_AT + Number(event.target.value)) % 1440 })
        }
        className="time-band w-full disabled:opacity-40"
      />

      <div className="flex justify-between text-[0.6875rem] text-ink-faint" data-numeral>
        <span>6 AM</span>
        <span>Noon</span>
        <span>6 PM</span>
        <span>2 AM</span>
      </div>
    </div>
  )
}
