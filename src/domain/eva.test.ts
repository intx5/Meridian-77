import { describe, expect, it } from 'vitest'
import type { RouteTerrain } from './dem'
import type { Waypoint } from '@/types'
import { computeEva } from './eva'

function terrain(overrides: Partial<RouteTerrain> = {}): RouteTerrain {
  return {
    samples: [],
    totalKm: 1,
    unknownFraction: 0,
    elevationGainM: 0,
    elevationLossM: 0,
    maxSlopeDeg: 0,
    meanSlopeDeg: 0,
    hazardSegments: [],
    ...overrides,
  }
}

function waypoint(overrides: Partial<Waypoint> = {}): Waypoint {
  return {
    id: 'wp-x',
    name: 'Test site',
    lon: 77.4,
    lat: 18.45,
    kind: 'science',
    imageUrl: null,
    imageCredit: 'NASA',
    sourceUrl: 'https://example.com',
    minerals: [],
    note: '',
    ...overrides,
  }
}

const near = { lon: 77.4, lat: 18.45 }

describe('EVA duration and verdict', () => {
  it('returns GO for a short, safe route inside the time limit', () => {
    const result = computeEva({
      terrain: terrain(),
      routeWaypoints: [waypoint()],
      target: near,
      thermalPercentile80: 348,
    })
    expect(result.durationHours).toBeCloseTo(1 / 1.5 + 20 / 60, 6)
    expect(result.verdict).toBe('GO')
  })

  it('computes duration from walk time plus sampling stops', () => {
    const result = computeEva({
      terrain: terrain({ totalKm: 3 }),
      routeWaypoints: [waypoint({ id: 'a' }), waypoint({ id: 'b', kind: 'pov' })],
      target: near,
      thermalPercentile80: 348,
    })
    expect(result.stopCount).toBe(2)
    expect(result.durationHours).toBeCloseTo(3 / 1.5 + (2 * 20) / 60, 6)
  })

  it('downgrades to CAUTION when maximum slope passes 15 degrees', () => {
    const result = computeEva({
      terrain: terrain({ maxSlopeDeg: 18 }),
      routeWaypoints: [waypoint()],
      target: near,
      thermalPercentile80: 348,
    })
    expect(result.verdict).toBe('CAUTION')
  })

  it('returns NO-GO at 25 degrees even when the route is short', () => {
    const result = computeEva({
      terrain: terrain({ maxSlopeDeg: 25 }),
      routeWaypoints: [waypoint()],
      target: near,
      thermalPercentile80: 348,
    })
    expect(result.verdict).toBe('NO-GO')
  })

  it('returns NO-GO beyond 1.2 times the six hour limit', () => {
    const result = computeEva({
      terrain: terrain({ totalKm: 11 }),
      routeWaypoints: [],
      target: near,
      thermalPercentile80: 348,
    })
    expect(result.durationHours).toBeGreaterThan(7.2)
    expect(result.verdict).toBe('NO-GO')
  })

  it('still gives GO at exactly the time limit and slope threshold', () => {
    const result = computeEva({
      terrain: terrain({ totalKm: 9, maxSlopeDeg: 15 }),
      routeWaypoints: [],
      target: near,
      thermalPercentile80: 348,
    })
    expect(result.durationHours).toBeCloseTo(6, 6)
    expect(result.verdict).toBe('GO')
  })

  it('never issues GO for a zero-length route', () => {
    const result = computeEva({
      terrain: terrain({ totalKm: 0 }),
      routeWaypoints: [],
      target: near,
      thermalPercentile80: 348,
    })
    expect(result.verdict).toBe('NO-GO')
    expect(result.verdictReason).toMatch(/no measurable length/i)
  })

  it('treats unknown terrain as a safety failure', () => {
    const result = computeEva({
      terrain: terrain({ unknownFraction: 0.4 }),
      routeWaypoints: [waypoint()],
      target: near,
      thermalPercentile80: 348,
    })
    expect(result.safetyScore).toBeLessThan(70)
    expect(result.verdict).not.toBe('GO')
  })
})

describe('EVA explanation and scores', () => {
  it('lists a penalty row for every safety factor', () => {
    const result = computeEva({
      terrain: terrain({ maxSlopeDeg: 20, unknownFraction: 0.1 }),
      routeWaypoints: [waypoint({ thermalInertia: 400 })],
      target: near,
      thermalPercentile80: 348,
    })
    const factors = result.breakdown.map((item) => item.factor)
    expect(factors).toContain('slope')
    expect(factors).toContain('duration')
    expect(factors).toContain('terrain coverage')
    expect(factors).toContain('thermal inertia')
    expect(factors).toContain('mineral diversity')
    expect(result.hazardCount).toBeGreaterThan(0)
  })

  it('penalises steep terrain monotonically', () => {
    const shallow = computeEva({
      terrain: terrain({ maxSlopeDeg: 8 }),
      routeWaypoints: [],
      target: near,
      thermalPercentile80: 348,
    })
    const steep = computeEva({
      terrain: terrain({ maxSlopeDeg: 20 }),
      routeWaypoints: [],
      target: near,
      thermalPercentile80: 348,
    })
    expect(steep.safetyScore).toBeLessThan(shallow.safetyScore)
  })

  it('does not award target proximity when no science waypoint is on the route', () => {
    const result = computeEva({
      terrain: terrain(),
      routeWaypoints: [],
      target: near,
      thermalPercentile80: 348,
    })
    expect(result.scienceScore).toBe(0)
  })

  it('rewards diverse minerals and proximity to the science target', () => {
    const bare = computeEva({
      terrain: terrain(),
      routeWaypoints: [waypoint({ minerals: [] })],
      target: { lon: 77.6, lat: 18.45 },
      thermalPercentile80: 348,
    })
    const rich = computeEva({
      terrain: terrain(),
      routeWaypoints: [waypoint({ minerals: ['phyllosilicates', 'carbonates'] })],
      target: near,
      thermalPercentile80: 348,
    })
    expect(rich.scienceScore).toBeGreaterThan(bare.scienceScore)
    expect(rich.scienceScore).toBeLessThanOrEqual(100)
  })

  it('always scores safety within zero and one hundred', () => {
    const worst = computeEva({
      terrain: terrain({ maxSlopeDeg: 40, unknownFraction: 1 }),
      routeWaypoints: [waypoint({ thermalInertia: 999 })],
      target: near,
      thermalPercentile80: 348,
    })
    expect(worst.safetyScore).toBeGreaterThanOrEqual(0)
    expect(worst.safetyScore).toBeLessThanOrEqual(100)
  })
})
