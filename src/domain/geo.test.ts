import { describe, expect, it } from 'vitest'
import { haversineKm, interpolateSegment, pathDistanceKm } from './geo'

describe('Mars distance', () => {
  it('uses the 3389.5 km volumetric mean radius for one degree at the equator', () => {
    expect(haversineKm({ lon: 0, lat: 0 }, { lon: 1, lat: 0 })).toBeCloseTo(59.16, 1)
  })

  it('measures a quarter circumference as half the mean radius times pi', () => {
    expect(haversineKm({ lon: 0, lat: 0 }, { lon: 90, lat: 0 })).toBeCloseTo(Math.PI * 3389.5 / 2, 3)
  })
})

describe('route distance', () => {
  it('is zero for fewer than two points', () => {
    expect(pathDistanceKm([])).toBe(0)
    expect(pathDistanceKm([{ lon: 77.4, lat: 18.45 }])).toBe(0)
  })

  it('adds each segment in order', () => {
    const a = { lon: 77.4, lat: 18.45 }
    const b = { lon: 77.41, lat: 18.45 }
    const c = { lon: 77.41, lat: 18.46 }
    const expected = haversineKm(a, b) + haversineKm(b, c)
    expect(pathDistanceKm([a, b, c])).toBeCloseTo(expected, 6)
  })
})

describe('segment interpolation', () => {
  it('returns the start and excludes the end so segments chain without duplicates', () => {
    const points = interpolateSegment({ lon: 77.4, lat: 18.45 }, { lon: 77.5, lat: 18.45 }, 1)
    expect(points.length).toBeGreaterThan(3)
    expect(points[0]).toEqual({ lon: 77.4, lat: 18.45 })
    expect(points.at(-1)?.lon).toBeLessThan(77.5)
  })

  it('increases step count with route length', () => {
    const short = interpolateSegment({ lon: 0, lat: 0 }, { lon: 0.01, lat: 0 }, 0.5)
    const long = interpolateSegment({ lon: 0, lat: 0 }, { lon: 0.1, lat: 0 }, 0.5)
    expect(long.length).toBeGreaterThan(short.length)
  })
})
