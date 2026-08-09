# Contributing

## Setup

```
corepack enable
pnpm install
pnpm check          # biome + tsc + vitest
pnpm build:data     # sources/ + curated/ -> data/
pnpm validate       # everything that must be true about the dataset
```

Node 22+. Read [CLAUDE.md](CLAUDE.md) first — it holds the rules that are
expensive to break.

## The one rule that needs saying out loud

**Do not paraphrase the game's in-game descriptions, and do not paraphrase wiki
prose.** Rewording a short creative sentence still produces a derivative work,
and it does exactly what the licensing rules exist to prevent while passing every
automated check.

If you want to write a `blurb`: read the fact, close the tab, write what a player
needs to know in your own words. If you can't do that without leaning on the
original, leave it `null`. Most records don't need one.

See [docs/DATA-POLICY.md](docs/DATA-POLICY.md).

## Which directory

| I want to... | Edit |
| --- | --- |
| Fix a wrong value from the wiki | `curated/overrides/` |
| Add a location, museum set, or NPC schedule | `curated/` |
| Change what a record looks like | `packages/schema/`, then `pnpm schema:emit` |
| Change how data is fetched or built | `packages/pipeline/` |
| Add or replace a game sprite | `pnpm assets:fetch` — never drop a file in by hand |
| Add a sprite the wiki hosts no file for | `pnpm assets:game`, which needs an owned install. A wiki-hosted sprite always wins |

**Never edit `data/` or `sources/` by hand.** `data/` is regenerated from
`sources/ + curated/` and CI diffs it, so hand edits are silently reverted.
`sources/` is a raw snapshot — editing it makes the build unreproducible.

## Pull request checklist

- [ ] `pnpm check` and `pnpm validate` pass
- [ ] `pnpm e2e` passes, if the change touches the app. It runs against a real
      build and never runs in CI, so this is the only place it gets checked
- [ ] `data/` was regenerated (`pnpm build:data`) rather than hand-edited
- [ ] No in-game text and no wiki prose — see above
- [ ] Any game art is under `assets/game/` and listed in its manifest, nowhere else
- [ ] Any inference is marked `confidence: "inferred"`, not left to read as fact
- [ ] Anything unknown is `null` plus a `data_gaps` entry, never a guess

## Adding a new entity type

One place: `packages/schema/src/registry.ts`. Add the schema and register it, run
`pnpm schema:emit`, then add a builder in `packages/pipeline/src/build/data.ts`.
The registry drives the emitter, the validator, and the ship step, so a
half-registered type is not possible.

## Commit messages

Conventional commits — `feat:`, `fix:`, `docs:`, `chore:`, `data:`. Use `data:`
for anything that changes `data/` or `curated/`, so data changes are easy to find
in the log.
