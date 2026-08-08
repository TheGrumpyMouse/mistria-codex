import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTourDone } from '~/lib/tour'

/**
 * The first-run tour: a handful of spotlight steps over the real navigation.
 *
 * No positioning library and no portal — the anchors are all in fixed chrome
 * (sidebar, bottom nav, corner buttons), so scrolling never moves them and a
 * `fixed` overlay measured with `getBoundingClientRect` is exact. Elements
 * carry `data-tour` names; the same name may appear twice (the map lives in
 * the sidebar on desktop and a corner button on a phone) and whichever is
 * actually laid out wins, because `display: none` measures as a zero rect.
 * That also filters the steps per viewport with no media query.
 *
 * It is an offer, not a gate — Skip is always visible, Escape works, and the
 * house rule about never interrupting someone without a way out applies here
 * as much as it does to the update toast.
 *
 * z-index: the backdrop sits at z-30, the first layer above the skip link and
 * update toast (z-20). Nothing else claims 30+.
 */

interface Step {
  anchor: string
  title: string
  body: string
}

const STEPS: Step[] = [
  {
    anchor: 'calendar',
    title: 'Calendar',
    body: 'Pick any day and see everything you can catch, dig, forage and buy at that moment. It’s the screen the app is built around.',
  },
  {
    anchor: 'board',
    title: 'Board',
    body: 'Every request on the village board, what it asks for, and what it pays.',
  },
  {
    anchor: 'search',
    title: 'Search',
    body: 'One box for everything — items, villagers, places and quests.',
  },
  {
    anchor: 'museum',
    title: 'Museum',
    body: 'Tick off donations wing by wing. Progress stays on this device.',
  },
  {
    anchor: 'mines',
    title: 'Mines',
    body: 'What each seal costs to break, and what the floors below it drop.',
  },
  {
    anchor: 'browse',
    title: 'Browse',
    body: 'Everything by category, for when you don’t have a name to search for.',
  },
  {
    anchor: 'map',
    title: 'Map',
    body: 'The whole valley. Focus a region to see what can be found there.',
  },
  {
    anchor: 'settings',
    title: 'Settings',
    body: 'Text size, hidden spoilers, and syncing progress to another device.',
  },
]

function anchorRect(name: string): DOMRect | null {
  for (const el of document.querySelectorAll(`[data-tour="${name}"]`)) {
    const rect = el.getBoundingClientRect()
    if (rect.width > 0 && rect.height > 0) return rect
  }
  return null
}

export function Tour() {
  const [done, setDone] = useTourDone()
  if (done) return null
  return <TourOverlay onClose={() => setDone(true)} />
}

function TourOverlay({ onClose }: { onClose: () => void }) {
  const [steps, setSteps] = useState<Step[]>([])
  const [index, setIndex] = useState(0)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const cardRef = useRef<HTMLDivElement>(null)

  // Which steps exist on this viewport, re-decided on resize (rotating a
  // phone swaps the map from a corner button to a sidebar entry).
  useLayoutEffect(() => {
    const measure = () => setSteps(STEPS.filter((step) => anchorRect(step.anchor) !== null))
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])

  const step = steps[Math.min(index, Math.max(steps.length - 1, 0))]

  useLayoutEffect(() => {
    if (step === undefined) return
    const measure = () => setRect(anchorRect(step.anchor))
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [step])

  // Focus lands on the card — once it exists, which is only after the first
  // measurement pass — and goes back where it came from on close.
  const focusedOnce = useRef(false)
  const before = useRef<HTMLElement | null>(null)
  useEffect(() => {
    before.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    return () => before.current?.focus()
  }, [])
  useEffect(() => {
    if (rect !== null && !focusedOnce.current) {
      focusedOnce.current = true
      cardRef.current?.focus()
    }
  }, [rect])

  // Escape must work wherever focus happens to be (the replay button in
  // Settings keeps it, for one), so it listens on the window, not the card.
  useEffect(() => {
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      onClose()
    }
    window.addEventListener('keydown', onEscape)
    return () => window.removeEventListener('keydown', onEscape)
  }, [onClose])

  const last = index >= steps.length - 1
  const next = useCallback(() => {
    if (last) onClose()
    else setIndex((i) => i + 1)
  }, [last, onClose])

  const onKeyDown = useCallback((event: React.KeyboardEvent) => {
    if (event.key !== 'Tab') return
    // Two buttons is the whole tab order; wrap it by hand rather than
    // pulling in a focus-trap dependency for a card this small.
    const focusable = cardRef.current?.querySelectorAll<HTMLElement>('button') ?? []
    const first = focusable[0]
    const end = focusable[focusable.length - 1]
    if (first === undefined || end === undefined) return
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      end.focus()
    } else if (!event.shiftKey && document.activeElement === end) {
      event.preventDefault()
      first.focus()
    }
  }, [])

  if (step === undefined || rect === null) return null

  // The ring hugs the anchor with a little air; its shadow is the backdrop.
  const pad = 6
  const ring = {
    left: rect.left - pad,
    top: rect.top - pad,
    width: rect.width + pad * 2,
    height: rect.height + pad * 2,
  }

  // Card placement: beside a sidebar anchor, above the bottom nav, below the
  // corner buttons — decided from where the anchor sits, clamped to the
  // viewport. Widths in px because they are measured against the viewport,
  // not read as text.
  const vw = window.innerWidth
  const vh = window.innerHeight
  const width = Math.min(304, vw - 24)
  const style: React.CSSProperties = { width }
  if (ring.left + ring.width + width + 24 < vw && ring.left < vw * 0.4) {
    style.left = ring.left + ring.width + 12
    style.top = Math.min(Math.max(ring.top, 12), vh - 220)
  } else if (ring.top > vh / 2) {
    style.bottom = vh - ring.top + 12
    style.left = Math.min(Math.max(ring.left + ring.width / 2 - width / 2, 12), vw - width - 12)
  } else {
    style.top = ring.top + ring.height + 12
    style.left = Math.min(Math.max(ring.left + ring.width / 2 - width / 2, 12), vw - width - 12)
  }

  return (
    // The wrapper blocks interaction with the page while the tour is up; the
    // keyboard still drives everything through the focused card.
    // biome-ignore lint/a11y/noStaticElementInteractions: key handling lives on the wrapper so it catches Escape wherever focus sits inside the dialog.
    <div className="fixed inset-0 z-30" onKeyDown={onKeyDown}>
      <div
        aria-hidden
        className="absolute rounded-card border"
        style={{
          ...ring,
          borderColor: 'var(--accent)',
          boxShadow: '0 0 0 200vmax var(--scrim)',
        }}
      />

      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Tour — ${step.title}`}
        tabIndex={-1}
        className="absolute rounded-card border border-rule bg-surface p-4 shadow-raised outline-none"
        style={style}
      >
        <h2 className="font-display font-semibold text-ink text-sm">{step.title}</h2>
        <p className="mt-1 text-ink-mute text-sm leading-relaxed">{step.body}</p>

        <div className="mt-3 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={onClose}
            className="tap-target rounded-pill border border-rule px-3 py-1 text-ink-mute text-xs transition-colors hover:text-ink"
          >
            Skip
          </button>

          <div className="flex items-center gap-1" aria-hidden>
            {steps.map((s, i) => (
              <span
                key={s.anchor}
                className="size-1.5 rounded-pill"
                style={{ background: i === index ? 'var(--accent)' : 'var(--rule)' }}
              />
            ))}
          </div>

          <button
            type="button"
            onClick={next}
            className="tap-target rounded-pill px-3 py-1 text-xs"
            style={{ background: 'var(--accent-tint)', color: 'var(--accent)', fontWeight: 600 }}
          >
            {last ? 'Done' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  )
}
