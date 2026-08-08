# sources/ — raw snapshots

Machine output. **Generated, committed, never hand-edited.**

Everything here is exactly what a source gave us, before any normalisation. It is
committed on purpose, for three reasons:

1. **Builds are reproducible.** `data/` can be regenerated from a known input
   rather than from whatever the wiki happens to say today.
2. **CI never touches the wiki.** Builds are hermetic and fast, and we don't
   hammer wiki.gg on every push.
3. **The diff is the maintenance signal.** When the weekly refresh opens a pull
   request, the `sources/` diff is how you notice the wiki changed a fact.

```
wiki/cargo/       Cargo table exports, one file per table
wiki/pages/       page-level extracts for data Cargo doesn't hold
community/        the AnnaNomoly v0.15.0 id table, parsed
game/items.json   every item the game declares — id, name, tags, values, recipes
game/spawns.json  fish, bugs, forageables and crops: when and where
game/world.json   museum wings, villagers, rooms
```

Refresh the wiki half with `pnpm enrich:cargo` and `pnpm enrich:pages`; the game
half with `pnpm extract`, which needs a `.env` pointing at an install and is
documented in [docs/game-file-extraction.md](../docs/game-file-extraction.md).

`game/` is committed for the same three reasons as everything else here, and one
more: **it means nobody needs to own the game to build this project.** Only a
machine with an install can regenerate it, so if it were gitignored the dataset
would silently degrade for every other clone.

**No prose comes out of the game files.** The extractor takes ids, names and
numbers from an explicit allowlist; `description`, `bio`, set descriptions and
everything under `localization/` are never read. See
[docs/DATA-POLICY.md](../docs/DATA-POLICY.md).

Editing a value here is never the right fix — put a correction in
`curated/overrides/` with a reason, so the next refresh doesn't silently undo it.
