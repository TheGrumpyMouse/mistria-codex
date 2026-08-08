# curated/ — the hand-authored tier

This directory is written by people and never by a script. Everything here is an
input to `pnpm build:data`; nothing here is generated.

It is also where the licensing risk actually lives. `sources/` is machine output
and `data/` is derived, so the only place a human can type a sentence into this
project is here.

## The three tiers, so you're in the right one

| | Written by | Never |
| --- | --- | --- |
| `sources/` | `enrich`/`extract` scripts | hand-edited |
| **`curated/`** | **you** | **generated** |
| `data/` | `build:data` | hand-edited |

If you are about to edit `data/`, stop — change the input here instead. `data/`
is regenerated and CI diffs it, so your edit will be silently reverted.

## What goes where

```
vocab/         controlled vocabularies, and what each enricher reads — locations,
               museum wings, cargo tables, skills, calendar, wiki endpoint,
               ui_assets (the game images that are not any one record's icon)
entities/      whole records we author by hand, for things no source exposes
               in a machine-readable form (mine biomes)
aliases/       display name -> id mappings, and habitat expansion policy
overrides/     per-record field overrides, each with a reason and a source
schedules/     one file per character
blurbs/        our own factual prose, per category
maps/          SVG maps we drew ourselves
```

`entities/` is the escape hatch, not the default. Reach for it only when the
wiki holds the fact but not in a form a parser can reach — the mine biome pages
are almost entirely `{{BiomesQuick|1|floors no}}` template calls, so extracting
five floor ranges would mean implementing MediaWiki's parser functions. When you
use it, every field says where it came from, in the file.

## Rules

### Availability is an OR of ANDs

Each window is an AND of its constraints; the array is an OR of windows. **When a
thing is obtainable two different ways, that is two windows.** A bug found in
town in spring at night *and* in the mines year-round at any time cannot be one
window — flattening them produces a record that claims the bug is in the mines
only at night, which is wrong on the app's main screen.

```jsonc
"availability": [
  { "method": "bug_net", "habitats": ["overworld"], "seasons": ["spring"],
    "weather": ["clear","wind"], "weather_precision": "exact",
    "time": [{ "from": "20:00", "to": "02:00" }], "time_precision": "block",
    "confidence": "wiki", "prov": "wiki_cargo" },
  { "method": "bug_net", "habitats": ["cave"], "locations": ["mine_upper"],
    "seasons": ["spring","summer","fall","winter"],
    "weather": null, "weather_precision": "not_applicable",
    "time": null, "time_precision": "not_applicable",
    "confidence": "wiki", "prov": "wiki_cargo" }
]
```

Note the second window: `weather: null` because mines have no weather. That is
**not applicable**, not unknown.

### `null` means two different things — pick the right one

- **Not applicable** → `weather: null` with `weather_precision: "not_applicable"`.
  There is no weather in a cave. The answer is not missing; there is no question.
- **Unknown** → leave the field as best you have it and add the field name to
  the record's `data_gaps`. Something else will fill it in later.

Getting this wrong is how the app ends up confidently telling someone a fish is
available in weather that doesn't exist.

### Never invent a value

An empty field is correct. A plausible guess is a bug that propagates into the
dataset and is nearly impossible to find later, because it looks exactly like
real data.

If the wiki doesn't say and the game files aren't available: `null` plus a
`data_gaps` entry. That is a complete, correct answer.

### Seasons and weather are fully expanded

Write all four seasons, not `"all"`. The matcher is a set intersection and has no
special cases; that is deliberate.

### Mark inferences as inferences

Expanding "Pond" into three concrete ponds is an assertion, not a fact — the wiki
did not say *which* pond. Set `confidence: "inferred"` so the app draws those
pins hollow. **An inference must never render identically to a fact.**

Every entry in `overrides/` and every habitat expansion carries a `reason` and a
`source`. Six months from now, "why is this value here" needs an answer.

### Coordinates are SVG user units

All coordinates live in the owning map's `viewBox` space. **Never pixels.**
Validation asserts every anchor falls inside its map.

Never change a published map's `viewBox` — only extend it, and bump `map_version`
when you do. Redrawing a region otherwise relocates every pin on it silently.

### Never put a game image here

`curated/maps/` holds SVGs **we drew**. Game art lives in `assets/game/`, is
fetched by `pnpm assets:fetch`, and is listed in one manifest — never dropped in
by hand, never copied into `curated/`. `pnpm validate` fails on both.

`vocab/ui_assets.json` is the one curated file that touches the subject, and it
holds **filenames, not images**: a name read out of committed wikitext, so the
fetcher knows what to ask for. A name that turns out not to exist fails the
fetch loudly rather than becoming a missing icon nobody notices.

### Prose

Read [docs/DATA-POLICY.md](../docs/DATA-POLICY.md) before writing a `blurb`.

Short version: write facts in your own words, or write `null`. Do not paraphrase
the in-game description — that produces a derivative work while looking like
compliance, and no automated check will ever catch it.

## Before you commit

```
pnpm build:data && pnpm validate
```

`validate` writes `build/reports/coverage.md`, which is your burn-down list.
