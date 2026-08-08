import type { CSSProperties } from 'react'

/**
 * The valley, as a mosaic.
 *
 * Every other companion app draws a screenshot of the game map with markers on
 * top. This one cannot — the art is NPC Studio's and shipping it was declined —
 * and the constraint turned out to be the better design. The regions are drawn
 * from their measured footprint as a field of tesserae, which is the same
 * vocabulary as the Day Dial: the game's currency is literally mosaic tiles, so
 * a mosaic map is this app speaking its own language rather than imitating the
 * game's.
 *
 * It is also honest in a way a traced outline would not be. A cell is visibly a
 * cell, so nobody reads a footprint measured off a v0.13 map as a surveyed
 * border. The **pins** are exact — those are published coordinates — and the
 * shapes around them are frankly approximate. The drawing says which is which.
 */

export interface CellShape {
  type: 'cells'
  cell: number
  runs: [row: number, col: number, length: number][]
}

export interface MapRegionShape {
  id: string
  name: string
  shape: CellShape | null
  anchor: { x: number; y: number } | null
}

export interface ValleyMapProps {
  /** `"0 0 5442 3599"`, straight from the map record. */
  viewBox: string
  regions: MapRegionShape[]
  selectedId?: string | null
  onSelect?: (id: string) => void
  /** Extra pins — landmarks, or whatever the current query turned up. */
  pins?: { id: string; x: number; y: number; label: string }[]
  /**
   * The real map image, when the bundle has it. Drawn at the map record's own
   * declared space — the DataMaps page states the image and the coordinate
   * space are the same 5442x3599, which is the whole reason the pins land.
   * Null forever on a clone with no fetched assets; the mosaic is the
   * permanent fallback, not a loading state.
   */
  artUrl?: string | null
  /**
   * Crop to one region's bounds. The pins and shapes keep their published
   * coordinates — only the view moves, exactly like `contentViewBox`.
   */
  focusId?: string | null
}

/** One tessera, inset so neighbours never touch. */
const INSET = 0.14

/** The box a region's cells occupy, in map units. */
export function shapeBounds(
  shape: CellShape,
): { x: number; y: number; width: number; height: number } | null {
  if (shape.runs.length === 0) return null
  let minCol = Number.POSITIVE_INFINITY
  let maxCol = Number.NEGATIVE_INFINITY
  let minRow = Number.POSITIVE_INFINITY
  let maxRow = Number.NEGATIVE_INFINITY

  for (const [row, col, length] of shape.runs) {
    if (col < minCol) minCol = col
    if (col + length > maxCol) maxCol = col + length
    if (row < minRow) minRow = row
    if (row + 1 > maxRow) maxRow = row + 1
  }

  const { cell } = shape
  return {
    x: minCol * cell,
    y: minRow * cell,
    width: (maxCol - minCol) * cell,
    height: (maxRow - minRow) * cell,
  }
}

/**
 * Crop to what is actually drawn.
 *
 * The wiki's map is mostly empty — the regions sit in the middle of a much
 * larger canvas — and using its full size as the viewBox spends half the screen
 * on nothing. Cropping the *view* leaves every coordinate untouched, so pins
 * still use the published numbers and nothing has to be translated.
 */
export function contentViewBox(regions: MapRegionShape[], fallback: string, pad = 140): string {
  const boxes = regions
    .flatMap((r) => (r.shape === null ? [] : [shapeBounds(r.shape)]))
    .flatMap((b) => (b === null ? [] : [b]))
  if (boxes.length === 0) return fallback

  const minX = Math.min(...boxes.map((b) => b.x))
  const minY = Math.min(...boxes.map((b) => b.y))
  const maxX = Math.max(...boxes.map((b) => b.x + b.width))
  const maxY = Math.max(...boxes.map((b) => b.y + b.height))

  // Extra headroom at the top: labels sit above their region and the topmost
  // one would otherwise be cut in half by the edge of the drawing.
  return `${minX - pad} ${minY - pad * 2.6} ${maxX - minX + pad * 2} ${maxY - minY + pad * 3.6}`
}

/** The viewBox for one region, padded, or null when it has no shape. */
export function focusViewBox(regions: MapRegionShape[], focusId: string, pad = 180): string | null {
  const region = regions.find((r) => r.id === focusId)
  const bounds = region?.shape == null ? null : shapeBounds(region.shape)
  if (bounds === null || bounds === undefined) return null
  return `${bounds.x - pad} ${bounds.y - pad} ${bounds.width + pad * 2} ${bounds.height + pad * 2}`
}

export function ValleyMap({
  viewBox,
  regions,
  selectedId = null,
  onSelect,
  pins = [],
  artUrl = null,
  focusId = null,
}: ValleyMapProps) {
  const full = contentViewBox(regions, viewBox)
  const box = (focusId === null ? null : focusViewBox(regions, focusId)) ?? full
  const [, , width = 1, height = 1] = box.split(' ').map(Number)
  const [, , fullWidth = width] = full.split(' ').map(Number)

  // How much closer the focused view is than the whole valley. Pins are
  // counter-scaled by it so they stay pin-sized instead of becoming boulders —
  // the apps/web rule about `scale(1/k)` exists for exactly this moment.
  const zoom = focusId === null || width === 0 ? 1 : fullWidth / width
  const focused = focusId !== null

  // The declared art space. Never measured from the image: data must not
  // depend on the asset, so the record's own viewBox places it.
  const [artX = 0, artY = 0, artWidth = 0, artHeight = 0] = viewBox.split(' ').map(Number)

  return (
    <svg
      viewBox={box}
      className="block h-auto w-full"
      role="img"
      aria-label="Map of Mistria and the valley"
      // A stylised map has no business being a fixed pixel size; it scales to
      // whatever column it is given and the tesserae scale with it.
      style={{ aspectRatio: `${width} / ${height}` }}
    >
      <title>Mistria and the valley</title>

      {artUrl !== null && (
        <image
          href={artUrl}
          x={artX}
          y={artY}
          width={artWidth}
          height={artHeight}
          preserveAspectRatio="xMidYMid meet"
        />
      )}

      {regions.map((region) => (
        <RegionCells
          key={region.id}
          region={region}
          selected={region.id === selectedId}
          onSelect={onSelect}
          // Over the real art the tesserae become a whisper — hit areas and a
          // selection glow, not the picture. Without art they ARE the picture.
          ghost={artUrl !== null}
        />
      ))}

      {!focused &&
        regions.map((region) => {
          // Labelled from the shape, not the anchor. The anchor is the region's
          // centre, so a name placed there sits on top of the tiles it is
          // naming; the top edge is empty by definition. A focused view skips
          // labels entirely — the page's own heading already names the place.
          const bounds = region.shape === null ? null : shapeBounds(region.shape)
          if (bounds === null) return null
          return (
            <RegionLabel
              key={`label-${region.id}`}
              name={region.name}
              x={bounds.x + bounds.width / 2}
              y={bounds.y}
              selected={region.id === selectedId}
              haloed={artUrl !== null}
            />
          )
        })}

      {pins.map((pin) => (
        <Pin key={pin.id} x={pin.x} y={pin.y} label={pin.label} zoom={zoom} />
      ))}
    </svg>
  )
}

function RegionCells({
  region,
  selected,
  onSelect,
  ghost = false,
}: {
  region: MapRegionShape
  selected: boolean
  onSelect: ((id: string) => void) | undefined
  ghost?: boolean
}) {
  if (region.shape === null) return null
  const { cell, runs } = region.shape

  // `--rule` rather than `--sunk`: on a white card the sunk tone is nearly
  // invisible, and a mosaic you cannot see is just an empty page. Over the
  // real art the mosaic steps back to a translucent overlay — still the hit
  // area and the selection glow, no longer the picture.
  const style: CSSProperties = {
    fill: selected ? 'var(--accent)' : 'var(--rule)',
    fillOpacity: ghost ? (selected ? 0.32 : 0.06) : 1,
    transition: 'fill 140ms ease-out, fill-opacity 140ms ease-out',
  }

  // A run is drawn cell by cell rather than as one wide rectangle: the grid
  // *is* the design, and a merged strip would quietly smooth away the precision
  // this map is claiming. Keyed by grid position, which is unique and stable —
  // unlike an array index, which changes meaning when a run does.
  const cells = runs.flatMap(([row, col, length]) =>
    Array.from({ length }, (_, i) => ({ row, col: col + i })),
  )

  const interactive = onSelect !== undefined
  const select = (): void => onSelect?.(region.id)

  return (
    // A shape you can click is a control, so it is one: focusable, labelled and
    // operable from the keyboard, with the selected state in its own name. The
    // chips below do the same job and are the easier target on a phone — this is
    // the second way, not the only way.
    //
    // The rule only recognises HTML elements, so it cannot see that this group
    // already has role, tabIndex and a key handler.
    // biome-ignore lint/a11y/noStaticElementInteractions: role="button" with a tabIndex and a key handler is correct ARIA on an SVG group.
    <g
      style={style}
      className={interactive ? 'cursor-pointer' : undefined}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-label={interactive ? `${region.name}${selected ? ', selected' : ''}` : undefined}
      onClick={interactive ? select : undefined}
      onKeyDown={
        interactive
          ? (event) => {
              if (event.key !== 'Enter' && event.key !== ' ') return
              event.preventDefault()
              select()
            }
          : undefined
      }
    >
      {cells.map(({ row, col }) => (
        <rect
          key={`${row}:${col}`}
          x={(col + INSET) * cell}
          y={(row + INSET) * cell}
          width={cell * (1 - INSET * 2)}
          height={cell * (1 - INSET * 2)}
          rx={cell * 0.06}
        />
      ))}
    </g>
  )
}

/**
 * The region's name, sitting on its anchor.
 *
 * `paint-order: stroke` draws a paper-coloured halo behind the glyphs so a
 * label stays readable over the tesserae without a solid plate behind it.
 */
function RegionLabel({
  name,
  x,
  y,
  selected,
  haloed = false,
}: {
  name: string
  x: number
  y: number
  selected: boolean
  haloed?: boolean
}) {
  return (
    <text
      x={x}
      y={y - 34}
      textAnchor="middle"
      className="font-display"
      style={{
        // Sized in map units so it scales with the drawing rather than
        // shrinking into nothing as the column narrows. At the cropped view's
        // width this lands around 11px, which is where this face stops being
        // legible — and small enough that a name no longer spills across its
        // neighbours the way a larger one did.
        fontSize: 108,
        fontWeight: 600,
        letterSpacing: 2,
        // Over art, ink rather than muted — the painted ground is busier than
        // the mosaic and a muted label sinks into it.
        fill: selected ? 'var(--accent)' : haloed ? 'var(--ink)' : 'var(--ink-mute)',
        stroke: 'var(--surface)',
        strokeWidth: haloed ? 30 : 22,
        paintOrder: 'stroke',
        pointerEvents: 'none',
      }}
    >
      {name}
    </text>
  )
}

/**
 * A pin is a tessera, not a teardrop.
 *
 * The map is a grid of squares and the Day Dial is a grid of squares; a
 * balloon-shaped marker would be the only rounded thing in the app's whole
 * spatial vocabulary. Rotating it 45 degrees is what separates "a place" from
 * "the ground".
 */
function Pin({ x, y, label, zoom = 1 }: { x: number; y: number; label: string; zoom?: number }) {
  return (
    // `scale(1/zoom)` is the counter-scale from the apps/web rules: in a
    // focused view the map is drawn several times closer, and a pin left in
    // map units would grow into a boulder that covers what it marks.
    <g transform={`translate(${x} ${y}) scale(${1 / zoom}) rotate(45)`}>
      <title>{label}</title>
      {/*
        Ink, not accent. A selected region is filled with the accent, and an
        accent pin on an accent ground disappears exactly when you have just
        asked to look at it. Ink reads on both, and it keeps colour meaning what
        it means everywhere else in this app.
      */}
      <rect
        x={-30}
        y={-30}
        width={60}
        height={60}
        rx={5}
        style={{ fill: 'var(--ink)', stroke: 'var(--surface)', strokeWidth: 14 }}
      />
    </g>
  )
}
