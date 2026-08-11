import { Link, Outlet, useRouter, useRouterState } from '@tanstack/react-router'
import {
  ChevronsDown,
  ClipboardList,
  Compass,
  Ellipsis,
  Landmark,
  Map as MapIcon,
  PawPrint,
  Search,
  Settings,
  Sun,
  X,
} from 'lucide-react'
import { type ComponentType, useEffect, useRef, useState } from 'react'
import { useAtlas } from '~/app/AtlasProvider'
import { Tour } from '~/app/Tour'
import { Footer } from '~/components/Footer'

/**
 * The shell: bottom nav on a phone, sidebar on a desktop.
 *
 * Bottom nav is not a stylistic choice. This app is consulted mid-game with one
 * hand, and the thumb reaches the bottom of the screen — a top tab bar on a
 * 6-inch phone is a stretch every single time.
 */

interface NavItem {
  to: string
  label: string
  icon: ComponentType<{ size?: number; strokeWidth?: number }>
}

/** The tour's anchor name for a nav destination — `data-tour` on the link. */
const tourAnchor = (to: string): string => (to === '/' ? 'calendar' : to.slice(1))

// One const per destination so the four arrays below compose the same objects
// rather than restating them — a label that drifted between the sidebar and
// the More menu would read as two different places.
const CALENDAR: NavItem = { to: '/', label: 'Calendar', icon: Sun }
const BOARD: NavItem = { to: '/board', label: 'Board', icon: ClipboardList }
const SEARCH: NavItem = { to: '/search', label: 'Search', icon: Search }
const MUSEUM: NavItem = { to: '/museum', label: 'Museum', icon: Landmark }
const MINES: NavItem = { to: '/mines', label: 'Mines', icon: ChevronsDown }
const BROWSE: NavItem = { to: '/browse', label: 'Browse', icon: Compass }
const MAP: NavItem = { to: '/map', label: 'Map', icon: MapIcon }
const RANCH: NavItem = { to: '/ranch', label: 'Ranch', icon: PawPrint }
const SETTINGS: NavItem = { to: '/settings', label: 'Settings', icon: Settings }

/** The sidebar's primary block; SECONDARY continues it where there is room. */
const NAV: NavItem[] = [CALENDAR, BOARD, SEARCH, MUSEUM, MINES]
const SECONDARY: NavItem[] = [BROWSE, MAP, RANCH, SETTINGS]

/**
 * Four destinations and a More menu on a phone — a sixth bottom-nav item is a
 * 60px tap target. The Map earned the Board's slot: it is looked at mid-game
 * with one hand, while the board, mines, browse and settings are consulted
 * rather than glanced at, and one extra tap through More does not hurt them.
 */
const MOBILE_NAV: NavItem[] = [CALENDAR, MAP, SEARCH, MUSEUM]
const MORE_ITEMS: NavItem[] = [BOARD, MINES, BROWSE, RANCH, SETTINGS]

export function AppShell() {
  return (
    <div className="min-h-dvh bg-paper">
      {/*
        First thing in the tab order and invisible until focused. Without it a
        keyboard user tabs through six nav links on every single route before
        reaching the content — and on a reference app you navigate constantly,
        so it is six taps per lookup rather than six once.
      */}
      <a
        href="#main"
        className="-translate-y-full fixed top-0 left-0 z-20 rounded-br-card bg-surface px-4 py-2 text-ink text-sm transition-transform focus:translate-y-0"
      >
        Skip to content
      </a>

      <Sidebar />

      {/*
        The one surviving corner control, on a phone: the close-X on the
        settings screen. Map moved into the bottom nav and Settings into the
        More menu, so the corner gear and map button retired — but "the way out
        of Settings is back to whatever I was doing" is a behaviour the bottom
        nav cannot express, so the X stays.
      */}
      <div className="fixed top-3 right-3 z-10 lg:hidden">
        <CornerSettings />
      </div>

      {/*
        The shell no longer sets the measure. Most screens are a narrow reading
        column — that was the right call and `<Column>` is still the default —
        but a map is not read, it is looked at, and 512px of a 5442-unit valley
        makes every label illegible. Each route says how wide it wants to be.
      */}
      <main id="main" className="px-4 pt-4 pb-24 sm:px-6 lg:ml-64 lg:pb-10">
        <Outlet />
        <Column>
          <Footer />
        </Column>
      </main>

      <BottomNav />

      <Tour />
    </div>
  )
}

/**
 * The measure a screen is read at.
 *
 * `narrow` is the default and the one most screens want: this is a reference you
 * read a screen at a time on a phone, and the Day Dial is a 4x7 mosaic that
 * stops looking like a calendar when it is stretched across a desktop. `wide` is
 * for the things you look at rather than read.
 */
export function Column({
  children,
  width = 'narrow',
}: {
  children: React.ReactNode
  width?: 'narrow' | 'wide'
}) {
  return <div className={`mx-auto ${width === 'wide' ? 'max-w-4xl' : 'max-w-lg'}`}>{children}</div>
}

/**
 * The close control on the settings screen, and nothing anywhere else — the
 * way *into* Settings is the More menu now, but the way out is "back to
 * whatever I was doing", which only this can say. Falls back to home when
 * there is no history to return to (a deep link straight into Settings).
 */
function CornerSettings() {
  const router = useRouter()
  const pathname = useRouterState({ select: (state) => state.location.pathname })

  if (!pathname.startsWith('/settings')) return null

  const close = (): void => {
    if (!router.history.canGoBack()) {
      void router.navigate({ to: '/' })
      return
    }
    const before = router.state.location.href
    router.history.back()
    window.setTimeout(() => {
      if (router.state.location.href === before) void router.navigate({ to: '/' })
    }, 250)
  }

  return (
    <button
      type="button"
      onClick={close}
      aria-label="Close settings"
      className="grid size-11 place-items-center rounded-full border border-rule bg-surface/90 text-ink-mute backdrop-blur transition-colors hover:text-ink"
    >
      <X size={19} strokeWidth={2} />
    </button>
  )
}

function useIsActive(): (to: string) => boolean {
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  return (to) => (to === '/' ? pathname === '/' : pathname.startsWith(to))
}

function Sidebar() {
  const isActive = useIsActive()

  return (
    <nav
      aria-label="Sections"
      className="fixed inset-y-0 left-0 hidden w-56 flex-col border-rule border-r bg-surface px-3 py-5 lg:flex"
    >
      <Wordmark />
      <ul className="mt-6 flex flex-col gap-1">
        {[...NAV, ...SECONDARY].map(({ to, label, icon: Icon }) => (
          <li key={to}>
            <Link
              to={to}
              aria-current={isActive(to) ? 'page' : undefined}
              data-tour={tourAnchor(to)}
              className="flex items-center gap-3 rounded-tile px-3 py-2 text-sm transition-colors"
              style={
                isActive(to)
                  ? { background: 'var(--accent-tint)', color: 'var(--accent)', fontWeight: 600 }
                  : { color: 'var(--ink-mute)' }
              }
            >
              <Icon size={18} strokeWidth={2} />
              {label}
            </Link>
          </li>
        ))}
      </ul>

      <div className="mt-auto">
        <Link to="/about" className="block px-3 py-2 text-ink-faint text-xs hover:text-ink-mute">
          About &amp; credits
        </Link>
      </div>
    </nav>
  )
}

function BottomNav() {
  const isActive = useIsActive()
  const [open, setOpen] = useState(false)
  const moreRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLUListElement>(null)
  const pathname = useRouterState({ select: (state) => state.location.pathname })

  // Navigation closes the menu however it happens — a tapped link closes it
  // itself, but the back button never passes through a click handler.
  // biome-ignore lint/correctness/useExhaustiveDependencies: pathname is the trigger, not an input — any route change closes the menu.
  useEffect(() => {
    setOpen(false)
  }, [pathname])

  // Escape closes and hands focus back to the button that opened it. On the
  // window, not the panel, so it works wherever focus happens to sit — the
  // same reasoning as the tour's listener.
  useEffect(() => {
    if (!open) return
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setOpen(false)
      moreRef.current?.focus()
    }
    window.addEventListener('keydown', onEscape)
    return () => window.removeEventListener('keydown', onEscape)
  }, [open])

  // The first destination takes focus when the menu opens, so a keyboard user
  // is in the list rather than behind it.
  useEffect(() => {
    if (open) panelRef.current?.querySelector('a')?.focus()
  }, [open])

  const moreActive = MORE_ITEMS.some(({ to }) => isActive(to))

  return (
    <nav
      aria-label="Sections"
      // `env(safe-area-inset-bottom)` is what keeps the bar clear of the iOS
      // home indicator. Without it the last 34px of every tap target is dead.
      // It also means the More panel, anchored `absolute` to this nav, clears
      // the indicator for free.
      className="fixed inset-x-0 bottom-0 z-10 border-rule border-t bg-surface/95 backdrop-blur lg:hidden"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {open && (
        <>
          {/* Transparent backdrop, no scrim — this is a small disclosure, not
              a modal, and the scrim stays reserved for the tour's spotlight.
              Rendered before the panel so the panel paints above it. */}
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setOpen(false)}
            className="fixed inset-0 cursor-default"
          />
          {/* Disclosure-navigation pattern: a list of links behind
              aria-expanded, no role="menu" — menu roles obligate arrow-key
              roving that four links do not need. */}
          <ul
            id="more-menu"
            ref={panelRef}
            className="absolute right-3 bottom-full mb-2 w-48 rounded-card border border-rule bg-surface p-1 shadow-raised"
          >
            {MORE_ITEMS.map(({ to, label, icon: Icon }) => (
              <li key={to}>
                <Link
                  to={to}
                  aria-current={isActive(to) ? 'page' : undefined}
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-3 rounded-tile px-3 py-2.5 text-sm transition-colors"
                  style={
                    isActive(to)
                      ? {
                          background: 'var(--accent-tint)',
                          color: 'var(--accent)',
                          fontWeight: 600,
                        }
                      : { color: 'var(--ink-mute)' }
                  }
                >
                  <Icon size={18} strokeWidth={2} />
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}

      <ul className="mx-auto flex max-w-lg">
        {MOBILE_NAV.map(({ to, label, icon: Icon }) => (
          <li key={to} className="flex-1">
            <Link
              to={to}
              aria-current={isActive(to) ? 'page' : undefined}
              data-tour={tourAnchor(to)}
              className="flex flex-col items-center gap-0.5 py-2.5 text-[0.6875rem] transition-colors"
              style={
                isActive(to)
                  ? { color: 'var(--accent)', fontWeight: 600 }
                  : { color: 'var(--ink-mute)' }
              }
            >
              <Icon size={20} strokeWidth={2} />
              {label}
            </Link>
          </li>
        ))}
        <li className="flex-1">
          {/* Lit while the menu is open *or* while one of its destinations is
              the current screen — a closed menu must still say "you are in
              here somewhere". */}
          <button
            ref={moreRef}
            type="button"
            onClick={() => setOpen((was) => !was)}
            aria-expanded={open}
            aria-controls="more-menu"
            data-tour="more"
            className="flex w-full flex-col items-center gap-0.5 py-2.5 text-[0.6875rem] transition-colors"
            style={
              open || moreActive
                ? { color: 'var(--accent)', fontWeight: 600 }
                : { color: 'var(--ink-mute)' }
            }
          >
            <Ellipsis size={20} strokeWidth={2} />
            More
          </button>
        </li>
      </ul>
    </nav>
  )
}

/**
 * The wordmark is four tesserae and a name.
 *
 * One per season, in season order, which is the same grammar the Day Dial uses
 * — the mark and the signature element are the same idea at two sizes.
 */
export function Wordmark() {
  const house = useAtlas().mapUrl('brand/icon')

  return (
    <div className="px-3">
      <div className="flex items-center gap-2.5">
        {/* The game's little farmhouse beside our name — recognisable at a
            glance, and never *as* our name: the app stays "Mistria Codex",
            unaffiliated. On a clone with no fetched art the tesserae take its
            place, exactly as the app icon falls back to favicon.svg. */}
        {house !== null ? (
          <img src={house} alt="" className="sprite size-8" />
        ) : (
          <span aria-hidden className="grid grid-cols-2 gap-0.5">
            {(['spring', 'summer', 'fall', 'winter'] as const).map((season) => (
              <span
                key={season}
                className="size-2 rounded-[1px]"
                style={{ background: `var(--${season})` }}
              />
            ))}
          </span>
        )}
        <span className="font-display font-semibold text-[0.9375rem] text-ink">Mistria Codex</span>
      </div>
    </div>
  )
}
