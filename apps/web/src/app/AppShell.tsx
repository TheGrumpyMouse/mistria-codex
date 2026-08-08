import { Link, Outlet, useRouterState } from '@tanstack/react-router'
import { ClipboardList, Compass, Landmark, Map as MapIcon, Search, Sun } from 'lucide-react'
import type { ComponentType } from 'react'
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
  { to: '/', label: 'Today', icon: Sun },
  { to: '/board', label: 'Board', icon: ClipboardList },
  { to: '/search', label: 'Search', icon: Search },
  { to: '/museum', label: 'Museum', icon: Landmark },
  { to: '/map', label: 'Map', icon: MapIcon },
]

/** Reachable from the sidebar, where there is room, and from links. */
const SECONDARY: NavItem[] = [{ to: '/browse', label: 'Browse', icon: Compass }]

export function AppShell() {
  return (
    <div className="min-h-dvh bg-paper">
      <Sidebar />

      {/*
        The shell no longer sets the measure. Most screens are a narrow reading
        column — that was the right call and `<Column>` is still the default —
        but a map is not read, it is looked at, and 512px of a 5442-unit valley
        makes every label illegible. Each route says how wide it wants to be.
      */}
      <main className="px-4 pt-4 pb-24 sm:px-6 lg:ml-64 lg:pb-10">
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
  return (
    <div className="flex items-center gap-2.5 px-3">
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
  )
}
