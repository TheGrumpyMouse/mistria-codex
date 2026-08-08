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
wiki/cargo/     Cargo table exports, one file per table
wiki/pages/     page-level extracts for data Cargo doesn't hold
game/           game-file extraction output (empty until milestone G1)
```

Refresh with `pnpm enrich:cargo`. Editing a value here is never the right fix —
put a correction in `curated/overrides/` with a reason, so the next refresh
doesn't silently undo it.
