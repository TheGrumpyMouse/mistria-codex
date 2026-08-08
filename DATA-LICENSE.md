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

- **No game art.** No sprites, icons, screenshots, tilesets, or maps from the
  game. The maps in `curated/maps/` are stylised vector drawings we made; they
  are not traced from or derived from the game's art.
- **No in-game text.** No item descriptions, no flavour text, no dialogue, and
  none of the game's localisation strings.
- **No wiki prose.** The Fields of Mistria Wiki is used to verify facts. Its
  sentences are not copied, and they are not paraphrased either — a paraphrase of
  a short creative sentence is still a derivative work.

`pnpm validate` fails the build if any of these appear. See
[docs/DATA-POLICY.md](docs/DATA-POLICY.md) for how that is enforced and what the
enforcement cannot catch.

## Sources

| Source | Used for | Licence |
| --- | --- | --- |
| [Fields of Mistria Wiki (wiki.gg)](https://fieldsofmistria.wiki.gg) | Factual verification via the Cargo API — item values, seasons, locations, gift preferences | Text CC BY-SA 4.0. **Images are proprietary and are not used.** |
| The game's own data files | Canonical numeric values, once ingested | Read from a legally owned local install. Never redistributed. |
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
