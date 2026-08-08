# Mistria Codex

A companion app for [Fields of Mistria](https://www.fieldsofmistria.com/), for
the question you actually have mid-game:

> It's Fall 12, Year 2. It's raining, it's 4pm. What can I catch, what can I
> forage, whose birthday is it — and which of those does the museum still want?

Today that takes four wiki tabs. This answers it on one screen.

Installable, works offline, no account. Progress is stored on your device, with a
code you can type into a second device to bring it along.

**Unofficial fan project. Not affiliated with NPC Studio.**

## Status

Early. The data layer was built first, because the data *is* the product —
getting it wrong poisons everything downstream. `pnpm validate` writes
`build/reports/coverage.md`, which is the honest account of what has actually
been ingested and what is still missing.

## Repository layout

```
packages/schema/     Zod contracts. The availability model lives here.
packages/pipeline/   extract / enrich / normalise / build / validate
packages/sync-client/ the CRDT merge, shared by the app and the Worker
apps/web/            the PWA
workers/sync/        progress sync

sources/             raw snapshots      — generated, committed, never hand-edited
curated/             human knowledge    — hand-authored, never generated
data/                the database       — generated, committed, never hand-edited
```

`data/` is a pure deterministic function of `sources/ + curated/`; CI regenerates
it and diffs. That is what makes a committed, generated directory trustworthy.

## Commands

```
pnpm check            biome + tsc + vitest
pnpm build:data       sources + curated -> data/
pnpm build:ship       data/ -> the bundle the app fetches
pnpm validate         schema, references, licensing, coverage
```

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
