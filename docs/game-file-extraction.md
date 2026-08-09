# Extracting the game files (milestone G1)

Step-by-step, for the machine that has Fields of Mistria installed.

Everything in this repository so far was read off a community wiki. The wiki is
good and this project would not exist without it, but it is a description of the
game written by people playing it. The game's own files are the game. This
milestone replaces guesses with the source.

**You do not need to do this for the app to work.** It already runs on wiki data,
and `sources/game/` is committed, so a clone builds the extracted dataset without
owning the game. Re-run this only to pick up a new patch.

---

## What it found, the first time it ran

Written after the fact, because the answer is the useful part.

**No id moved.** All 999 names the v0.15.0 snapshot supplied are still the names
the installed build uses. The migration machinery — `former_ids`,
`id_migrations.json`, the Worker's 426 — was never needed, which is the outcome
you want from insurance. What changed is confidence: 1,015 of 1,154 item ids are
now `confirmed` rather than `confirmed_stale`.

The residual 139 are mostly **not** a gap. Animal cosmetics are items on the wiki
and are not items in the game: they live in `ranching/animals/*.toml` under a
`[cosmetics.*]` key, outside the `ItemId` enum entirely. Nothing in the game will
ever confirm them.

**The time data was the real prize.** The game states hours for all 93 bugs; the
wiki had usable time for 28. And a bug's `tag` matches a room's `bug_tag`, which
is the only source anywhere for *where* an insect can be caught — 38 of 103 bug
windows had a location before, 93 have one now.

**The museum agreed exactly.** 82 sets, 409 items, hand-transcribed from wing
pages long before the files were available. `pnpm validate` now asserts it.

---

## What this fixes

**Item ids.** Every record here is keyed by an internal snake_case name —
`ore_copper`, not `copper_ore`. A v0.15.0 community snapshot gave us most of
them, and **192 of 999 differed from the naive slug**, which is the measure of
how undetectable this error class is: an id that looks fine, resolves fine, and
is wrong. See [id-divergence.md](./id-divergence.md). The game files settle the
rest, and they settle them for the *current* version rather than for v0.15.0.

**Time of day.** The wiki has almost none. 801 of 832 availability rules have no
recorded time, which is why the Today screen badges so many results "any time".
The game knows.

**Fish and forage spawn conditions**, museum set groupings, NPC schedules, shop
stock rotation, and drop rates that the wiki records loosely or not at all.

**What it does not fix:** nothing about the app's structure changes. `former_ids`
has been on every record since the first commit precisely so this migration is a
rename rather than a data loss.

---

## Before you start

**Do not modify the game.** Everything here is read-only: copy files out, never
write files in. Steam will happily re-download a game you have broken, but a
corrupted install mid-playthrough is a bad afternoon.

**Back up your saves first** if you play on this machine.

| Platform | Saves |
| --- | --- |
| Windows | `%LOCALAPPDATA%\FieldsOfMistria\` |
| macOS | `~/Library/Application Support/FieldsOfMistria/` |
| Linux | `~/.local/share/FieldsOfMistria/` |

**The licensing rules do not relax here.** They get *stricter*, because the game
files contain the one thing this project has never taken:

> **Never extract or commit `assets/etc/localisation` or any localisation
> strings.** They are the game's writing — every item description, every line of
> dialogue. Taking identifiers is interoperability; taking the text is copying
> the book. See [DATA-POLICY.md](./DATA-POLICY.md).

Sprites are already handled: they come from the community wiki under
attribution, in `assets/game/`. **Do not re-source them from your install** —
that would make the asset set unreproducible for anyone who clones this repo
without owning the game.

---

## Step 1 — find the install

Right-click Fields of Mistria in your Steam library → **Manage** → **Browse
local files**. That opens the folder.

Defaults, if you would rather type it:

| Platform | Path |
| --- | --- |
| Windows | `C:\Program Files (x86)\Steam\steamapps\common\Fields of Mistria` |
| macOS | `~/Library/Application Support/Steam/steamapps/common/Fields of Mistria` |
| Linux | `~/.steam/steam/steamapps/common/Fields of Mistria` |

You should see the executable (`FieldsOfMistria.exe` on Windows) and an
`assets.zip`.

---

## Step 2 — unpack the assets

Since v0.16 the game ships its data in **`assets.zip`**. Copy it somewhere
scratch and unpack it there — not in place.

```pwsh
# Windows PowerShell. Adjust the source path to your install.
$game = "C:\Program Files (x86)\Steam\steamapps\common\Fields of Mistria"
$work = "$env:USERPROFILE\mistria-extract"

New-Item -ItemType Directory -Force $work | Out-Null
Copy-Item "$game\assets.zip" $work
Expand-Archive "$work\assets.zip" -DestinationPath "$work\assets"
```

```sh
# macOS / Linux
GAME="$HOME/.steam/steam/steamapps/common/Fields of Mistria"
WORK="$HOME/mistria-extract"

mkdir -p "$WORK"
cp "$GAME/assets.zip" "$WORK"
unzip -q "$WORK/assets.zip" -d "$WORK/assets"
```

If there is no `assets.zip`, you are on a pre-0.16 build and the folders below
sit loose in the install directory instead. Everything else still applies.

---

## Step 3 — know what you are looking at

The game's data is **TOML**, which is why `smol-toml` has been a dependency of
this repo since D0 for exactly this day.

| Path | What it holds | We want |
| --- | --- | --- |
| `assets/fiddle/items/` | Every item, split across files | **Yes — the priority** |
| `assets/fiddle/object_prototypes/` | Furniture, crops, trees, buildings | Yes |
| `assets/etc/magic_enums.meta.toml` | Which enums get generated ids | Read once, see below |
| `assets/etc/localisation*` | The game's writing | **Never** |
| `assets/**/*.meta.toml` | Asset descriptors (sprites, audio, fonts) | No |

Items look like this — a TOML table per item, keyed by **the internal
snake_case name**, which is exactly the key this whole dataset uses:

```toml
[golden_plant]
    # properties
```

> Names are the identity. From the SDK: *"All names should be a snake_case
> string. This name will be used in serialization."*

### The one thing to read before anything else

`assets/etc/magic_enums.meta.toml` and the SDK's `magic-enums.md` explain that
an item's **numeric** id is an enum ordinal *assigned at compile time* from
declaration order. Insert an item and every id after it shifts.

That is the direct source for this project's hard rule 3 — **never use numeric
ids as keys or foreign keys**. `numeric_id` is a nullable, version-stamped
secondary field and nothing references it. When you extract, stamp
`numeric_id_game_version` with the build you took them from, and keep treating
the name as the key.

---

## Step 4 — point the pipeline at it

The extractor reads one environment variable and **the path is never
committed** — it is different on every machine and is nobody else's business.

```sh
# .env at the repo root — already gitignored
MISTRIA_GAME_DIR="C:/Users/you/mistria-extract/assets"
MISTRIA_GAME_VERSION="1.0.0"
```

Use the unpacked `assets` folder, not the install and not the zip. `pnpm extract`
never writes to it and never reads outside it.

---

## Step 5 — run the extraction

```sh
pnpm extract          # assets -> sources/game/
pnpm build:data       # sources + curated -> data/
pnpm validate         # everything that must be true
```

`extract` writes three files into `sources/game/`, which is tier one:
**generated, committed, never hand-edited**, exactly like `sources/wiki/`. It is
committed so CI stays hermetic and so nobody else needs the game to build this
project.

| File | From | Holds |
| --- | --- | --- |
| `items.json` | `fiddle/items/**` | 2,665 items: id, name, tags, values, recipes |
| `spawns.json` | `fish.toml`, `bugs.toml`, `forageables.toml`, `crop.toml` | when and where things appear |
| `world.json` | `museum_wings/`, `npcs/`, `locations.toml` | sets, birthdays, gift lists, rooms |

**No `description`, ever.** The extractor builds each record from an explicit
allowlist rather than copying a table, so a new game field cannot arrive by
default. `writeJson()`'s denylist is the backstop, not the control.

---

## Step 6 — the ids reconcile themselves

There is no separate reconcile step, and an earlier draft of this document was
wrong to promise one. `build:data` reads `sources/game/items.json` through
`build/game-facts.ts`, and `ctx.idFor` prefers the game's name over the v0.15.0
snapshot's over a slug. One index, one build, no second pass to forget to run.

What the build does with it:

1. An id the game names becomes `id_status: "confirmed"` and carries
   `game_version`.
2. Where the id differs from `toSnakeId(displayName)`, the slug goes in
   `former_ids`. That is what makes a name change a rename rather than a data
   loss — the client migrates saved museum progress through it.
3. `pnpm validate` regenerates `docs/id-divergence.md`, the register of what
   moved.

```sh
pnpm validate                          # refint catches any dangling reference
git diff --stat data/                  # every changed record
cat docs/id-divergence.md              # the register
```

**Do not hand-edit `data/`.** It is a pure function of `sources/ + curated/` and
CI regenerates it and diffs. If a record is wrong, its input is wrong.

### Two things the build needs a human for

Both live in `curated/`, because both are judgements rather than readings:

- **`curated/aliases/game_rooms.json`** — which of our 29 locations each of the
  game's 86 rooms is. Only the bug-spawning rooms are mapped; an unlisted room
  is unmapped, not overlooked, and `validate` names any that appear.
- **`curated/vocab/weather.json`** — the game has four weather *classes*, not six
  states, and the season decides what each looks like. Three map without
  argument; `special` is reasoned, and the reasoning is in the file.

---

## Step 7 — verify before committing

```
pnpm check                             # biome, tsc, tests
pnpm validate                          # schema, refint, licensing, coverage
pnpm build:data && git diff --exit-code data/           # determinism
```

Four things to look at by eye:

- **`docs/id-divergence.md`** — does the count of moved ids look sane? A handful
  is expected. Nine hundred means the join went wrong, not that the game renamed
  everything.
- **`docs/coverage.md`** — the "Availability windows" table. Time stated and
  windows sourced from the game should both be non-zero; if they are not, the
  extractor read the wrong folder.
- **The `game:` warnings from `validate`** — museum set counts, unmapped rooms,
  unconfirmed ids. These are the diff between what the wiki said and what the
  game says, and they are warnings rather than errors on purpose: a disagreement
  needs a human, not a failed build.
- **The licensing check** — it fails on any string over 200 characters outside
  the allowlist, which is the tripwire for a description having come along for
  the ride. If it fires, do not add the field to the allowlist. Stop taking it.

Then, the real test — **a pre-migration progress blob must load post-migration
with zero lost entries.** Check an item in the museum before, run the migration,
reload, confirm it is still checked. (On the first run no id moved, so there was
nothing to migrate. Do it anyway the next time one does.)

---

## What to do when it goes wrong

**`pnpm extract` finds no items.** Check `MISTRIA_GAME_DIR` points at the folder
*containing* `fiddle/`, not at the install root and not at the zip.

**TOML parse errors.** Note the file and open it. The game uses TOML features
freely; if `smol-toml` chokes on something real, fix the parser rather than
skipping the file — a silently skipped file is a whole category quietly missing.

**Ids moved that you did not expect.** Read `docs/id-divergence.md` before
committing. The point of that file is that a surprise is visible.

**More than a handful of unresolved tokens.** `pnpm data:unresolved` prints the
queue. The build fails on an unrecognised token under `--strict` **by design** —
that is the guard working, not an obstacle to route around.

---

## Sources

The facts in this document come from NPC Studio's own modding SDK, which is the
authority on these formats:

- [NPC-Studio/mistria-sdk](https://github.com/NPC-Studio/mistria-sdk) — `create-objects-items.md`
  for `fiddle/items` and the snake_case naming, `meta-files.md` for `.meta.toml`,
  `asset-properties/magic-enums.md` for compile-time numeric ids, `vaultc.md` for
  save files, `cli.md` for running the game with logging.

`vaultc` (bundled in the SDK under `tools/windows` and `tools/linux`) unpacks
`.sav` files. **This project does not need it** — we read the game's data, not
anyone's save — but it is the tool to reach for if you ever want to verify what
the game actually recorded for a playthrough.
