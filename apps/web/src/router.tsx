import {
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router'
import { AppShell } from '~/app/AppShell'
import { InstantSearch } from '~/lib/instant'
import { AboutRoute } from '~/routes/about'
import { BestiaryRoute } from '~/routes/bestiary'
import { BoardRoute } from '~/routes/board'
import { BrowseRoute } from '~/routes/browse'
import { CalendarRoute } from '~/routes/calendar'
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
import { WhenRoute } from '~/routes/when'

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

const browseRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/browse',
  component: BrowseRoute,
})

const itemRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/item/$id',
  component: ItemRoute,
})

/**
 * Reverse lookup, under the item it is about.
 *
 * It takes the same validated instant as Today, because "in 43 days" has to be
 * counted from somewhere and the somewhere is whatever date the user was
 * looking at. A link to this page therefore carries that date with it.
 */
const whenRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/item/$id/when',
  component: WhenRoute,
  validateSearch: InstantSearch,
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
})

const calendarRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/calendar',
  component: CalendarRoute,
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
})

const mapRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/map',
  component: MapRoute,
})

const boardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/board',
  component: BoardRoute,
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
  whenRoute,
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
