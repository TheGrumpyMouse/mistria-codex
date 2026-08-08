import {
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router'
import { AppShell } from '~/app/AppShell'
import { InstantSearch } from '~/lib/instant'
import { AboutRoute } from '~/routes/about'
import { BoardRoute } from '~/routes/board'
import { BrowseRoute } from '~/routes/browse'
import { DesignRoute } from '~/routes/design'
import { ItemRoute } from '~/routes/item'
import { MapRoute } from '~/routes/map'
import { MuseumRoute } from '~/routes/museum'
import { SearchRoute } from '~/routes/search'
import { TodayRoute } from '~/routes/today'

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

const searchRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/search',
  component: SearchRoute,
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
  component: DesignRoute,
})

const routeTree = rootRoute.addChildren([
  todayRoute,
  browseRoute,
  searchRoute,
  museumRoute,
  mapRoute,
  boardRoute,
  itemRoute,
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
