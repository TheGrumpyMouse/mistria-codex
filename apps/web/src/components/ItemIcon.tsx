import type { CSSProperties } from 'react'
import { useAtlas } from '~/app/AtlasProvider'
import { integerScale, spriteStyle } from '~/lib/sprites'

/**
 * An item's visual identity: the game's sprite where we have one, a drawn glyph
 * where we don't.
 *
 * The sprites are NPC Studio's art, served from our own origin under
 * attribution and never hotlinked — see docs/DATA-POLICY.md. Records still
 * carry only an `icon_key`; the key-to-sprite mapping lives in the asset
 * manifest, so `data/` names no art and deleting `assets/` breaks nothing.
 *
 * **The glyph is not legacy code.** About thirty records have no sprite on the
 * wiki, and anything added before its art exists has none either, so the
 * fallback is the permanent answer for a real and recurring case. It hashes the
 * key to a hue: deterministic, so the same item is the same colour on every
 * device and every build, and a player learns to recognise it.
 */

/**
 * FNV-1a, 32-bit.
 *
 * Any stable hash would do; this one is four lines and has no dependency. What
 * matters is that it never changes — a different hash is a different colour for
 * every item in the app, which reads to a returning player as everything having
 * moved.
 */
function hash(key: string): number {
  let value = 0x811c9dc5
  for (let i = 0; i < key.length; i += 1) {
    value ^= key.charCodeAt(i)
    value = Math.imul(value, 0x01000193)
  }
  return value >>> 0
}

/**
 * Hues are spread by the golden angle rather than taken straight from the hash.
 *
 * A hash modulo 360 clusters: neighbouring keys land on neighbouring hues and
 * a category page comes out looking like one colour. Stepping by 137.5 degrees
 * spreads any sequence of values as far apart as they can go.
 */
const GOLDEN_ANGLE = 137.508

export function hueFor(key: string): number {
  return (hash(key) * GOLDEN_ANGLE) % 360
}

/**
 * Box sizes, chosen to divide the artwork rather than the other way round.
 *
 * The wiki's sprites are 72 pixels square, and 24 and 36 are exactly a third and
 * a half of that — so a sprite lands on whole pixels at every size the app uses
 * and `lg` is the art at its own resolution. Picking round numbers first and
 * discovering the artwork afterwards is how you end up with a 56-pixel box
 * showing a 72-pixel sprite at 1.28x.
 */
const SIZES = { sm: 24, md: 36, lg: 72 } as const

export interface ItemIconProps {
  /** The record's `icon_key`, e.g. `fish/rainbow_trout`. */
  iconKey: string
  /** Used for the initial and the accessible label. */
  name: string
  size?: keyof typeof SIZES
  /**
   * Draw it hollow. For an inferred or unverified thing — the same treatment a
   * hollow map pin gets, so the two read as the same claim.
   */
  unverified?: boolean
}

export function ItemIcon({ iconKey, name, size = 'md', unverified = false }: ItemIconProps) {
  const px = SIZES[size]
  const sprite = useAtlas().get(iconKey)

  // `unverified` deliberately keeps the glyph even when a sprite exists. The
  // dashed hollow treatment is how this app says "we are not sure", and a real
  // sprite behind it would read as a fact — see docs/design-system.md.
  if (sprite !== null && !unverified) {
    // The sprite is centred in the same box the glyph would occupy, so a list
    // mixing the two does not go ragged. The scale is a whole number or the
    // reciprocal of one, never something like 1.5.
    return (
      <span
        className="inline-grid shrink-0 place-items-center"
        style={{ width: px, height: px }}
        title={name}
        role="img"
        aria-label={name}
      >
        <span
          aria-hidden
          className="sprite"
          style={spriteStyle(sprite, integerScale(Math.max(sprite.width, sprite.height), px))}
        />
      </span>
    )
  }

  const hue = hueFor(iconKey)

  // Saturation and lightness are fixed so nothing ever comes out muddy or
  // fluorescent — only the hue varies, which is what keeps 1,154 of these
  // looking like one family.
  const style: CSSProperties = unverified
    ? { width: px, height: px }
    : {
        width: px,
        height: px,
        background: `hsl(${hue} 46% 92%)`,
        color: `hsl(${hue} 44% 32%)`,
        borderColor: `hsl(${hue} 38% 82%)`,
      }

  return (
    <span
      className={`inline-grid shrink-0 place-items-center rounded-tile border font-display font-semibold ${
        unverified ? 'unverified border-dashed' : ''
      }`}
      style={style}
      title={name}
      role="img"
      aria-label={name}
    >
      <span aria-hidden style={{ fontSize: px * 0.46, lineHeight: 1 }}>
        {initialsOf(name)}
      </span>
    </span>
  )
}

/**
 * One or two letters.
 *
 * A single letter is ambiguous across 1,154 items; three is unreadable at 24px
 * on a phone. Two initials from a multi-word name, one otherwise.
 */
export function initialsOf(name: string): string {
  const words = name.split(/[\s-]+/).filter((w) => /[a-z0-9]/i.test(w))
  if (words.length === 0) return '?'
  if (words.length === 1) return (words[0] ?? '').slice(0, 1).toUpperCase()
  return `${(words[0] ?? '').slice(0, 1)}${(words[1] ?? '').slice(0, 1)}`.toUpperCase()
}
