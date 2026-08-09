# Data provenance and licensing

**Mistria Codex is an unofficial fan project. It is not affiliated with, endorsed
by, or connected to NPC Studio.** Fields of Mistria and all its content are the
property of NPC Studio.

## What this repository contains

Factual data about the game: sell values, growth times, seasons, weather and
time windows, drop rates, museum set membership, gift preferences, and map
coordinates we assigned ourselves. Facts are not copyrightable, and this is a
compilation of them.

## What it deliberately does not contain

- **No in-game text.** No item descriptions, no flavour text, no dialogue, and
  none of the game's localisation strings.
- **No wiki prose.** The Fields of Mistria Wiki is used to verify facts. Its
  sentences are not copied, and they are not paraphrased either — a paraphrase of
  a short creative sentence is still a derivative work.

`pnpm validate` fails the build if either appears. See
[docs/DATA-POLICY.md](docs/DATA-POLICY.md) for how that is enforced and what the
enforcement cannot catch.

## Game art, which it does contain

The game's sprites are in this repository, under attribution, in `assets/game/`
and nowhere else. **Attribution does not create a licence.** These assets are
the sole property of NPC Studio; we claim no ownership. They are used here on
the basis that this is a free, non-commercial fan project of the kind NPC Studio
has been tolerant toward, and they will be removed on request from the rights
holder.

Three constraints make that promise keepable:

- One directory and one register. `assets/game/manifest.json` lists every file;
  an unlisted file fails the build, and so does a listed file that is missing.
- `data/` never names a sprite. Records carry an `icon_key`; the mapping to a
  file lives only in the manifest, so deleting the art orphans nothing.
- Nothing is hotlinked. Every file is served from our own origin.

The whole removal procedure is `git rm -r assets/game && pnpm build:ship`. What
that cannot undo is git history — these files are in it from the commit that
added them, which was accepted knowingly.

Every file, and where it came from, is listed in
[ATTRIBUTION.md](ATTRIBUTION.md).

The stylised vector maps in `curated/maps/` are our own drawings, not traced
from or derived from the game's art. The photographic map art layered beneath
them is wiki-hosted game art and is manifested and credited like every other
sprite.

## Sources

| Source | Used for | Licence |
| --- | --- | --- |
| [Fields of Mistria Wiki (wiki.gg)](https://fieldsofmistria.wiki.gg) | Factual verification via the Cargo API — item values, seasons, locations, gift preferences | Text CC BY-SA 4.0. |
| The same wiki's file pages | Sprites, portraits and UI glyphs, into `assets/game/` | The wiki hosts this art; **NPC Studio owns it.** CC BY-SA covers the wiki's text, not the game's art. |
| The game's own data files | Canonical numeric values, and the sprites the wiki hosts no file for | Read from a legally owned local install. Numbers are ingested; those sprites are manifested and credited as `game files`. No localisation strings, no audio. |
| [AnnaNomoly/legacy-fields-of-mistria-mods](https://github.com/AnnaNomoly/legacy-fields-of-mistria-mods) | Cross-checking internal item names (archived, v0.15.0) | A factual ID-to-name mapping. Derived from, not copied. |
| `curated/` | Locations, museum sets, NPC schedules, maps | Written by this project's contributors. MIT. |

We attribute the Fields of Mistria Wiki because it costs nothing and is the
decent thing to do, not because facts require attribution.

## Licence of the data in this repository

The compiled data in `data/` and the generated bundle are released under
[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) to the extent that
any rights subsist in the compilation. That waiver applies to our compilation
work only — it cannot and does not grant rights in the underlying game.

## If you are NPC Studio

If anything here oversteps, open an issue or contact the maintainers and it will
be removed promptly. The intent is to help people enjoy the game, nothing else.
