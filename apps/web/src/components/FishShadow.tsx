import { useAtlas } from '~/app/AtlasProvider'
import { spriteStyle } from '~/lib/sprites'

/**
 * What this fish looks like from the bank.
 *
 * A fish's shadow is how you decide whether to cast, and the game tells you
 * nothing else about it — so "large" is only useful once you know how large
 * large is. That is a question a word cannot answer and a picture can.
 *
 * **The four silhouettes are drawn at their true relative sizes**, 12×5 pixels
 * up to 31×16, inside one shared canvas that the asset step crops identically
 * for all four (see FISH_SHADOW_WINDOW in assets/game-art.ts). So they are
 * comparable only as long as nothing scales them independently — which is
 * exactly what `<ItemIcon>` does, fitting whatever it is given into a 24, 36 or
 * 72 pixel box. Drawing a giant and a small at the same size is not a cosmetic
 * flaw; it is the picture stating the opposite of the fact.
 *
 * Hence a component rather than an icon: one fixed scale, one fixed box, water
 * behind it, and the word still there for anyone who cannot see the image.
 */

/** 3× — a small shadow is 12 pixels wide, and at 2× it reads as a speck. */
const SCALE = 3

export function FishShadow({ size }: { size: string }) {
  const atlas = useAtlas()
  const shadow = atlas.get(`ui/fish_shadow_${size}`)
  const water = atlas.get('ui/water')

  // No art is the normal case for a clone that never fetched any, and the
  // sentence below carries the fact on its own. Nothing is better than an
  // empty blue rectangle implying we know something we do not.
  if (shadow === null) return null

  return (
    <span
      className="relative inline-grid shrink-0 overflow-hidden rounded-tile border border-rule"
      style={{ width: shadow.width * SCALE, height: shadow.height * SCALE }}
      role="img"
      aria-label={`A ${size} shadow in the water`}
    >
      {water !== null && <span aria-hidden className="sprite" style={spriteStyle(water, SCALE)} />}
      <span
        aria-hidden
        className="sprite"
        style={{
          ...spriteStyle(shadow, SCALE),
          // Stacked, not laid out: the two crops are the same rectangle of the
          // same world, so they line up only if they share an origin.
          position: 'absolute',
          inset: 0,
        }}
      />
    </span>
  )
}
