import {
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
} from '@tanstack/react-router'
import { AppShell } from '~/app/AppShell'
import { InstantSearch } from '~/lib/instant'
import { AboutRoute } from '~/routes/about'
import { BestiaryRoute } from '~/routes/bestiary'
import { BoardRoute } from '~/routes/board'
import { BrowseRoute } from '~/routes/browse'
import { DesignRoute } from '~/routes/design'
import { ItemRoute } from '~/routes/item'
import { MapRoute } from '~/routes/map'
import { MinesRoute } from '~/routes/mines'
import { MuseumRoute } from '~/routes/museum'
import { PlaceRoute } from '~/routes/place'
import { QuestRoute } from '~/routes/quest'
import { SearchRoute } from '~/routes/search'
import { SettingsRoute } from '~/routes/settings'
import { TodayRoute } from '~/routes/today'
import { VillagerRoute } from '~/routes/villager'

const rootRoute = createRootRoute({ component: AppShell })

/**
 * The instant lives in validated search params rather than a store.
 *
 * `validateSearch` is what makes `?season=fall&day=12` a typed object on the
 * way in — including when it arrives from somebody else's pasted link with a
 * day of 99 in it. Zod's defaults mean a missing or nonsense param becomes a
 * sensible value instead of a crash.
 */
const todayRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: TodayRoute,
  validateSearch: InstantSearch,
})

/**
 * List screens keep their filters in the URL, for the same reason the map
 * keeps its region there: the back button must restore what you were looking
 * at — the scroll restoration lands on the right rows only if the same rows
 * render. A junk value falls back rather than throwing.
 */
const optionalString = (value: unknown): string | undefined =>
  typeof value === 'string' && value !== '' ? value : undefined

const browseRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/browse',
  component: BrowseRoute,
  validateSearch: (search: Record<string, unknown>) => {
    const c = optionalString(search.c)
    const q = optionalString(search.q)
    // `s` is the furniture set — a second grouping level only that category has.
    const s = optionalString(search.s)
    return {
      ...(c === undefined ? {} : { c }),
      ...(q === undefined ? {} : { q }),
      ...(s === undefined ? {} : { s }),
    }
  },
})

const itemRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/item/$id',
  component: ItemRoute,
})

/**
 * The reverse lookup used to live here, and now lives on the item page.
 *
 * It and the item page's own "Where to find it" asked the same question from
 * one tap apart, and this screen answered it better — weather, frequencies and
 * a map that the item page did not have. Folding it in put those on the page
 * that was already open rather than behind a link that read like a different
 * question.
 *
 * The path survives as a redirect for the same reason `/calendar` does: a URL
 * that once worked should never start answering "not found".
 */
const whereRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/item/$id/where',
  beforeLoad: ({ params }) => {
    throw redirect({ to: '/item/$id', params: { id: params.id } })
  },
})

/**
 * A page per kind of thing, because they are not the same kind of thing.
 *
 * Search has always returned villagers, monsters and places alongside items —
 * they are all in the display index — and every result linked to `/item/$id`,
 * which loads items.json and says "not found" for any of them. A result that
 * dead-ends reads as missing data rather than as a missing screen, so the fix
 * is a route each rather than a filter on search.
 */
const villagerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/villager/$id',
  component: VillagerRoute,
})

const placeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/place/$id',
  component: PlaceRoute,
})

const monsterRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/monster/$id',
  component: BestiaryRoute,
})

const searchRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/search',
  component: SearchRoute,
  validateSearch: (search: Record<string, unknown>) => {
    const q = optionalString(search.q)
    return q === undefined ? {} : { q }
  },
})

/**
 * The year screen is gone — the calendar's Day Dial already names every
 * birthday and festival, with the real icons. The path survives as a redirect
 * because a URL that once worked should never start answering "not found".
 */
const calendarRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/calendar',
  beforeLoad: () => {
    throw redirect({ to: '/' })
  },
})

const minesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/mines',
  component: MinesRoute,
})

const questRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/quest/$id',
  component: QuestRoute,
})

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  component: SettingsRoute,
})

const museumRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/museum',
  component: MuseumRoute,
  validateSearch: (search: Record<string, unknown>) => {
    const wing = optionalString(search.wing)
    const q = optionalString(search.q)
    return { ...(wing === undefined ? {} : { wing }), ...(q === undefined ? {} : { q }) }
  },
})

const mapRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/map',
  component: MapRoute,
  // The focused region lives in the URL so a share, a reload and the back
  // button all mean the same thing. Anything unreadable falls back to the
  // overview rather than throwing — a shared link that errors is worse than
  // no link. The id is validated against real regions in the component.
  validateSearch: (search: Record<string, unknown>) => {
    const region = search.region
    const season = ['spring', 'summer', 'fall', 'winter'].includes(search.season as string)
      ? (search.season as string)
      : undefined
    const weather = ['clear', 'rain', 'storm', 'wind', 'snow', 'blizzard'].includes(
      search.weather as string,
    )
      ? (search.weather as string)
      : undefined
    const q = optionalString(search.q)
    return {
      ...(typeof region === 'string' && region !== '' ? { region } : {}),
      ...(season === undefined ? {} : { season }),
      ...(weather === undefined ? {} : { weather }),
      ...(q === undefined ? {} : { q }),
    }
  },
})

const boardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/board',
  component: BoardRoute,
  validateSearch: (search: Record<string, unknown>) => {
    const view = search.view === 'villagers' ? 'villagers' : undefined
    const season = ['spring', 'summer', 'fall', 'winter'].includes(search.season as string)
      ? (search.season as string)
      : undefined
    const q = optionalString(search.q)
    return {
      ...(view === undefined ? {} : { view }),
      ...(season === undefined ? {} : { season }),
      ...(q === undefined ? {} : { q }),
    }
  },
})

const aboutRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/about',
  component: AboutRoute,
})

const designRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/design',
  // A workbench, not a screen. It renders design tokens by their internal
  // names, which is exactly the vocabulary the rest of the app now keeps off
  // the screen — so production gets nothing at this address.
  component: import.meta.env.DEV ? DesignRoute : () => null,
})

const routeTree = rootRoute.addChildren([
  todayRoute,
  browseRoute,
  searchRoute,
  museumRoute,
  mapRoute,
  boardRoute,
  itemRoute,
  whereRoute,
  villagerRoute,
  placeRoute,
  monsterRoute,
  calendarRoute,
  minesRoute,
  questRoute,
  settingsRoute,
  aboutRoute,
  designRoute,
])

/**
 * Hash history, because GitHub Pages has no rewrite rules.
 *
 * A deep link to `/museum` on a static host is a request for a file that does
 * not exist. The usual workaround is to copy `index.html` to `404.html` and let
 * Pages serve it — which works, but returns HTTP 404 to the browser, so the
 * page is uncacheable by the service worker and unindexable. A hash keeps every
 * route on one real document.
 */
export const router = createRouter({
  routeTree,
  history: createHashHistory(),
  defaultPreload: 'intent',
  scrollRestoration: true,
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
