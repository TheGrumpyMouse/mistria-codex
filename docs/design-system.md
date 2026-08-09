# Design system — The Valley Almanac

The live version of this document is the `/design` route. A token file is a
claim; that page is the evidence.

---

## The thesis

A naturalist's field almanac crossed with a mosaic.

Two things in the game earn that. The currency is **tesserae** — literally
mosaic tiles. And the museum and archaeology thread makes specimen-card
vocabulary honest rather than borrowed decoration.

The generic answer to "cozy farming game companion" is cream, rounded pastel
cards and a serif display face. That is the default, not a choice. What makes
this one specific: **the calendar really is a 4×7 grid**. A Mistria season is
28 days, which is four seven-day weeks exactly, so the weekday of a day number
never drifts. The grid is not a layout imposed on the data — it is the data's
own shape, which is why the signature element could be nothing else.

## Signature: the Day Dial

The instant picker is not a form. It is a mosaic: a 4×7 grid of tesserae for the
season, a row of weather tiles, and a band for the time. Festivals and birthdays
are notched into the day tile itself, not explained in a legend — a legend that
has to be read is a legend nobody reads.

It is the thing the user touches most and the thing the app is remembered by. It
is also the only place in the app that spends any boldness. Everything around it
stays quiet.

## Palette

Paper ground, warm-dark ink, and a **season-driven accent**.

```
--paper    #FBF8F3   ground        --ink       #2E2A33  text (purple-leaning)
--surface  #FFFFFF   cards         --ink-mute  #736C7A  secondary
--sunk     #F4EFE7   inset tiles   --ink-faint #A49DAB  tertiary
--rule     #E8E2DA   hairlines

spring #7FBF8A / tint #EAF5EC       fall   #D4834A / tint #FAEDE2
summer #4FA8C9 / tint #E6F2F7       winter #8B93C9 / tint #ECEDF7
```

**The season is the accent.** `--accent` is not a fixed colour; it is whichever
season the app is currently showing, set by `data-season` on the root element.
The chrome tells you which season you are in, so no result has to wear a badge
saying so. That is the one risk this palette takes, and it is justified because
season is the dominant state of the whole app.

**Signal colours sit outside the season system**, so they never shift meaning:
museum gold `#C9A227`, gap rose `#C96A6A`, locked grey `#8A8290`.

**Unverified data is never a colour.** It is a dashed hollow outline in muted ink
— the `.unverified` utility, and the same treatment a hollow map pin gets, so the
two read as the same claim. Colour is spoken for.

Light only for v1. A night-cycle game wants dark mode and it is a real want, but
half-doing it is worse than not doing it: the season accents have to be
re-derived for a dark ground, not inverted. Post-v1.

## Type

Self-hosted, all OFL, never from a CDN — an offline PWA that reaches for a font
server on first paint is not offline.

- **Fraunces**, variable, with `WONK` dialled up — headings and display numerals.
  A soft serif with genuine oddity, deliberately not the Playfair or Instrument
  Serif that every one of these projects reaches for.
- **Figtree**, variable — body and UI. Humanist-geometric, and it holds up at
  13px on a phone.
- **IBM Plex Mono** — tesserae values, times, coordinates, the device code.
  Functional, not stylistic: prices align in dense lists, and the sync code has
  to be transcribable by someone reading it aloud.

Anything numeric carries `data-numeral`, which switches the face and turns on
tabular figures.

**The pixel-ness lives in the geometry, not the type.** A pixel font at 13px on
mobile is illegible and reads as costume. Instead: a strict **4px spacing scale**,
tiles at **2px radius**, cards at **10px**. The tessera is sharp; everything
around it is soft. That contrast is the system.

## Icons

Lucide (ISC) covers every piece of UI chrome.

For items, `ItemIcon` draws the game's sprite when there is one and a glyph when
there is not. The sprites are NPC Studio's, used under attribution and served
from our own origin; they are packed into a few atlas sheets and scaled by
**integer factors only**, because pixel art at 1.5x renders visibly lopsided and
`image-rendering: pixelated` does not rescue it.

The glyph path renders an `icon_key` as initials on a pastel ground whose hue
comes from a hash of the key, stepped by the golden angle so that neighbouring
keys do not land on neighbouring hues and a category page does not come out
looking like one colour. Deterministic is the important word: the same item is
the same colour on every device and every build, so a player learns to recognise
it.

**Both paths are permanent.** Roughly thirty records have no sprite on the wiki,
a fresh clone has none at all until `pnpm assets:fetch` runs, and if the art is
ever withdrawn the glyph is the whole app. A list that mixes the two must not go
ragged, so a sprite is centred in the same box a glyph would occupy.

## Layout

Bottom nav on a phone, sidebar from `lg`. Bottom nav is not a stylistic choice —
this app is consulted mid-game, one-handed, and the thumb reaches the bottom of
the screen.

The content column is narrow on purpose (`max-w-lg`). This is a reference read
one screen at a time, and a 4×7 mosaic spread across a wide desktop stops looking
like a calendar and starts looking like a spreadsheet.

## The quality floor

Not announced, just met: responsive to 320px, visible keyboard focus in the
season accent, `prefers-reduced-motion` respected, every control reachable and
labelled, and tap targets that clear the iOS home indicator via
`env(safe-area-inset-bottom)`.
