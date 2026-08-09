# Data policy

Why `pnpm validate` fails on things that look harmless, and what it cannot catch.

## The rule

Facts are fine. Prose is not.

**Fine:** sell value 45, growth time 14 days, seasons `["fall"]`, weather
`["rain","storm"]`, museum set `fall_crop`, pin at `(340, 210)`, "Adeline loves
Coffee".

**Not fine:** the item's in-game description, its flavour text, any localisation
string, any sentence copied from the wiki, and any sentence rewritten *from* one
of those.

## Four layers of enforcement

**1. Never fetch it.** The Cargo fetcher's `fields=` parameter does not include
`Items.description`. Not requesting the data is a stronger guarantee than
requesting it and stripping it afterwards, and it is the only layer that is
airtight. Every other layer exists because there are other ways in.

**2. `writeJson()` throws.** Any key matching the prose denylist —
`description`, `desc`, `flavor_text`, `flavour_text`, `text`, `localization`,
`localisation`, `tooltip`, `summary_text` — at any depth, fails the write. This
catches game-file extraction, which has no equivalent of layer 1.

**3. `pnpm validate` scans what it did not write.** It walks every JSON file in
`data/` and `curated/` for denylisted keys, and for any string over 200
characters outside the allowlist (`blurb`, `notes`, `note`, `reason`). The length
rule exists because **long strings are the signature of copied prose** — factual
fields are short by nature, so a 400-character value is nearly always someone
pasting a paragraph.

It also fails if an image file appears anywhere outside `apps/web/src/assets`,
`apps/web/public/icons`, `curated/maps`, or `docs/assets`.

**4. Nothing.** There is no layer four. See below.

## What none of this catches

**A `blurb` that paraphrases the in-game description.** The denylist sees a
sanctioned field name. The length check sees a short string. The build passes.
And the repository now contains a derivative work of NPC Studio's writing,
introduced by a process that looked like compliance.

This is the most tempting shortcut in the project, because it is *so easy*: the
description is right there, it says the thing, and rewording it takes seconds.
Don't. If you want a blurb, write what a player needs — where it's found, what
it's used for, what it sells for. If you can't say something useful without
leaning on the original, leave it `null`. Most items don't need one.

**The same applies to wiki prose.** Read the wiki, learn the fact, close the tab,
write the fact. Do not have both windows open.

## Icons and art

The game's sprites are in this repository, under attribution. This section is
the whole policy, because it is the part most likely to be misread.

**Be clear-eyed about what this is.** These assets belong to NPC Studio.
Attribution does not create a licence. We rely on this being a free,
non-commercial fan project of the kind NPC Studio has been tolerant toward —
they publish a modding SDK and support the community wiki. Three design goals
follow, and every rule below serves one of them:

1. **Never claim or imply ownership.** Attribution is visible, permanent and
   explicit — a footer on every route, an About page, and `ATTRIBUTION.md`.
2. **Stay unambiguously non-commercial.** Nothing in the architecture that
   monetises, now or accidentally later.
3. **Be takedown-ready.** One directory, one manifest, one deletion.

### The rules

- Art lives in **`assets/game/` and nowhere else.** Not in `apps/`, not in
  `curated/`, not base64'd into a JSON file.
- **`assets/game/manifest.json` is the register.** A file not in it fails the
  build; a manifest entry with no file fails the build. Both directions, because
  either drift makes the register a lie.
- **`data/` never references a sprite.** Records still carry only an `icon_key`.
  The `icon_key` → asset mapping lives in the manifest, so deleting `assets/`
  orphans nothing and breaks no schema.
- **Never hotlink.** Everything is served from our own origin. Hotlinking is both
  redistribution and freeloading on someone else's bandwidth.
- **Fetched wiki-first** — the wiki.gg file pages — so anyone cloning this repo
  can reproduce most of the asset set without owning the game files.
  `assets:fetch` never reads `MISTRIA_GAME_DIR`. One narrow exception, by owner
  decision (2026-08-08): art the wiki hosts **no file for** — the 1.0 furniture
  set, allowlisted 1.0 items, the in-water fish silhouettes — may be copied
  from an owned install by `assets:game` — since 2026-08-09 also the 30 wardrobe
  pieces the wiki's cosmetics pages never listed. Those entries are marked
  `origin: "game_files"` in the manifest and credited as such in
  ATTRIBUTION.md; a wiki-hosted sprite always wins, and a clone without a game
  install keeps drawn glyphs for exactly those records. The takedown story is
  unchanged in every particular.

  **"The wiki always wins" is enforced, not just intended.** When the wiki gains
  art for something the install had been covering, `assets:game` drops the entry
  *and deletes the file* — it did not, once, and eighteen unmanifested sprites
  sat on disk until the licensing check caught them. An unmanifested file is art
  nothing credits and a takedown would miss, so the prune is part of the policy
  rather than housekeeping. It only ever removes files it created
  (`origin: "game_files"`, named by the previous run).
- **A record with no sprite is normal.** The app falls back to a glyph it draws
  itself. That path is not legacy code; it is the answer for everything the wiki
  has no image for.

### Takedown

```
git rm -r assets/game && pnpm build:ship
```

That is the entire procedure, and keeping it true is a hard constraint. If a
change would mean hunting sprites down in three places, the change is wrong.

**What it does not undo:** these files are in the public git history from the
commit that added them. Removing them from `main` does not remove them from
history without a rewrite. That was accepted knowingly when the directory was
committed rather than fetched at deploy time — the trade bought hermetic CI and
a build that works from a clean clone, at the cost of a permanent history entry.

### What is still absolutely forbidden

The art rule changed. **The text rules did not.** No `Items.description`, no
localisation strings, no wiki prose, no paraphrase of either. Sprites coming in
does not soften anything above this section.

## Where the data comes from

| Source | What we take | What we never take |
| --- | --- | --- |
| [Fields of Mistria Wiki](https://fieldsofmistria.wiki.gg) (wiki.gg, CC BY-SA) | Facts: prices, seasons, drop rates, floor ranges, schedules, which pond. Verified, then written in our own words and our own shapes. | Prose, `Items.description`. Page wikitext is never committed. |
| The same wiki's file pages, via `Special:FilePath` | Sprites, portraits and UI glyphs, into `assets/game/` under the policy above. The wiki hosts them; **NPC Studio owns them**, and CC BY-SA covers the wiki's text, not the game's art. | Anything not in the manifest. |
| [AnnaNomoly, `legacy-fields-of-mistria-mods`](https://github.com/AnnaNomoly/legacy-fields-of-mistria-mods) — the DigUpAnything README | The item id table: numeric id, internal name, display name, at v0.15.0. An identifier mapping, derived into our own alias index. | Nothing else from the repository. |
| The game files, at milestone G1 | Numbers and identifiers, on a machine that has the game. `MISTRIA_GAME_DIR` is configurable and never committed. Since 2026-08-08, also the sprites the wiki hosts no file for, via `assets:game` — manifested, marked and credited like every other piece of art. | Localisation strings, audio, any sprite the wiki already hosts. |

Every source is credited in the app. This is an unofficial fan project and says
so; Fields of Mistria belongs to NPC Studio.

**Internal names are identifiers, not text.** `ore_copper` is a key the game and
the community both use to refer to the same thing, in the same way a file path
is. Adopting them is interoperability, and it is why user progress saved here
will still mean something when the game files land.

### Which source wins

**The more specific source wins. Where both are equally specific, the game files
win. A disagreement is reported, never resolved silently.**

Two sources describe most of this dataset and they overlap on about two thousand
facts. The rule is about specificity rather than provenance, because a flat
"game first" breaks two things that are currently right:

- The wiki prices 334 of 360 cosmetics that the files never price. Absence in
  the primary source is not an answer.
- A wiki **per-shop** price beats the item's **global** `value.store`. The Inn
  sells the Lemon Pie at 650 and its recipe scroll at 400; one global number
  cannot be both, and the narrower source is the correct one.

**A boolean derived from a rich source is a bug, not a fallback.** The wiki's
`Recipes.recipeSource` cell names a stall, a mine, a request or "Available From
Start". It was read as *is this cell non-empty*, and that shipped 163 recipes
all claiming "shop" for five milestones while looking like working code. If a
source says more than the field being filled, model the rest or write `null` —
never compress it into a value that reads as an answer.

`pnpm validate` writes a precedence table into
`build/reports/source-agreement.md`: per field, how many records both sources
state, and which one ships. A field marked wiki-first with no stated reason
raises `sources:precedence`.

## If you think a rule is wrong

Open an issue. Don't work around it in a pull request — a bypassed guard is
worse than no guard, because everyone downstream assumes it held.
