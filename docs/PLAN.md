# Mistria Codex — companion PWA for Fields of Mistria

## Context

The repo currently holds three research documents and nothing else. `docs/mistria-db-prompt.md` specifies a data layer; `docs/research/01-game-data.md` and `02-data-sources.md` map the game's content and where it can be sourced from. No code, no data, no schemas exist yet.

The goal is a **companion app you consult mid-game**: it's Fall 12, Year 2, it's raining, it's 4pm — what can I catch, what can I forage, whose birthday is it, and which of those things does the museum still want from me? Today that question is answered by tabbing out to a wiki and cross-referencing four pages. This app answers it in one screen.

It has to work on a phone, offline, with no login, and it has to remember what you've already donated.

**Decisions already taken (from the clarifying questions):**

| | |
|---|---|
| Game files | On another PC. Extract scripts get built and wired now; v1 data ships from the wiki. **Superseded at G1** — the install is now read directly into `sources/game/`. |
| Maps | Hand-authored stylised SVG we draw ourselves. Game art is proprietary and stays out of the repo. **Superseded at AS1/A9** — art ships under attribution in `assets/game/` and nowhere else, and the real map art layers under the mosaic, which survives as the no-art fallback. [DATA-POLICY.md](./DATA-POLICY.md) is the policy actually in force; this row is what was decided before it. |
| Sync | Cloudflare Worker + KV, free tier. Device-generated code, no signup. |
| Hosting | GitHub Pages. |
| Order | Data layer first, with a hard review gate before the app is built out. |

---

## Verified research findings

These were confirmed live during planning — build on them, don't re-derive them.

**The wiki's Cargo API works.** The form that works is `Special:CargoExport`, and fields **must** be table-qualified:

```
https://fieldsofmistria.wiki.gg/index.php?title=Special:CargoExport
  &tables=GiftPrefs&fields=GiftPrefs.charName,GiftPrefs.itemName,GiftPrefs.interest
  &limit=500&offset=0&format=json
```

`api.php?action=cargoquery` returns `MWException` — don't use it.

**Tables and their real fields:**

| Table | Rows | Fields |
|---|---|---|
| `Items` | 1,154 | itemName, ~~description~~, icon, sources[], location[], season, isCraftable, isBuyable, isConsumable, sellValue, health, stamina, mana, museum, tags[] |
| `GiftPrefs` | 5,328 | charName, itemName, interest |
| `Fish` | 143 | fishName, rarity, size, weather[], fishing, diving |
| `Bugs` | 103 | name, rarity, weather[], season[], time, spawnCondition, museumSet |
| `Crops` | 58 | name, seed, growthTime, regrowTime, museumSet |
| `Characters` | 56 | charName, relatives, affiliation, occupation, relationship, romanceable, birth, species, gender, eyes |
| `Artifacts` 110 · `ArtifactComments` 101 · `Recipes` 282 · `Ingredients` 663 · `FurnitureTEMP` 773 · `SortOrders` 6 |

**Three consequences that shape everything:**

1. **`Fish` has no season, no location, no time.** Those come from `Items`, joined on **display name**. That join is the reconciliation problem in its purest form — assert `Items.itemName` uniqueness across all 1,154 rows and fail hard if it breaks.
2. **Time data barely exists.** Only `Bugs.time` has anything, and it's loose text ("All day"). The headline feature runs on thin time data until game files land.
3. **Not in Cargo at all:** NPC schedules, museum set groupings (only partial via the `museumSet`/`museum` columns), forageables as a category, festivals, quests, shops, mines, skills, animals, buildings, locations, map pins. All of that is hand-curated or page-parsed.

`Items.description` is verbatim in-game text. It is never requested — see the licensing guard below.

---

## Design direction

The generic answer to "cozy farming game companion" is a cream background, rounded pastel cards, and a serif display face. That's the default, not a choice. Here's the choice.

**Thesis: The Valley Almanac.** A naturalist's field almanac crossed with a mosaic. Two things in the game earn this: the currency is **tesserae** — literally mosaic tiles — and the museum/archaeology thread makes specimen-card vocabulary honest rather than decorative. A Mistria season is exactly 28 days, which is exactly four 7-day weeks, which is exactly a 4×7 tile grid.

**Signature element — the Day Dial.** The instant picker is not a form. It's a mosaic: a 4×7 grid of tesserae for the season, a row of six weather tiles, and a 24-hour band with a draggable sun/moon marker. Festivals and birthdays are notched into the day tile itself, not explained in a legend. It's the thing the user touches most and the thing the app is remembered by.

```
┌─────────────────────────────────────────┐
│  FALL · YEAR 2                    ⌄     │
│  ┌──┬──┬──┬──┬──┬──┬──┐                 │
│  │ 1│ 2│ 3│ 4│ 5│ 6│ 7│  ← a tessera    │
│  ├──┼──┼──┼──┼──┼──┼──┤    per day      │
│  │ 8│ 9│▪10│11│[12]│13│14│  ▪ festival   │
│  ├──┼──┼──┼──┼──┼──┼──┤  [ ] selected   │
│  │15│16│17│18│19│20│21│                 │
│  ├──┼──┼──┼──┼──┼──┼──┤                 │
│  │22│23│24│25│26│27│28│                 │
│  └──┴──┴──┴──┴──┴──┴──┘                 │
│  ☀  ☂  ⚡  ≋  ❄  ✳     ← weather tiles  │
│  6 ─────●──────────── 2am               │
│         4:00 PM                          │
└─────────────────────────────────────────┘
        ↓ collapses on scroll to:
┌─────────────────────────────────────────┐
│  Fall 12 · Y2 · Rain · 4:00 PM      ⌃   │
└─────────────────────────────────────────┘
```

**Palette.** Paper ground, warm-dark ink, and a **season-driven accent** — the chrome tells you which season you're in, so no badge has to. That's the one risk taken, and it's justified because season is the app's dominant state.

```
--paper    #FBF8F3   ground        --ink      #2E2A33   text (warm, purple-leaning)
--surface  #FFFFFF   cards         --ink-mute #736C7A   secondary
--rule     #E8E2DA   hairlines
spring #7FBF8A / tint #EAF5EC      fall   #D4834A / tint #FAEDE2
summer #4FA8C9 / tint #E6F2F7      winter #8B93C9 / tint #ECEDF7
```

Signal colours sit outside the season system so they never shift meaning: museum gold `#C9A227`, gap/missing rose `#C96A6A`. **Unverified data is a dashed hollow outline in muted ink, never a colour** — colour is spoken for.

**Type.** Self-hosted (offline PWA — no Google Fonts CDN), all OFL.

- **Fraunces** (variable, `WONK` dialled up) — headings and display numerals. A soft serif with genuine oddity, deliberately not the Playfair/Instrument Serif default.
- **Figtree** (variable) — body and UI. Humanist-geometric, holds up at 13px on a phone.
- **IBM Plex Mono** — tesserae values, times, coordinates, the device code. Functional: prices align in dense lists, and the sync code has to be transcribable.

**Pixel-ness lives in the geometry, not the type.** A pixel font at 13px on mobile is illegible and reads as costume. Instead: a strict **4px spacing scale**, tiles at **2px radius**, cards at **10px**. The tessera is sharp; everything around it is soft. That contrast is the system.

**Icons.** Lucide (MIT) covers all UI chrome. Game categories use the real sprites, brought in under attribution at **AS1** — see `docs/DATA-POLICY.md` for the policy and the removal procedure. `ItemIcon` resolves an `icon_key` against a packed atlas and falls back to a hashed glyph on a pastel ground when there is no sprite. **The fallback is permanent, not a stopgap:** about thirty records have no art on the wiki, and a clone that has never run `pnpm assets:fetch` has none at all — the app renders correctly either way.

Light-only for v1. Dark mode is a real want for a night-cycle game but is post-v1 — half-doing it is worse than not.

---

## Architecture

pnpm workspace, Node 24, TypeScript strict throughout.

```
packages/
  schema/          @mistria/schema — Zod contracts, availability model, toSnakeId, MiniSearch options
  pipeline/        extract/ enrich/ normalise/ build/ validate/
  sync-client/     the CRDT merge — imported by both the app and the Worker
apps/web/          Vite + React 19 + TanStack Router
workers/sync/      Cloudflare Worker (Hono) + wrangler.toml

sources/           TIER 1 — raw wiki/game snapshots. Generated, committed, never hand-edited.
curated/           TIER 2 — hand-authored. Vocab, aliases, museum sets, schedules, blurbs, maps.
data/              TIER 3 — normalised entities. Generated, committed, pretty, sorted. The reviewable DB.
apps/web/public/data/   build output. Gitignored.
```

The invariant that makes this work: **`data/` is a pure deterministic function of `sources/ + curated/`**, enforced in CI by regenerating and running `git diff --exit-code`. Three tiers exist because the db-prompt's single `data/` directory was "hand-maintained + generated" — the one property that guarantees a regeneration silently eats someone's hand edits.

The monorepo is not about build orchestration. It's that `workers/sync` needs `@cloudflare/workers-types` and `apps/web` needs DOM lib, and those two type environments fight in one tsconfig — while `sync-client`'s merge genuinely must be imported by both.

**Tooling:** pnpm 10 · tsx · Zod 4 (`z.toJSONSchema()` emits `build/schema/*.json`) · Ajv 8 as an independent second validator · smol-toml · MiniSearch · Biome · Vitest + fast-check · Hono + wrangler 4.

> **Stale, kept for the record.** Several entries above were planned and never
> adopted — MiniSearch, fast-check and Hono are not dependencies of this
> repository. See "What was planned and dropped" in
> [ARCHITECTURE.md](ARCHITECTURE.md), which describes the system as built.
> The emitted JSON Schema moved from `docs/schema/` to `build/schema/`
> (`packages/schema/src/emit-json-schema.ts`); the abandoned copy under `docs/`
> was deleted after it began failing `biome ci` and was found to be two
> datasets out of date.

**App:** Vite 7 · React 19 · TanStack Router (the Today view's whole state — `?season&day&year&weather&time` — belongs in validated search params, not string-munging) · Tailwind v4 with CSS-variable tokens (shared with the SVG maps) · Radix primitives, cherry-picked · Dexie 4 · Zustand · `vite-plugin-pwa` in `injectManifest` mode · `@use-gesture/react` + raw SVG for maps · `@tanstack/react-virtual`.

Rejected: Next.js (ships a server framework for a project with no server), TanStack Query (game data never invalidates), Fuse.js (can't consume a prebuilt index), Leaflet (tile-server machinery for a handful of static SVGs), MUI/Chakra (fight the aesthetic, cost the bytes).

---

## The availability model — the spine

This is the single most important shape in the project. Everything else is a viewer.

**Availability is an array of windows. Each window is an AND of constraints; the array is an OR.** Non-obvious and essential: a bug can be spring-in-town-at-night *and* all-season-in-the-mines-any-time. A flat `{seasons, weather, time}` on the entity cannot express that, and will silently produce wrong answers on the flagship screen.

Authored in `data/` as windows on the entity (reviewable in PRs):

```jsonc
{
  "id": "rainbow_trout",
  "availability": [
    { "method": "fishing", "habitats": ["river"],
      "locations": ["river_town", "river_narrows"],
      "seasons": ["spring", "summer"],
      "weather": ["clear", "rain", "storm", "wind"], "weather_precision": "exact",
      "time": [{ "from": "06:00", "to": "19:00" }], "time_precision": "block",
      "days": null, "dates": null, "depth": null,
      "rarity": "uncommon", "requires": [],
      "confidence": "inferred", "prov": "wiki_cargo" },
    { "method": "diving", "habitats": ["mine_water"], "locations": ["mine_tide_caverns"],
      "seasons": ["spring","summer","fall","winter"],
      "weather": null, "weather_precision": "not_applicable",
      "depth": { "min": 21, "max": 39 }, "rarity": "rare",
      "requires": [{ "type": "skill", "key": "fishing", "op": ">=", "value": 30 }] }
  ]
}
```

Decisions worth defending:

- **`seasons`/`weather` are always fully expanded arrays, never an `"all"` magic string.** Query code becomes a set intersection with zero special cases. Forty bytes buys a total function.
- **`weather: null` means *not applicable*, not *unknown*.** Mines and interiors have no weather. Unknown is `data_gaps: ["weather"]` on the record — never a null the matcher has to guess about.
- **Time wraps.** `to < from` means past midnight. The build normalises this into two non-wrapping intervals before shipping. Runtime code must never contain `if (start > end)` — this is the highest-density bug area in the codebase.
- **The research doc's time blocks overlap** (Morning 6–11, Day 6–20, Night 20–2). They are not a partition. Define our own canonical non-overlapping partition for UI chips (`morning 06–11 / day 11–18 / evening 18–20 / night 20–02`) and treat the wiki's labels as ranges to materialise, not bucket names.
- **`habitats` alongside `locations`.** The wiki says "Pond"; there are three ponds. Store both: text reads "found in ponds" (the player's mental model), the map drops three **hollow** pins, and the window carries `confidence: "inferred"` so an inference never renders identically to a fact.
- **`requires` is structured in shipped data** (`{type, key, op, value}`), authored as tokens (`skill:fishing>=30`) in `curated/`. The client never string-parses.

**The semantic decision that has to be made now: unknown does not exclude.** If `time` is null because we lack the data, the window matches every time of day and the result is badged "time unknown". Treating unknown as excluded makes the flagship screen quietly hide correct answers — far worse than showing an unverified one. Given how thin the wiki's time data is, this is the difference between the feature working and the feature disappointing.

### Shipped form

`data/` keeps windows on the entity for reviewability. **`public/data/availability.json` flattens to one record per (entity × method × location) with bitmasks precomputed** — that's what the runtime wants:

```ts
interface AvailabilityRule {
  e: string;               // entity id
  k: Kind;                 // fish|bug|forage|crop|mineDrop|dig|shopStock|festival|birthday|npcSchedule|weeklyEvent
  loc: number; sub?: number;
  sea: number;             // season bitmask   Spring1 Summer2 Fall4 Winter8
  wx: number;              // weather bitmask  Clear1 Rain2 Storm4 Wind8 Snow16 Blizzard32
  t: [number, number][];   // minute windows, already split at midnight
  d?: [number, number]; dow?: number; y?: number;
  rar?: 0|1|2|3; req?: string[]; p?: [number, number];  // pin override in viewBox space
}
```

At boot the app builds a **structure-of-arrays typed-array index bucketed by season** (~10–20ms), plus `byEntity`, `byLocation`, `byKind` maps that come free and power reverse lookup and map clustering.

**The query is a linear scan over one season bucket.** ~1.5k rules per bucket × six integer comparisons is under 100µs and fits in L2. An interval tree would be slower in practice and ten times the bug surface. Ship the scan.

Results get a second cheap pass: **gate filtering tags each result `locked | unlocked | unknown` rather than hiding it** — users want to know the Legendary fish exists and why they can't catch it — and a progress join tags `isMuseumGap`. Memoised on `season|day|year|weather|timeBucket|filterHash|progressVersion`, so dragging the time slider hits cache on most frames.

**Reverse lookup runs off the same index** via `byEntity`, walking forward at most 112 days. Critically: **weather is stochastic and the UI must never pretend otherwise.** Emit a weather mask plus a likelihood from a per-season odds table. Copy reads *"Fall, any day, River, 6am–8pm — needs Windy (≈15% of Fall days)"*, never a fabricated specific date. One `<OpportunityCard>` renders this in all three places it appears.

The Today view is a **pipeline of pure providers** — `fish.ts`, `bugs.ts`, `forage.ts`, `cropsReady.ts`, `festivals.ts`, `birthdays.ts`, `shopStock.ts`, `weeklyEvents.ts`, `museumGaps.ts`, `npcLocations.ts` — each `(instant, index, data, progress) => TodaySection`, registered in one file. Adding a game system is one new file plus one registry line, which is what stops the Today view becoming a 900-line component.

---

## Name reconciliation

The hard problem: the wiki gives display names, the game gives internal snake_case names, and the game files are on another PC.

1. **Provisional slugs** — `id = toSnakeId(displayName)`, `id_status: "provisional"`. Write `toSnakeId` by hand (NFKD, strip marks, `&`→`and`, drop apostrophes, non-alnum→`_`), unit-tested against `Céline`, `Balor's Wagon`, `Perfect Pink Diamond`. Do not add a slugify dependency whose unicode behaviour you'll debug at 1am.
2. **Seed real internal names early** from `AnnaNomoly/legacy-fields-of-mistria-mods` — a ~1,900-line table of numeric ID ↔ internal name ↔ display name at v0.15.0. Parse to `curated/aliases/item_names_v0_15_0.json`; matches get `id_status: "confirmed_stale"`. High value, low cost: it surfaces every case where the naive slug differs from the game's actual name — precisely the error class that's undetectable later. Emit `docs/id-divergence.md` as the risk register. (A factual ID↔name mapping is not prose; derive, attribute, don't copy verbatim.)
3. **Alias tables** in `curated/aliases/` carry the rest — gift prefs, recipe ingredients, museum sets and shop stock all reference items by display name.
4. **Resolution is ordered and fails loudly**: canonical id → canonical display name → alias table → normalised slug → **UNRESOLVED**, appended to `build/unresolved.json` with three fuzzy suggestions. `--strict` exits non-zero. **The build fails on an unrecognised token rather than guessing**, because a guess becomes a wrong fact that is impossible to find later.

**The migration trap, which must be handled from day one.** User progress in IndexedDB and KV stores item ids. When game files arrive and ids get rewritten en masse, every user's museum tracker orphans. So from Stage 0: every record carries `former_ids[]`, the build emits `public/data/id_migrations.json`, the client applies migrations before merge, and the Worker rejects PUTs with a stale `schemaVersion` (426) so an old device can't re-inject dead ids. Retrofitting this after users exist means data loss.

---

## Licensing guard

The rules in the db-prompt are hard constraints. Enforcement, in order of strength:

1. **Never request `Items.description`.** The Cargo fetcher's `fields=` parameter simply omits it. Not-fetching beats fetching-and-stripping.
2. **Denylist in `writeJson()`** — throws if any key matching `/^(description|desc|flavou?r_text|text|localisation|tooltip)$/i` appears at any depth. Also catches game-file extraction later.
3. **CI licensing check fails the build** if: a denylisted key appears; any string outside an allowlist (`blurb`, `notes`, `name`) exceeds 200 chars (long strings are the signature of copied prose); any image file appears outside `apps/web/src/assets` and `curated/maps`.
4. **Our own `blurb`, defaulting to null.** Explicitly forbidden in `CONTRIBUTING.md` and `CLAUDE.md`: **LLM-paraphrasing the in-game description into a blurb.** Paraphrase of a short creative sentence is still derivative, and it does exactly what the rule exists to prevent while looking like compliance. It's the most tempting shortcut in the project and needs one blunt sentence.
5. **Records carry `icon_key` strings only** — never an image path, never a URL. Game art lives in `assets/game/`, is listed in one manifest, and is served from our own origin. Wiki images are never hotlinked.
6. `LICENSE` (MIT, code), `DATA-LICENSE.md`, `SOURCES.md`, `docs/DATA-POLICY.md`, in-app credit to Fields of Mistria Wiki (wiki.gg), and an unofficial-fan-project disclaimer.

The guard catches accidents. It does not catch bad judgement — hence the blunt sentence.

---

## Build output and GitHub Pages

**GitHub Pages sends fixed response headers — you cannot set `Cache-Control` per path.** Any plan relying on `immutable` for data and `no-cache` for a manifest doesn't work there. Therefore:

- Version lives **in the URL**: `public/data/v/<dataVersion>/…`, with only `meta.json` at a stable path.
- `dataVersion` = sha256 over sorted `(filename, fileSha256)` pairs, truncated to 10 hex. Content-addressed, so a rebuild with no data change produces no SW update and no spurious download.
- **The service worker owns all cache policy.** It fetches `meta.json` with `cache: 'no-store'` on activate and on `visibilitychange`; on a version change it precaches the new set, swaps atomically, then shows a **non-blocking toast**. Never auto-`skipWaiting` — reloading someone mid-museum-audit is hostile.
- `basePath` comes from `meta.json`. Hardcoding `/data/…` works in dev and breaks on Pages; ban leading slashes with a lint rule and build every URL from `import.meta.env.BASE_URL`.
- **Two-tier precache.** Workbox `precacheAndRoute` fails the *entire* SW install if one entry 404s, so tier 1 is small and mandatory (shell + `meta` + `index` + `availability` + `locations` + `calendar`); tier 2 is `CacheFirst` with per-file `try/catch` warm-up on activate. This is the difference between "offline works" and "the app never installs".
- Also required: `.nojekyll`, and `index.html` copied to `404.html` for SPA deep links.

`items.json` will land around 700KB and must split; `items.furniture.json` (773 rows) is never precached. Search index is MiniSearch serialised at build time with options exported from `@mistria/schema` so build and client are provably identical, parsed **in a Worker via Comlink** — 150–400ms of parse on a mid-range Android is a frozen main thread with no spinner. The search index must carry enough display fields to paint a result row without loading a category bundle; failing that turns "instant search" into a multi-MB download.

---

## Sync

**Free-tier KV allows 1,000 writes/day.** That number shapes the design.

**Device code:** Crockford Base32, 80 bits + a mod-37 checksum char, displayed as `MSTR-4K7Q-9XZ2-B3HF-P`. Crockford excludes I/L/O/U and folds ambiguous characters, so it survives being read aloud. **The client generates it locally** — no `POST /codes` endpoint, which saves a write, a round trip, and removes the obvious write-amplification target. The checksum is validated client-side before any network call, so typos are instant and malformed codes never touch KV. It goes in `Authorization: Bearer`, never a query string.

**Every tracked fact is `id → ±epochSeconds`** — positive checked, negative an explicit tombstone. That one decision makes the whole thing an LWW-element-map CRDT: take the larger `|t|`, prefer positive on ties. Commutative, associative, idempotent. Two devices checking different things converge to the union with no conflict; unchecking propagates instead of being resurrected. **The merge runs on the client**, keeping Worker CPU trivially under 10ms and putting the merge in one property-testable place.

Worker API (Hono, `/v1`): `GET`/`HEAD`/`PUT`/`DELETE /progress/:code` + `/health`. `PUT` requires `If-Match`, and **a 409 returns the current server blob** so the client merges and retries in one round trip rather than two. CORS is an explicit allowlist, not `*`. Cloudflare's Rate Limiting binding (costs no KV ops) caps 30 req/min per IP and 10 writes/min per code.

Sync is debounced 30s idle plus `visibilitychange`/`pagehide`, with **no-op suppression** — write back only if the merge actually changed bytes. That keeps a realistic active user under 50 writes/day. If the ceiling ever binds, D1's free tier is 100k writes/day and the storage interface is deliberately four methods in one file.

**If the user never enters a code, the app makes zero calls to the Worker.** Sync is opt-in enhancement, never on the interaction path. Status surfaces honestly as `never | offline | pending | synced | conflict`.

The UI must say plainly: **anyone with this code can read and change your progress.** That's the price of no signup, and it should be stated rather than implied away.

Locally: **one flat Dexie `progress` table** keyed `domain:entityId`, not a table per feature. Sync becomes a single generic merge, and adding "bugs caught" later needs no migration and no sync-code change. `useLiveQuery` reads are scoped per wing and selected into memoised `Set`s — 399 rows re-rendering a grid on every toggle is a real trap.

---

## Maps

Raw inline SVG, one authored file per region in `curated/maps/`, imported via `vite-plugin-svgr` and `React.lazy`-loaded so `/map/mines` never ships the town map. Pan/zoom is a single CSS transform on a wrapper `<g>`, driven by `@use-gesture/react` (~12KB, and it owns the iOS pinch-zoom / `touch-action` problems you don't want).

**All coordinates are SVG user units in the map's `viewBox` — never pixels.** A pin defaults to `location.anchor`; a window's `spot_ids[]` overrides it. CI asserts every anchor falls inside its map's viewBox, and each SVG root carries `data-map-version` matched against the `map_version` its pins were authored against — that's the fix for "redrew the region, every pin silently moved".

Two traps to handle explicitly: **counter-scale the pins** (`scale(1/k)` + `vector-effect="non-scaling-stroke"`, or they blob at high zoom and vanish at low), and **never re-render the art on pan** — only the transform string changes.

The important part: **`<MapPins>` consumes the literal output of `findAvailable`**, grouped by `byLocation`. The Today list and the map are two renderers over one query result and can never disagree. NPC schedules reuse the identical pin layer with a time scrubber.

Ship two regions first (Town, Farm); the rest land one at a time behind a "map coming soon" state, so hand-drawing never blocks a release.

---

## Milestones

**Data first, with a hard review gate after Stage D1.** After that gate, the data and app tracks run in parallel.

| | Milestone | Done when |
|---|---|---|
| **D0** | Workspace, `@mistria/schema` (primitives, availability model, envelope, `toSnakeId`), JSON Schema emitted from Zod, licensing docs, empty `id_migrations.json` + `former_ids[]` | `pnpm validate` passes on an empty dataset; JSON Schema exists for every entity type |
| **D1** | **Review gate.** Paginated Cargo fetcher → `sources/`; wikitext tokeniser; alias resolver; the four vocab files; fish + crops normalised end to end; ship bundle with meta/index/search | A node script given `{season:'fall', weather:'rain', time:'19:00'}` prints the catchable fish and where. Coverage shows 143/143 fish, and how many have a resolved location. **Stop and review.** |
| **D2** | Full Cargo ingest (Items, Bugs, Characters, GiftPrefs×5328, Artifacts, Recipes, Ingredients, Furniture). Reverse gift index, item↔recipe graph. Seed internal names from the v0.15.0 table; emit `docs/id-divergence.md` | Coverage report per category; `docs/conflicts.md` generated; unresolved queue under 50 |
| **D3** | Curated layer — locations with anchors, all ~80 museum sets, forageables, festivals, shops, skills/perks, quests, animals, buildings, mines | Museum passes the "every donatable item in exactly one set" assertion; "what's findable now" returns forageables and bugs, not just fish |
| **A0** | App skeleton — Vite/React/Router/Tailwind tokens, AppShell (bottom nav mobile / sidebar desktop), design system, `ItemIcon` glyphs, Pages deploy, CI green | A deployed empty app on the real base path |
| **AB1** | Request board — `request_board.json` shipped form, `/board` by item and by villager, season filter | Done, then made game-first in 1.5.1: 226 requests (items, givers and rewards from `fetch_quests.toml`; the wiki's list was 212), gates in words, given-ticks two-way synced with the item pages. |
| **A1** | Browse + detail — `/browse`, `/item/$id` with sources and gift opinions | Already a usable wiki. Built on `index.json` at 103KB, not `items.json` at a megabyte. Done. |
| **A2** | Search — ranked name search over `index.json`, no index file and no worker | Every searchable field is a name and they are already downloaded. Done. |
| **AS1** | Game assets under attribution — manifest, throttled fetcher, packed atlases, footer + About, generated `ATTRIBUTION.md`, manifest-enforced licensing guard | `pnpm validate` fails on an unmanifested file *and* on a manifest entry with no file. Sprites render crisply at 1x and 2x; a record with no sprite still shows its glyph. |
| **A3** | PWA — `injectManifest` SW, shell precached, data and art cached at runtime, update toast, `storage.persist()` | Verified against a real production build with the server stopped: the app cold-loads and renders. **The offline promise is real.** Done. |
| **A4** | **Today view + engine** — flattened `availability.json`, `findAvailable`, the Day Dial with URL state | The headline. 832 rules, 237 findable on a rainy Fall 12. Done. |
| **A5** | Museum + Dexie — wings, sets, donation toggles, gap view | 409 items across 82 sets; a donation survives a hard reload. The CRDT merge is written and property-tested ahead of S1. Done. |
| **A6** | Reverse lookup — a screen per item, `OpportunityCard`, and a route into it from every missing museum row | Done, then **folded into the item page**. It shipped as `/item/$id/where` and was a second answer to a question the item page already had a worse answer to, one tap apart. `OpportunityCard` now renders "Where to find it" in place; the path is a redirect and the museum's `where?` shortcut is gone, because the row's own name link lands on the section. The card reads the item's **own windows**, not the flat index — the index has no row for the eleven machine-only items, labels rows by kind rather than method, and ships requirements as names instead of ids. Weather-gated rules still get a frequency from the game's seasonal counts and never a date; the countdown did not come across, because the item route carries no instant and `items.json` still ships ten midnight-wrapping windows. See apps/web/CLAUDE.md §2b. |
| **D4/A7** | Maps + schedules — anchors from the wiki's DataMaps pages (done: 27/29), one hand-drawn SVG on their published `0 0 5442 3599` space, pan/zoom + pins | `whereIs(npc, ctx)` and `whoIsAt(loc, ctx)` correct; every anchor inside the viewBox |
| **S1** | Cloudflare Worker + KV, device code, CRDT merge | Code complete. `apps/web/src/lib/sync.ts` does pull → merge → `PUT If-Match`, retries a 409 once against the blob the Worker returns with it, and skips the write when the merge changed nothing. `/settings` creates or enters a code and says, next to the code, that anyone holding it can change the progress. **Remaining is account work, not code**: `wrangler kv namespace create`, `ALLOWED_ORIGINS`, deploy, and the `VITE_SYNC_URL` repo variable — [workers/sync/README.md](../workers/sync/README.md). Unset, the app builds with sync off and says so. |
| **A8** | Progress tracking, calendar, polish, a11y sweep, `/about` | `/calendar` puts all 34 birthdays and 10 festivals on four grids of 28. `/villager/$id`, `/place/$id` and `/monster/$id` close the dead end where every search result — characters, places, monsters — linked to `/item/$id` and got "not found". Skip link added. `/about` was already written at AS1. Lighthouse pass still outstanding. |
| **G3** | Artifacts + seals, from `artifacts.toml`, `dungeons/`, `seals.toml` and the story quests | Done. 90 artifacts with no availability dropped to **0** — room→pool→set-member→location is stated end to end, mine pools carry biome floor ranges, fished/dived pools carry their perk gates from `fish.toml` (whose `perk_artifact` is a string the old `bool()` read silently nulled). New `data/seals.json`: each seal, its quest, and its exact item price. `game:artifact-pool-coverage` fails the build if a pool regresses. |
| **A9** | Player-ready pass — copy, universal linking, Calendar flagship, real map art, /mines, /quest, app icon | Done. All dev jargon out of the UI (`lib/labels.ts` is the single translator; internal gap tokens drop, never render). Every entity mention links; BackLink on all detail routes. The flagship is a Calendar: day tiles wear birthday/festival icons, day detail + collapsed findable groups + page search. Museum and board gained filters. Real wiki-hosted map art (5442×3599, manifested, attributed) layers under the mosaic with per-region crops on place/when; the mosaic remains the no-art fallback. New `/mines` (seal prices, linked) and `/quest/$id`. PWA icon = official logo framed on our card, generated at ship into gitignored output. |
| **G2** | Fruit trees, from `object_prototypes/tree.toml` | Done. Lemon, Peach and Pear were shipping as items with an empty availability: fruit trees are neither in the wiki's Crops table nor in the game's `crop.toml`, they are a third file. Seven trees have a sapling, all seven now have a crop record, and `game:fruit-tree-missing` fails the day an eighth appears. The 46 "extra crops" in `crop.toml` were forageables we already had, and the game agreed with us on the seasons of all 47. |
| **G1** | Game-file extraction — step by step in [game-file-extraction.md](./game-file-extraction.md) | Done. **No id moved**: the game agreed with the v0.15.0 snapshot on all 999 names, so nothing needed migrating. 1,015 of 1,154 ids are `confirmed`; the residual 139 are animal cosmetics, which the game does not model as items at all. Time data was the real prize — hours for all 93 bugs against the wiki's 28, and rooms for 93 of 103 bug windows against 38. |
| **R1** | Ranch — animals, pets, ranching rules from `fiddle/ranching/` + `pets.toml` (v1.3.0) | Done. 8 animals rebuilt from the game files (per-sex produce with frequencies, heart production tiers, prices and sell curves, unlock gates, ~123 colour variants), 16 pets with the three global jobs and per-heart reward tables, a singleton `ranching_rules` record (heart-point economy, festival scoring), `/ranch` + `/animal/$id` + `/pet/$id`, item-page "From the ranch" backlinks, pet icons from the install. The curated animals file survives as the no-extract fallback and for the fields the game does not state. |
| **W1** | Post-1.0 refresh, meaningful map markers, variant swatches, festival pages (v1.4.0) | Done. Wiki re-fetched after the 1.0 catch-up (Items 1,197; +9 records, 0 new unresolved tokens) and the weekly refresh workflow (`refresh.yml`) now actually exists. Map pins are typed from the wiki's own marker groups (building/landmark/water/quest, each with a glyph), the two bridge markers link their repair quests, and hand-placed hollow pins mark Balor's wagon and one dig site per digging area — positions ours, existence derived, both flagged inferred. Every animal and pet colour variant has a sprite: dedicated where the install draws one, otherwise the base icon repainted through the game's own `lut`/`lut_index` palette strips, proven at build time by the white-chicken identity check. Festivals became records with pages: date, place, activities, stall goods from the game's own stock tables, indexed and crawlable. |

PWA (A3) deliberately lands **before** the Today view, so offline plumbing is proven against a small surface. Museum (A5) precedes reverse lookup (A6) because A6's most valuable placement is inside museum missing rows — which turned out to be the item page itself, once A6 was folded into it.

---

## Verification

**Data layer.** `pnpm validate` runs: Zod schema → Ajv against the *emitted* JSON Schema (catches Zod→JSON-Schema translation drift, a real silent failure) → referential integrity across every id reference → vocabulary closure with an empty unresolved queue under `--strict` → the licensing guard → **determinism** (`pnpm build:data && git diff --exit-code data/ docs/`) → coverage vs the counts in `01-game-data.md`, which must not regress → size budget → and the specific asserts: `Items.itemName` unique, every donatable item in exactly one set, every anchor inside its viewBox, `item_ids.length === required_count` per set (note: the Legendary Fish Set has 4, not 5 — `required_count` is per-set data, not a constant).

**Engine.** Vitest table-driven against a frozen ~60-rule fixture, asserting **explicit id sets**, not snapshot counts. A dedicated block for midnight-wrapping windows. Plus a fast-check property test: for 10,000 random instants, every rule returned by `findAvailable` must satisfy its own predicate when re-checked naively, and every rule *not* returned must fail it — ~20 lines, and it catches indexing bugs hand-written cases never will.

**Sync.** fast-check on the three CRDT laws (commutative, associative, idempotent), plus tombstones, clock skew, and 409-retry.

**App.** Playwright on chromium **and webkit** (iOS is where PWAs break), covering four journeys that each prove a headline claim: cold load renders Today correctly for a fixed instant; search → item → "when to get it"; mark a museum item donated → hard reload → still donated *and* Today's gap count decremented; and offline navigation against a real build with a real service worker.

**CI never touches the wiki** — `sources/` is committed, so builds are hermetic, fast, and polite. A separate weekly cron ([.github/workflows/refresh.yml](../.github/workflows/refresh.yml), built at W1) runs the fetchers and opens a PR with the unresolved-token list and coverage report **in the body**. That PR is the curation to-do list, and reviewing the `sources/` diff is how you notice the wiki changed a fact. It's the maintenance engine of the project.

**Manual smoke:** open the deployed app on a phone, install to home screen, enable airplane mode, and answer "it's Fall 12, raining, 4pm — what should I go do?"

---

## Known risks

1. **ID migration vs user progress** — the highest-risk coupling. `former_ids[]` + `id_migrations.json` + the Worker's 426 must exist at D0.
2. **Time data barely exists in Cargo.** `Fish` has no time field; `Bugs.time` is loose text. "Unknown does not exclude" plus honest badging is what keeps the flagship feature from being actively wrong until game files land.
3. **Habitat expansion is an assertion, not a fact.** "Pond" → three ponds may be wrong per fish. Hollow pins and `confidence: "inferred"` keep it honest.
4. **Cargo pagination and list delimiters silently truncate.** GiftPrefs alone is 5,328 rows — page until a short page, assert expected counts, throw on a zero-row response, and read each list field's declared delimiter from `Special:CargoTables` rather than assuming `,`. "Empty response overwrites good data" is the classic pipeline disaster.
5. **Museum sets and NPC schedules are the two large manual-curation costs.** Priority-ordered schedule overrides (first match wins) cut ~9,400 hand-transcribed rows to something finishable; the "exactly one set" assertion turns museum curation into a burn-down list. Ship 12 of 56 schedules and mark the rest as gaps rather than blocking.
6. **`FurnitureTEMP` will be renamed.** Table names live in `curated/vocab/cargo_tables.json` and a zero-row fetch throws.
7. **Main-thread `JSON.parse` stalls.** Multi-MB parses freeze mid-range Android for 200–500ms with no spinner, because React can't paint either. Shard ≤500KB, lazy-load per category, parse search in a Worker.
8. **iOS Safari evicts Cache Storage** after ~7 days for non-installed PWAs. Call `navigator.storage.persist()`, and make a missing data file trigger a re-fetch rather than a white screen.
9. **The licensing risk is human, not technical.** The guard catches accidents, not a paraphrased blurb.
10. **Display names are English-only**, since localisation strings are off-limits. A stated v1 limitation, not a discovered one.

## Open questions to settle at D0

- **Quality tiers.** Gift lists reference "Perfect Ruby" and "Golden Milk" as distinct items. Recommendation: **separate item records with a `base_item_id` link**, since the wiki, gift lists, and museum all treat them as distinct — a `quality_values` map would force a special case into every id reference.
- **Player-state gating.** `requires` should filter against the player's actual skills and perks, which means progress tracking feeds the availability query. Wire that intent at D0 or `requires` is decoration.
- **Multi-save.** One code = one farm. Two farms means two codes. Fine, but say it before someone assumes otherwise.

## CLAUDE.md — session alignment

Written at **D0, before any other code**, because the constraints below are exactly the ones a fresh session will violate by default. Three files, each scoped to where its rules actually bite. Keep them short — a CLAUDE.md that reads like documentation gets skimmed; one that reads like a list of ways to break the project gets followed.

**Root `CLAUDE.md`** — the non-negotiables and the map:

- **The licensing rules, stated bluntly and first.** No game art, no in-game text, no wiki prose. Never fetch `Items.description`. And the one that needs saying explicitly because it's the tempting shortcut: **do not paraphrase an in-game description into a `blurb`** — a paraphrase of a short creative sentence is still derivative, and it looks like compliance while doing the exact thing the rule forbids. Write facts (where, what for, what it's worth) or write `null`.
- **Do not invent data.** An empty field is correct; a plausible guess is a bug that propagates into the dataset and is nearly impossible to find later. If a value isn't in a source, emit `null` and add to `data_gaps[]`. This applies to filling gaps "helpfully" during a refactor.
- **Never use numeric item IDs as keys or foreign keys.** They change between patches. Internal snake_case names are the keys, always.
- **The three data tiers and who owns each** — `sources/` is generated and never hand-edited, `curated/` is hand-authored and never generated, `data/` is generated and never hand-edited. Editing `data/` directly is the single most likely wrong move, since it's committed and looks editable. State that `data/` is a pure function of `sources/ + curated/` and that CI enforces it.
- **Verified API facts** so nobody re-derives them: the `Special:CargoExport` URL form, that fields must be table-qualified, that `action=cargoquery` throws, the table list with expected row counts, and that `Fish` has no season/location/time.
- **Commands** — `pnpm validate`, `build:data`, `build:ship`, `data:unresolved`, `check` — and the rule that `pnpm validate` must pass before any commit touching `data/` or `curated/`.
- **Where things live**, one line per package, so a session doesn't grep the monorepo to find the availability model.

**`curated/CLAUDE.md`** — the curation contract, because this is where hand-authored data and the licensing risk both live:

- The authoring format for each vocab/alias/schedule/museum-set file, with one worked example.
- Availability windows are an OR of ANDs; a second window is correct when an entity is findable two different ways. Don't flatten them.
- `null` vs "not applicable" vs `data_gaps[]` — the distinction the whole honesty model rests on.
- Every override and habitat expansion records a `reason` and a `source`. An inference is marked `confidence: "inferred"`, never left to render as fact.
- Coordinates are SVG user units in the map's `viewBox`. Never pixels. Never change a published `viewBox`.

**`apps/web/CLAUDE.md`** — the frontend traps that are invisible until production:

- Every URL is built from `import.meta.env.BASE_URL`. A leading `/` works in dev and breaks on Pages.
- Runtime code must never contain `if (start > end)` for time windows — midnight splitting happens at build time.
- Render `null` as "unknown" with the unverified treatment. **Never as `0` or an empty list**, both of which read as a confident "none".
- Design tokens come from `styles/tokens.css`. No hardcoded hex, and season accent is a variable, not a literal.
- Locked content is shown tagged `locked`, not hidden — users want to know the Legendary fish exists and why they can't catch it yet.

The existing `.claude/agents/` definitions stay as they are; CLAUDE.md is what gives them shared ground. Revisit it at each review gate — if a session made a mistake these files should have prevented, the fix goes in the file, not just in the code.

## New docs this produces

`docs/design-system.md` (tokens, type scale, component inventory) · `docs/assets-needed.md` (the custom glyphs and map regions that need drawing, since Lucide covers chrome but not game categories) · `docs/data-dictionary.md` · `docs/conflicts.md` · `docs/coverage.md` · `docs/id-divergence.md` · `docs/DATA-POLICY.md`
