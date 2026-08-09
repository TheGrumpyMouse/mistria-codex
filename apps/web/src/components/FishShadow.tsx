import { useEffect, useState } from 'react'
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
 * for all of them (see FISH_SHADOW_WINDOW in assets/game-art.ts). So they are
 * comparable only as long as nothing scales them independently — which is
 * exactly what `<ItemIcon>` does, fitting whatever it is given into a 24, 36 or
 * 72 pixel box. Drawing a giant and a small at the same size is not a cosmetic
 * flaw; it is the picture stating the opposite of the fact.
 *
 * Hence a component rather than an icon: one fixed scale, one fixed box, water
 * behind it, and the word still there for anyone who cannot see the image.
 *
 * **The water is a colour, not a sprite.** It used to be a crop of the game's
 * spring water tile, and that crop caught four pale pond-edge lobes — so the
 * panel showed one fish over what read as four more. The token is measured from
 * the same tile (88% of its pixels are exactly `--water`) and the silhouette on
 * top is a darker blue the artist chose to sit on it, so nothing is lost but
 * the foam. It also means the panel still looks right on a clone with no art.
 */

/** 3× — a small shadow is 12 pixels wide, and at 2× it reads as a speck. */
const SCALE = 3

/**
 * 100ms a frame, which is `duration = 0.1` in the sprite's own `.meta.toml`.
 *
 * Stated by the game rather than chosen by us, so the tail wags at the speed it
 * wags in the water.
 */
const FRAME_MS = 100

/** Frame 0 keeps the plain key; the rest are suffixed. See `fishSilhouetteWants`. */
const frameKeys = (size: string): string[] => [
  `ui/fish_shadow_${size}`,
  `ui/fish_shadow_${size}_1`,
  `ui/fish_shadow_${size}_2`,
  `ui/fish_shadow_${size}_3`,
]

export function FishShadow({ size }: { size: string }) {
  const atlas = useAtlas()
  // A bundle packed before the frames existed resolves only the first key, and
  // then this is the still it always was. A missing frame is as normal as a
  // missing sprite — never a reason to draw nothing.
  const frames = frameKeys(size)
    .map((key) => atlas.get(key))
    .filter((sprite) => sprite !== null)

  const first = frames[0]
  const [frame, setFrame] = useState(0)

  useEffect(() => {
    if (frames.length < 2) return
    // Someone who has asked the OS to stop things moving gets the still. The
    // picture's job is to show a size, and it does that in one frame.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    const timer = window.setInterval(
      () => setFrame((current) => (current + 1) % frames.length),
      FRAME_MS,
    )
    return () => window.clearInterval(timer)
  }, [frames.length])

  // No art is the normal case for a clone that never fetched any, and the
  // sentence beside this carries the fact on its own. Nothing is better than an
  // empty blue rectangle implying we know something we do not.
  if (first === undefined) return null
  const shown = frames[frame % frames.length] ?? first

  return (
    <span
      className="relative inline-grid shrink-0 overflow-hidden rounded-tile border border-rule"
      style={{
        width: first.width * SCALE,
        height: first.height * SCALE,
        background: 'var(--water)',
      }}
      role="img"
      aria-label={`A ${size} shadow in the water`}
    >
      <span aria-hidden className="sprite" style={spriteStyle(shown, SCALE)} />
    </span>
  )
}
