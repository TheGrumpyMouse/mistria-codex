/**
 * The text-size preference: small (the design's native size), medium, large.
 *
 * It works by scaling the root font-size, which every Tailwind size in the app
 * derives from — the arbitrary pixel sizes were converted to rem for exactly
 * this reason. Sprites are deliberately outside the scale: pixel art is
 * integer-scaled or it smudges, so icons hold still while the words grow.
 *
 * Applied in `main.tsx` before first render so a reload never flashes at the
 * wrong size, and stored per device — a reading preference belongs to the
 * screen it was chosen on, so it does not ride along with sync.
 */

export const TEXT_SIZES = ['small', 'medium', 'large'] as const
export type TextSize = (typeof TEXT_SIZES)[number]

export const TEXT_SIZE_LABELS: Record<TextSize, string> = {
  small: 'Small',
  medium: 'Medium',
  large: 'Large',
}

const KEY = 'mistria-codex:text-size'

/** localStorage can throw (private mode, storage denied); the default cannot. */
export function savedTextSize(): TextSize {
  try {
    const raw = localStorage.getItem(KEY)
    return raw === 'medium' || raw === 'large' ? raw : 'small'
  } catch {
    return 'small'
  }
}

export function applyTextSize(size: TextSize): void {
  // Small is the absence of the attribute, so a fresh device needs no CSS
  // rule to look right — and tokens.css only has to state the two overrides.
  if (size === 'small') delete document.documentElement.dataset.text
  else document.documentElement.dataset.text = size
}

export function setTextSize(size: TextSize): void {
  try {
    if (size === 'small') localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, size)
  } catch {
    // Not persistable — still apply for this visit.
  }
  applyTextSize(size)
}
