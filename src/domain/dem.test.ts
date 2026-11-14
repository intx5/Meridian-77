import { describe, expect, it } from 'vitest'
import type { RasterGrid } from '@/types'
import { buildTerrainProfile, sampleElevation } from './dem'

const flat: RasterGrid = {
  bounds: [0, 0, 0.1, 0.1],
  width: 3,
  height: 3,
  noData: -9999,
  values: [100, 100, 100, 100, 100, 100, 100, 100, 100],
}

const bilinear: RasterGrid = {
  bounds: [0, 0, 1, 1],
  width: 2,
  height: 2,
  noData: -9999,
  values: [100, 200, 300, 400],
}

describe('bilinear elevation sampling', () => {
  it('reads row 0 at the north edge and returns the exact corner', () => {
    expect(sampleElevation(bilinear, 0, 1)).toBe(100)
    expect(sampleElevation(bilinear, 1, 1)).toBe(200)
    expect(sampleElevation(bilinear, 0, 0)).toBe(300)
  })

  it('interpolates the centre of a two by two grid', () => {
    expect(sampleElevation(bilinear, 0.5, 0.5)).toBeCloseTo(250, 6)
    expect(sampleElevation(bilinear, 0.5, 0.75)).toBeCloseTo(150, 6)
  })

  it('returns null outside bounds rather than clamping', () => {
    expect(sampleElevation(bilinear, 1.2, 0.5)).toBeNull()
    expect(sampleElevation(bilinear, 0.5, -0.1)).toBeNull()
  })

  it('returns null when a bilinear neighbour is no-data', () => {
    const gapped = { ...bilinear, values: [100, 200, -9999, 400] }
    expect(sampleElevation(gapped, 0.1, 0.1)).toBeNull()
  })
})

describe('terrain profile', () => {
  it('reports zero gain and slope on flat terrain', () => {
    const profile = buildTerrainProfile(flat, [
      { lon: 0.02, lat: 0.05 },
      { lon: 0.08, lat: 0.05 },
    ])
    expect(profile.elevationGainM).toBe(0)
    expect(profile.elevationLossM).toBe(0)
    expect(profile.maxSlopeDeg).toBe(0)
    expect(profile.unknownFraction).toBe(0)
    expect(profile.samples.length).toBeGreaterThan(2)
  })

  it('samples intermediate terrain, not only the clicked endpoints', () => {
    const profile = buildTerrainProfile(flat, [
      { lon: 0.02, lat: 0.05 },
      { lon: 0.08, lat: 0.05 },
    ])
    expect(profile.samples.some((s) => s.lon > 0.03 && s.lon < 0.07)).toBe(true)
  })

  it('accumulates gain and loss from consecutive elevations', () => {
    const ramp: RasterGrid = { ...flat, values: Array.from({ length: 9 }, (_, i) => 80 - i * 10) }
    const profile = buildTerrainProfile(ramp, [
      { lon: 0.02, lat: 0.05 },
      { lon: 0.08, lat: 0.05 },
    ])
    expect(profile.elevationLossM).toBeGreaterThan(0)
    expect(profile.elevationGainM).toBe(0)
  })

  it('marks no-data coverage without inventing elevations', () => {
    const gapped: RasterGrid = { ...flat, values: Array(9).fill(-9999) }
    const profile = buildTerrainProfile(gapped, [
      { lon: 0.02, lat: 0.05 },
      { lon: 0.08, lat: 0.05 },
    ])
    expect(profile.unknownFraction).toBe(1)
    expect(profile.samples.every((s) => s.elevationM === null)).toBe(true)
  })

  it('never makes a profile from a single point', () => {
    const profile = buildTerrainProfile(flat, [{ lon: 0.05, lat: 0.05 }])
    expect(profile.totalKm).toBe(0)
    expect(profile.samples).toHaveLength(0)
  })
})
