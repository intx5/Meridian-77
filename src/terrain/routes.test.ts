import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import type { RasterGrid } from '@/types'
import { cameraFloor, createFrame, fromLocal, sampleSurface, toLocal } from './model'
import { drapeRoute } from './routes'

const dem: RasterGrid = {
  bounds: [77, 18, 77.01, 18.01],
  width: 8,
  height: 8,
  noData: -9999,
  values: Array.from({ length: 64 }, (_, i) => -2500 + (i % 8) ** 2 + Math.floor(i / 8) * 3),
}
describe('route draping and camera constraints', () => {
  it('splits at triangle boundaries and follows a non-flat surface at every segment midpoint', () => {
    const frame = createFrame(dem)
    const route = [
      { lon: 77.0011, lat: 18.0089 },
      { lon: 77.0091, lat: 18.0023 },
    ]
    const original = structuredClone(dem.values)
    for (const relief of [1, 3]) {
      const result = drapeRoute(dem, frame, route, relief)
      expect(result.unknown).toBe(0)
      expect(result.lines.flatMap((l) => l.points).length).toBeGreaterThan(10)
      for (const line of result.lines)
        for (let i = 1; i < line.points.length; i++) {
          const a = line.points[i - 1],
            b = line.points[i]
          const mid = fromLocal(frame, (a[0] + b[0]) / 2, (a[2] + b[2]) / 2)
          expect((a[1] + b[1]) / 2).toBeCloseTo(
            (sampleSurface(dem, frame, mid)! - frame.referenceM) * relief + 0.8,
            5,
          )
        }
    }
    expect(dem.values).toEqual(original)
  })
  it('breaks lines across missing cells rather than drawing a false elevation', () => {
    const hole = { ...dem, values: dem.values.map((v, i) => (i % 8 === 4 ? -9999 : v)) }
    const f = createFrame(hole)
    const result = drapeRoute(
      hole,
      f,
      [
        { lon: 77.001, lat: 18.005 },
        { lon: 77.009, lat: 18.005 },
      ],
      1,
    )
    expect(result.unknown).toBeGreaterThan(0)
    expect(result.lines.length).toBeGreaterThanOrEqual(2)
    for (const line of result.lines)
      for (let i = 1; i < line.points.length; i++) {
        const a = line.points[i - 1],
          b = line.points[i]
        expect(sampleSurface(hole, f, fromLocal(f, (a[0] + b[0]) / 2, (a[2] + b[2]) / 2))).not.toBeNull()
      }
  })
  it('constrains an off-map focus destination before interpolating toward it', () => {
    const real = JSON.parse(readFileSync('public/data/jezero/dem.json', 'utf8')) as RasterGrid
    const f = createFrame(real),
      p = toLocal(f, { lon: 77.46241025851957, lat: 18.41230794886602 })
    expect(cameraFloor(real, f, p.x, p.z + 1550, 3)).toBeCloseTo(1480.5, 5)
    const floor = cameraFloor(real, f, p.x, p.z + 1550, 3)
    const destinationY = Math.max(5.745, floor)
    let y = 3000
    for (let i = 0; i < 150; i++) y = Math.max(y + (destinationY - y) * 0.12, floor)
    expect(Math.abs(y - destinationY)).toBeLessThan(1)
  })
  it('supports colorOverride and heightOffset for 3D green/blue candidate paths', () => {
    const frame = createFrame(dem)
    const route = [
      { lon: 77.0011, lat: 18.0089 },
      { lon: 77.0091, lat: 18.0023 },
    ]
    const result = drapeRoute(dem, frame, route, 2, '#22c55e', 1.3)
    expect(result.lines.length).toBe(1)
    expect(result.lines[0].color).toBe('#22c55e')
    expect(result.lines[0].points.length).toBeGreaterThan(10)
  })
})
