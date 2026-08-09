# apps/web — the PWA

The frontend traps here are the ones that are invisible until production. Every
rule below has a failure mode that a green local build will not show you.

Design direction and tokens: [docs/design-system.md](../../docs/design-system.md).
The live version of it is the `/design` route.

---

## Hard rules

### 1. Never write a leading `/` in a URL

GitHub Pages serves this from `/<repo>/`. A path that starts with `/` resolves
against the domain root, works perfectly in `pnpm dev`, and 404s in production.

```ts
// wrong — works in dev, breaks on Pages
fetch('/data/meta.json')
// right
fetch(`${import.meta.env.BASE_URL}data/meta.json`)
```

In CSS, use a **relative** `url()` so Vite hashes the asset and rewrites the
path (`../assets/fonts/Fraunces.ttf`, not `/fonts/Fraunces.ttf`).

Routing is hash-based for the same reason: a static host has no rewrite rules,
so `/museum` is a request for a file that does not exist.

### 2. `null` is "unknown", and it never renders as `0` or an empty list

The dataset is careful about the difference between *not applicable*, *unknown*
and *none*. Rendering an unknown as `0`, `—` or an empty list throws that away
and reads as a confident "there is none", which is worse than saying nothing.

**Unknown renders as nothing.** A window with no recorded time simply has no
time line — never a "time unknown" badge (removed by owner decision: it served
no reader). *Not applicable* is a fact and renders plainly ("any time").
`data_gaps` still records the hole in the data.

The `.unverified` dashed treatment marks **inferences** ("place inferred") and
kindred hedges — a deduction must never render identically to a fact. **Never
a colour** — colour is spoken for by the seasons.

### 3. Never write `if (start > end)` for a time window

Midnight wrapping is resolved at build time. An availability window ships as
non-wrapping minute intervals; a schedule block ships split, with `to: "00:00"`
meaning end of day. If you find yourself comparing a start to an end to work out
which side of midnight something is on, the bug is upstream — fix it there.

### 4. A missing sprite is normal, not an error

`<ItemIcon>` draws the game's sprite when the atlas has one and a hashed glyph
when it does not. **The glyph path is permanent.** Thirty-two records have no art
anywhere, the atlas may not have loaded yet, and a clone that has never run
`pnpm assets:fetch` has no art at all — the app must render correctly in every
one of those cases. Never branch on "atlas not loaded"; ask for a sprite and
handle `null`.

**Never spell the fallback key by hand — use `iconKeyFor(id, index[id])`.**
Twenty call sites used to write ``index[id]?.i ?? `item/${id}` `` regardless of
what they were drawing, so an unindexed monster or place got the item family and
fell through to two arbitrary letters. It is `routeFor`'s companion and lives
beside it in `lib/search.ts`: the category decides the prefix there for the same
reason it decides the route.

That silence is the thing to watch. Every icon failure — a join that stops
resolving, an interface that drops `icon_key`, a wrong prefix — degrades to
something that looks designed. Nothing throws and nothing logs, so `e2e/icons.spec.mjs`
asserts that named surfaces render a *sprite*, not merely an icon.

Scaling is integer-only (`integerScale`). Pixel art at 1.5x renders visibly
lopsided, and `image-rendering: pixelated` does not rescue it. The `.sprite`
class carries that declaration once — do not repeat it per component.

### 4a. Icons go on lists, not into prose

A row, a chip or a heading takes an icon. A comma-separated run of names inside
a sentence does not: two dozen faces inline is noise, and a 24px tile in a 14px
line drags the leading around. "As a gift" on the item page and the asker run on
the board are deliberately text — the villager page already offers the icon view
of the same data behind its `DisplayToggle`.

Currency is the one exception, on detail pages only (`ui/tesserae`,
`ui/renown_gold`), and **the coin never replaces the unit**: it is `500t` beside
a coin, not `500`. The sprite is decoration that helps scanning; the `t` is the
fact, it matches every list row, and it still reads on a clone with no art.

Method labels stay text. Only three of twenty-two spawn methods have a
`ui/method_*` sprite, and three icons against nineteen blanks reads as broken
rather than sparse.

### 5. Never invent a date for something weather-gated

Weather is rolled per season, not scheduled: the game gives Fall four to six wet
days and does not say which. "The next Storm is Fall 17" is a fabrication, and
it is the tempting kind — a date renders so much better than a frequency.

`OpportunityCard` is the one place this decision lives. A rule that needs weather
gets a frequency from `meta.weatherOdds` and `daysAway: null`; a rule that does
not gets a real count of days. And the odds **group by `pool` before adding**:
rain and storm are the same four-to-six wet days seen twice, so summing them
claims a twelve-day rainy season.

### 6. Locked is shown, not hidden

A result the player cannot reach yet is tagged `locked`, with the reason. People
want to know the Legendary fish exists and why they can't catch it. Filtering it
out silently makes the app look like it has less data than it does.

The spoiler curtain follows the same principle: a record flagged `spoiler`
(index `s: 1`) keeps its row and its navigation — only the **name** is
withheld, behind `<SpoilerChip>`, and the detail page asks via `<SpoilerAsk>`.
Never filter a spoiler record out, and never redact with CSS blur — a blurred
real name is still in the DOM and a screen reader speaks it. The placeholder
text IS the redaction. Search shows the real name to someone whose query
already is that name (`typedTheName`) — redacting what the user typed reads as
a broken search, not as discretion.

### 7. No hardcoded hex, ever

### 8. No internal token ever renders raw

`lib/labels.ts` is the single translator: categories, methods, `data_gaps`,
requirement objects and shipped rule tokens all go through it. Unknown gap
tokens are **dropped, not de-underscored** — `id_pending_rename` told a player
nothing and looked broken. If a new screen prints a field name, the fix is a
label entry, not a `replace(/_/g, ' ')`.

Every colour comes from `styles/tokens.css`. The season accent is `var(--accent)`
and is set by `data-season` on the root element — a literal `#D4834A` is a fall
colour that stays fall in winter.

### 9. Font sizes in rem, touch targets 44px

Settings has a text-size choice that scales the root font-size. Every font size
must therefore be rem — Tailwind's scale already is; arbitrary values are
`text-[0.625rem]`, never `text-[10px]`, or that text silently ignores the
setting. Sprites stay px deliberately: pixel art only survives integer scaling,
so icons hold still while the words grow.

Small standalone controls — tiny links, filter chips, quiet buttons — carry the
`.tap-target` class, which inflates the hit area to 44px on touch screens
without moving layout. Inline links in running prose are exempt (WCAG agrees).
Checkboxes grow themselves; that rule is global in `app.css`.

---

## Shape

```
src/
  app/        AppShell — bottom nav on a phone, sidebar on a desktop
  components/ shared pieces; DayDial is the signature element
  lib/        pure helpers. instant.ts owns the URL search contract
  routes/     one file per screen
  styles/     tokens.css, app.css, fonts.css
```

**The display index holds four kinds of thing, and only `c` says which.** Items,
characters, monsters and locations share one id namespace, so search has always
returned all four — and every result used to link to `/item/$id`, which loads
`items.json` and answers "not found" for three of them. `routeFor(category)` in
`lib/search.ts` is the single place that mapping lives; a new category needs a
route there and not a filter on search. A dead-ended result reads as missing
data, which is the one impression this project cannot afford to give.

**`VITE_SYNC_URL` is build-time and must stay that way.** A sync endpoint
someone can type into a settings box is an endpoint an attacker can talk them
into typing, and the app's whole claim is that nothing leaves the device unless
you ask. Unset, `syncConfigured()` is false and the panel says so — it never
renders a button that cannot work. See [workers/sync/README.md](../../workers/sync/README.md).

**The instant lives in the URL**, validated by Zod in `lib/instant.ts` — not in a
store. `?season=fall&day=12&year=2&weather=rain&time=960` is the entire state of
the flagship screen, which makes an answer shareable and survivable across a
reload. Search params arrive as **strings** when someone pastes a link and as
numbers when the router wrote them, so the schema coerces, and anything
unreadable falls back to a default rather than throwing. A shared link that
errors is worse than no link.

## Commands

```
pnpm dev              vite, from the repo root
pnpm build:web        production build
pnpm preview:web      serve the build
pnpm check            biome + tsc + vitest, whole repo
pnpm e2e              the Playwright suite in e2e/ against dist/ (build:ship + build:web first)
```

**`pnpm e2e` is the local gate for UI changes.** It serves `dist/` under the
production base path and runs six specs, in three layers:

- **`sweep`** opens every static route and a sample of every category — ids
  drawn from the shipped index, so it covers whatever the dataset grew — and
  fails on anything that *looks* broken with no feature attached to it: a
  console error, a 404, a raw `snake_case` token on screen, an `undefined`,
  an empty page. ~600 assertions.
- **`journeys`** walks multi-screen intentions, where the seams are: a museum
  tick showing on the item page and back again, a filter surviving the back
  button, a setting outliving a reload, a spoiler staying revealed.
- **`icons`** asserts that specific surfaces draw a real sprite, because the
  glyph fallback means a broken join renders as a design choice. One case per
  root cause, so a failure says which join broke.
- **`smoke` / `mobile` / `tour` / `stale-version`** assert named features.

**A conditional assertion is not an assertion.** `if (await x.count() > 0)`
around a check means a surface that stops rendering passes silently — assert the
precondition too, or pick a fixture that cannot vanish.

It never runs in CI (needs a data bundle and a Chromium); run it before
handing over anything that touches routes or components.

`BASE_PATH` sets the base for a production build. CI passes the repository name;
locally it is `/`.

**On Windows, set `MSYS_NO_PATHCONV=1` with it.** Git Bash rewrites a leading
slash into a Windows path, so `BASE_PATH=/mistria-codex/` silently becomes
`C:/Program Files/Git/mistria-codex/` and the build emits asset URLs nobody can
serve. It looks like a base-path bug in the app and is not one.

```sh
MSYS_NO_PATHCONV=1 BASE_PATH=/mistria-codex/ pnpm build:web
MSYS_NO_PATHCONV=1 BASE_PATH=/mistria-codex/ pnpm preview:web
```

## Things that will bite

- **`JSON.parse` on the main thread.** A multi-megabyte parse freezes a
  mid-range Android for hundreds of milliseconds with no spinner, because React
  cannot paint either. Shard the data, load per category, parse the search index
  in a worker.
- **iOS evicts Cache Storage** after about a week for a PWA that is not
  installed. Call `navigator.storage.persist()`, and make a missing data file
  trigger a re-fetch rather than a white screen.
- **Never `skipWaiting` a service worker automatically.** Reloading someone
  mid-museum-audit is hostile. Show a toast and let them choose.
- **At A3, no atlas sheet goes in tier-1 precache.** They total a couple of
  megabytes and the app renders completely without them, so putting them behind
  Workbox's all-or-nothing install would trade a working offline app for
  prettier icons. `meta.json`'s `assets.sheets` is the tier-2 warm list;
  the filenames are content-addressed, so cache them forever once fetched.
  Portraits are lazier still. And do not precache `assets/game/portrait/*` file
  by file — a thousand individual entries is exactly what the packing step
  exists to avoid.
- **Counter-scale map pins** (`scale(1/k)` and `vector-effect="non-scaling-stroke"`)
  or they blob at high zoom and vanish at low. And never re-render the map art on
  pan — only the transform string changes.
