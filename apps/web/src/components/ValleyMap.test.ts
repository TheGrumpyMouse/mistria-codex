import { describe, expect, it } from 'vitest'
import { type CellShape, contentViewBox, type MapRegionShape, shapeBounds } from './ValleyMap'

const shape = (runs: [number, number, number][], cell = 10): CellShape => ({
  type: 'cells',
  cell,
  runs,
})

const region = (id: string, s: CellShape | null): MapRegionShape => ({
  id,
  name: id,
  shape: s,
  anchor: null,
})

describe('shapeBounds', () => {
  it('spans every run', () => {
    expect(
      shapeBounds(
        shape([
          [2, 3, 4],
          [3, 1, 2],
        ]),
      ),
    ).toEqual({
      x: 10,
      y: 20,
      width: 60,
      height: 20,
    })
  })

  it('is null for a shape with no cells', () => {
    expect(shapeBounds(shape([]))).toBeNull()
  })
})

describe('contentViewBox', () => {
  it('crops to what is drawn rather than the whole canvas', () => {
    // The wiki's map is mostly empty; using its full size spends half the
    // screen on nothing.
    const box = contentViewBox([region('a', shape([[10, 10, 2]]))], '0 0 5442 3599', 10)
    const [x, y, w, h] = box.split(' ').map(Number)
    expect(x).toBe(90)
    expect(w).toBeGreaterThan(0)
    expect(h).toBeGreaterThan(0)
    // Cropping the view must never move a coordinate: the region still starts
    // at x=100 in map units, inside a box that begins before it.
    expect(x).toBeLessThan(100)
    expect(y).toBeLessThan(100)
  })

  it('leaves more room above than below, because labels sit on top', () => {
    const parts = contentViewBox([region('a', shape([[10, 10, 2]]))], '0 0 1 1', 10)
      .split(' ')
      .map(Number)
    const y = parts[1] ?? 0
    const h = parts[3] ?? 0
    expect(100 - y).toBeGreaterThan(y + h - 110)
  })

  it('falls back to the map when nothing has a shape', () => {
    expect(contentViewBox([region('a', null)], '0 0 5442 3599')).toBe('0 0 5442 3599')
  })
})
