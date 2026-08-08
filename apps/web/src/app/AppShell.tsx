import { Link, Outlet, useRouterState } from '@tanstack/react-router'
import {
  CalendarDays,
  ChevronsDown,
  ClipboardList,
  Compass,
  Landmark,
  Map as MapIcon,
  Search,
  Settings,
  Sun,
} from 'lucide-react'
import type { ComponentType } from 'react'
import { useAtlas } from '~/app/AtlasProvider'
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

/**
 * Five on a phone, because a sixth bottom-nav item is a 60px tap target.
 *
 * Browse and Search are both "find a thing you can name" and Search is the one
 * you reach for, so Browse moves to the sidebar-only list. The board earns a
 * primary slot: it is a thing you check *before* going out, which is the same
 * job as Today.
 */
const NAV: NavItem[] = [
  { to: '/', label: 'Calendar', icon: Sun },
  { to: '/board', label: 'Board', icon: ClipboardList },
  { to: '/search', label: 'Search', icon: Search },
  { to: '/museum', label: 'Museum', icon: Landmark },
  // The Mines earned the Map's slot: seal costs and biome contents are a
  // mid-game lookup, while the map is mostly reached from a place page — and
  // every place page links to it. On a phone the map keeps a corner button.
  { to: '/mines', label: 'Mines', icon: ChevronsDown },
]

/** Reachable from the sidebar, where there is room, and from links. */
const SECONDARY: NavItem[] = [
  { to: '/browse', label: 'Browse', icon: Compass },
  { to: '/map', label: 'Map', icon: MapIcon },
  { to: '/calendar', label: 'The year', icon: CalendarDays },
  { to: '/settings', label: 'Settings', icon: Settings },
]

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
        The corner pair, on a phone. The bottom nav is full at five, and these
        two do not earn a slot you hit mid-game — but until these buttons
        existed Settings was unreachable on mobile without typing the URL. A
        fixed corner costs one thumb-stretch for screens visited occasionally.
      */}
      <div className="fixed top-3 right-3 z-10 flex gap-2 lg:hidden">
        <Link
          to="/map"
          aria-label="Map"
          className="grid size-9 place-items-center rounded-full border border-rule bg-surface/90 text-ink-mute backdrop-blur transition-colors hover:text-ink"
        >
          <MapIcon size={17} strokeWidth={2} />
        </Link>
        <Link
          to="/settings"
          aria-label="Settings"
          className="grid size-9 place-items-center rounded-full border border-rule bg-surface/90 text-ink-mute backdrop-blur transition-colors hover:text-ink"
        >
          <Settings size={17} strokeWidth={2} />
        </Link>
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

  return (
    <nav
      aria-label="Sections"
      // `env(safe-area-inset-bottom)` is what keeps the bar clear of the iOS
      // home indicator. Without it the last 34px of every tap target is dead.
      className="fixed inset-x-0 bottom-0 z-10 border-rule border-t bg-surface/95 backdrop-blur lg:hidden"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <ul className="mx-auto flex max-w-lg">
        {NAV.map(({ to, label, icon: Icon }) => (
          <li key={to} className="flex-1">
            <Link
              to={to}
              aria-current={isActive(to) ? 'page' : undefined}
              className="flex flex-col items-center gap-0.5 py-2.5 text-[11px] transition-colors"
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
  const logo = useAtlas().mapUrl('brand/logo')

  return (
    <div className="px-3">
      {/* The game's own banner above our name — recognisable at a glance, and
          never *as* our name: the app stays "Mistria Codex", unaffiliated.
          Absent on a clone with no fetched art, and nothing else changes. */}
      {logo !== null && (
        <img src={logo} alt="" className="mb-2 h-auto w-full max-w-44 rounded-tile" />
      )}
      <div className="flex items-center gap-2.5">
        <span aria-hidden className="grid grid-cols-2 gap-0.5">
          {(['spring', 'summer', 'fall', 'winter'] as const).map((season) => (
            <span
              key={season}
              className="size-2 rounded-[1px]"
              style={{ background: `var(--${season})` }}
            />
          ))}
        </span>
        <span className="font-display font-semibold text-[15px] text-ink">Mistria Codex</span>
      </div>
    </div>
  )
}
