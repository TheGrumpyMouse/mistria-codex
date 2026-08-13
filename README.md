# Mistria Codex

[![Release](https://img.shields.io/github/v/release/TheGrumpyMouse/mistria-codex?label=release)](https://github.com/TheGrumpyMouse/mistria-codex/releases)

A companion app for [Fields of Mistria](https://www.fieldsofmistria.com/), for
the question you actually have mid-game:

> It's Fall 12, Year 2. It's raining, it's 4pm. What can I catch, what can I
> forage, whose birthday is it — and which of those does the museum still want?

Today that takes four wiki tabs. This answers it on one screen.

**→ [thegrumpymouse.github.io/mistria-codex](https://thegrumpymouse.github.io/mistria-codex/)**

Installable, works offline, no account. Progress is stored on your device, with a
code you can type into a second device to bring it along.

**Unofficial fan project. Not affiliated with NPC Studio.**

## What's in it

- **Calendar** — pick a day, weather and time; see everything findable, grouped,
  with birthdays and festivals notched into the day tiles.
- **Museum** — all 82 sets across four wings, with donation ticks that survive a
  reload and tell you where to get what is still missing.
- **Map** — the valley, filterable by season and weather, with what each region
  yields.
- **Ranch** — the eight animals and sixteen pets: per-sex produce, heart
  tiers, colour variants with their sprites, breeding, festival scoring, and
  what each pet's jobs pay.
- **Items, villagers, places, monsters, quests, animals, pets, festivals** — a
  page each, cross-linked: where it comes from, what it is worth, who wants it
  as a gift, what it goes into, and which shop or stall sells it at what price.
- **Request board**, **bestiary** and **mines** alongside.

Shipped in `data/` but not yet on a screen of their own: skills and perks,
crops, buildings. They surface where something else references them — a skill
level gating a tool, a perk gating a shop line — but there is no page for them
yet.

## Status

Usable, and honest about what it does not know. Every dataset with a known
target count is fully ingested — 2,558 items, 143 fish, 93 bugs, 110 artifacts,
359 quests, 82 museum sets — and 3,169 of the 3,201 records that ask for a
sprite have one.

The data layer was built first, because the data *is* the product: getting it
wrong poisons everything downstream. `pnpm validate` writes
`build/reports/coverage.md`, which is the standing account of what has actually
been ingested and what is still missing. The largest remaining hole is time of
day — 106 of 1,302 availability windows have no time recorded, and the app says
so rather than guessing.

Outstanding: sync needs a Cloudflare deploy (the code is written and tested;
unset, the app builds with sync off and says so — see
[workers/sync/README.md](workers/sync/README.md)), and a Lighthouse pass.

## Repository layout

```
packages/schema/      Zod contracts. The availability model lives here.
packages/pipeline/    extract / enrich / normalise / build / validate
packages/sync-client/ the CRDT merge, shared by the app and the Worker
apps/web/             the PWA
workers/sync/         progress sync

sources/              raw snapshots      — generated, committed, never hand-edited
curated/              human knowledge    — hand-authored, never generated
data/                 the database       — generated, committed, never hand-edited
assets/game/          game sprites       — generated, committed, and the only place they live
```

`data/` is a pure deterministic function of `sources/ + curated/`; CI regenerates
it and diffs. That is what makes a committed, generated directory trustworthy.

`assets/game/` being the *only* place art lives is what makes
`git rm -r assets/game` a complete removal rather than the start of a search.
Nothing in `data/` names a file in it.

## Commands

```
pnpm dev              the app, on localhost
pnpm check            biome + tsc + vitest
pnpm validate         schema, references, licensing, determinism, coverage
pnpm build:data       sources + curated -> data/
pnpm build:ship       data/ -> the bundle the app fetches
pnpm build:web        production build (BASE_PATH sets the Pages base path)
pnpm e2e              Playwright over the built app — the local gate for UI changes
```

Building the web app needs the base path GitHub Pages serves from:

```sh
pnpm build:ship
BASE_PATH=/mistria-codex/ pnpm build:web
```

On Windows, Git Bash rewrites that leading slash into a Windows path — set
`MSYS_NO_PATHCONV=1` with it, or use PowerShell's `$env:BASE_PATH`.

## Releases

The version lives in exactly one place — `version` in the root `package.json` —
and the build compiles it into the app, where Settings and About both show it.
Cutting a release takes nothing: every push to `main` checks whether the
current version has a GitHub Release yet, and `.github/workflows/release.yml`
creates one (tag included) if not. The bump rides the change set it describes,
so landing it on `main` is the release signal — the same signal Pages deploys
on, though the two stay independent: a release marks a version, a deploy ships
one.

Tagging by hand still works and is validated the same way:

```sh
git tag v1.0.0 && git push --tags
```

The workflow refuses a tag that disagrees with the tagged commit's
`package.json`, and skips any version already released, so the manual and
automatic paths cannot double-publish or drift.

These talk to the wiki or to a local game install and **never run in CI**, which
is what keeps builds hermetic and polite to wiki.gg. `sources/` and
`assets/game/` are committed, so a clone needs none of them:

```
pnpm enrich:cargo     fetch Cargo tables  -> sources/wiki/
pnpm enrich:pages     fetch wiki pages    -> sources/wiki/
pnpm extract          read a game install -> sources/game/    (needs .env)
pnpm assets:fetch     fetch sprites       -> assets/game/
pnpm assets:game      sprites the wiki does not host, from the install
```

Refreshing from the wiki is a deliberate, reviewed act: run the fetch locally,
then commit the `sources/` diff like any other change.

## Data and licensing

Code is MIT. The data is a compilation of facts — values, seasons, drop rates,
coordinates — and carries no in-game text and no wiki prose. The build fails if
either appears.

**This project is free and non-commercial.** No ads, no analytics, no tracking,
no payments, no donation prompts, no account. Nothing leaves your device unless
you type in a sync code.

Game sprites live in `assets/game/`, under attribution. They are the sole
property of NPC Studio and we claim no ownership of them; see
[ATTRIBUTION.md](ATTRIBUTION.md) for every file and where it came from.

See [DATA-LICENSE.md](DATA-LICENSE.md) for what the compilation is licensed
under. The asset policy and the one-command removal procedure live in
`docs/DATA-POLICY.md`, which is a maintainer document and is not published.

Facts verified against the [Fields of Mistria Wiki](https://fieldsofmistria.wiki.gg),
with thanks.

## Contributing

[CONTRIBUTING.md](CONTRIBUTING.md). If you are an AI agent working in this repo,
read [CLAUDE.md](CLAUDE.md) first.
