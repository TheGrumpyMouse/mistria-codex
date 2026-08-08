import { Link } from '@tanstack/react-router'
import { useSpoilers } from '~/lib/spoilers'

/**
 * The curtain, both sizes of it — and both reasons for it.
 *
 * Two kinds of thing hide behind the same machinery: story spoilers
 * (`spoiler` on the record, `s` in the index) and content the wiki describes
 * that the game does not ship yet (`unreleased` / `u`). The mechanics are
 * identical — one revealed set, one master switch — only the words differ,
 * because "this will spoil the story" and "this isn't in the game yet" are
 * different warnings and mislabelling one as the other erodes both.
 *
 * `<SpoilerChip>` stands in for a name-plus-icon in a list row. It leaks
 * nothing: no sprite, no initials, no hue derived from the id — a screen
 * reader hears exactly what a sighted user sees. The row underneath keeps
 * existing and keeps navigating; the page it lands on is the one that asks.
 *
 * `<SpoilerAsk>` is that ask: it replaces a detail page's body below the
 * back link until the user taps through. The reveal is remembered per record
 * (in localStorage, like every other preference) because agreeing to see one
 * late-game character is not agreeing to see the ending. Settings holds the
 * master switch and the re-hide.
 *
 * Neither ever filters a record out — the corollary of "locked is shown, not
 * hidden": the veil withholds names, never rows.
 */

export type VeilReason = 'spoiler' | 'unreleased'

const CHIP_TEXT: Record<VeilReason, string> = {
  spoiler: 'Hidden — story spoiler',
  unreleased: 'Hidden — coming later',
}

/** Which veil applies to an index entry, or null when it is plainly visible. */
export function veilReasonOf(entry: { s?: 1; u?: 1 } | undefined): VeilReason | null {
  if (entry?.s === 1) return 'spoiler'
  if (entry?.u === 1) return 'unreleased'
  return null
}

export function SpoilerChip({
  size = 24,
  reason = 'spoiler',
}: {
  size?: number
  reason?: VeilReason
}) {
  return (
    <>
      <span
        aria-hidden
        className="unverified inline-grid shrink-0 place-items-center rounded-tile border-dashed font-display font-semibold"
        style={{ width: size, height: size, fontSize: size * 0.46, lineHeight: 1 }}
      >
        ?
      </span>
      <span className="unverified rounded-tile px-1.5 py-0.5 text-[11px]">{CHIP_TEXT[reason]}</span>
    </>
  )
}

/**
 * The acknowledgement card a veiled detail page shows instead of its body.
 * The caller decides *whether* to veil (`useSpoilers().shown(id)`), so hooks
 * stay unconditional in the route; this renders the ask and files the answer.
 */
export function SpoilerAsk({
  id,
  kind,
  reason = 'spoiler',
}: {
  id: string
  /** "villager", "quest", "place"… — makes the warning concrete without naming anything. */
  kind: string
  reason?: VeilReason
}) {
  const spoilers = useSpoilers()

  return (
    <div className="mt-4 rounded-card border border-rule bg-surface p-4">
      <h2 className="font-display font-semibold text-ink">
        {reason === 'spoiler' ? 'Story spoiler ahead' : 'Not in the game yet'}
      </h2>
      <p className="mt-1.5 max-w-prose text-ink-mute text-sm leading-relaxed">
        {reason === 'spoiler'
          ? `This ${kind} is something you discover later in Mistria's story. If you'd rather meet it in the game first, go back — nothing else on this page will tell you.`
          : `The wiki describes this ${kind} for a future update — the game doesn't ship it yet, so nothing here is something you can go and do today.`}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => spoilers.reveal(id)}
          className="rounded-tile border border-rule px-3 py-1.5 text-sm transition-colors"
          style={{ background: 'var(--accent-tint)', color: 'var(--accent)', fontWeight: 600 }}
        >
          Show it anyway
        </button>
        <Link
          to="/settings"
          className="text-ink-faint text-xs underline decoration-rule underline-offset-4 hover:text-ink"
        >
          Spoiler settings
        </Link>
      </div>
    </div>
  )
}
