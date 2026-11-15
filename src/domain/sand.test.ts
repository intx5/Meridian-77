import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import type { RasterGrid, SandFeatureCollection, SandGrid } from '@/types'
import { buildTerrainProfile } from './dem'
import { assessRouteSand, planTraverseRoutes, sampleSandClass, validateSandData } from './sand'

const testSandGrid: SandGrid = {
  bounds: [77.0, 18.0, 77.04, 18.04],
  width: 4,
  height: 4,
  noData: -1,
  // Row 0 (north, lat 18.03..18.04): [0, 0, 0, 0]
  // Row 1 (lat 18.02..18.03): [0, 1, 1, 0]  <-- central dune field barrier
  // Row 2 (lat 18.01..18.02): [0, 2, 3, 0]  <-- sand sheet & uncertain
  // Row 3 (south, lat 18.00..18.01): [0, 0, 0, 0]
  values: [
    0, 0, 0, 0,
    0, 1, 1, 0,
    0, 2, 3, 0,
    0, 0, 0, 0,
  ],
}

const flatDem: RasterGrid = {
  bounds: [77.0, 18.0, 77.04, 18.04],
  width: 4,
  height: 4,
  noData: -9999,
  values: Array(16).fill(-2500),
}

describe('sand classification sampling and route assessment', () => {
  it('rejects a zero-sized sand grid even when its array length matches', () => {
    expect(() => validateSandData(
      { ...testSandGrid, width: 0, values: [] },
      { type: 'FeatureCollection', region: 'Jezero', coordinateSystem: 'planetocentric', features: [] },
      testSandGrid.bounds,
    )).toThrow(/sand.json:.*dimensions/)
  })

  it('samples north-first sand cells and returns 0 outside bounds', () => {
    expect(sampleSandClass(testSandGrid, 77.015, 18.025)).toBe(1)
    expect(sampleSandClass(testSandGrid, 77.015, 18.015)).toBe(2)
    expect(sampleSandClass(testSandGrid, 77.025, 18.015)).toBe(3)
    expect(sampleSandClass(testSandGrid, 77.005, 18.035)).toBe(0)
    expect(sampleSandClass(testSandGrid, 76.9, 18.02)).toBe(0)
  })

  it('measures dune, sand sheet, and uncertain distances along a traverse profile', () => {
    const profile = buildTerrainProfile(
      flatDem,
      [
        { lon: 77.005, lat: 18.025 },
        { lon: 77.035, lat: 18.025 },
      ],
      { spacingKm: 0.02 },
    )
    const sand = assessRouteSand(testSandGrid, profile.samples)
    expect(sand.duneKm).toBeGreaterThan(0.5)
    expect(sand.duneFraction).toBeGreaterThan(0.3)
    expect(sand.hazardSegments.length).toBeGreaterThan(0)
    expect(sand.hazardSegments[0].kind).toBe('dune_field')
  })

  it('computes Route A (shortest) and Route B (risk-aware) where Route B avoids central dune fields', () => {
    const start = { lon: 77.005, lat: 18.025 }
    const target = { lon: 77.035, lat: 18.025 }
    const planned = planTraverseRoutes({
      dem: flatDem,
      sand: testSandGrid,
      start,
      target,
    })

    const shortestProfile = buildTerrainProfile(flatDem, planned.shortest.waypoints, { spacingKm: 0.02 })
    const riskProfile = buildTerrainProfile(flatDem, planned.riskAware.waypoints, { spacingKm: 0.02 })
    const shortestSand = assessRouteSand(testSandGrid, shortestProfile.samples)
    const riskSand = assessRouteSand(testSandGrid, riskProfile.samples)

    expect(planned.shortest.waypoints[0]).toEqual(start)
    expect(planned.shortest.waypoints.at(-1)).toEqual(target)
    expect(planned.riskAware.waypoints[0]).toEqual(start)
    expect(planned.riskAware.waypoints.at(-1)).toEqual(target)
    expect(shortestProfile.totalKm).toBeLessThanOrEqual(riskProfile.totalKm)
    expect(riskSand.duneKm).toBeLessThan(shortestSand.duneKm)
  })

  it('keeps both exact endpoints when they lie in the same traversable cell', () => {
    const start = { lon: 77.005, lat: 18.035 }
    const target = { lon: 77.006, lat: 18.035 }
    const planned = planTraverseRoutes({ dem: flatDem, sand: testSandGrid, start, target })
    expect(planned.shortest.reachable).toBe(true)
    expect(planned.shortest.waypoints).toEqual([start, target])
    expect(planned.riskAware.waypoints).toEqual([start, target])
  })

  it('rejects a same-cell traverse inside a forbidden dune field', () => {
    const start = { lon: 77.015, lat: 18.025 }
    const target = { lon: 77.016, lat: 18.025 }
    const planned = planTraverseRoutes({ dem: flatDem, sand: testSandGrid, start, target, duneNoGoAssumption: true })
    expect(planned.shortest.reachable).toBe(false)
    expect(planned.riskAware.reachable).toBe(false)
  })

  it('keeps the least-cost path when a queued cell is reached more cheaply', () => {
    const sand: SandGrid = {
      ...testSandGrid,
      width: 6,
      height: 6,
      values: [
        0, 3, 0, 3, 0, 1,
        0, 0, 3, 3, 0, 0,
        3, 2, 3, 1, 1, 3,
        3, 2, 3, 1, 0, 3,
        0, 0, 0, 3, 1, 2,
        1, 2, 3, 0, 0, 0,
      ],
    }
    const planned = planTraverseRoutes({
      dem: flatDem,
      sand,
      start: { lon: 77.002, lat: 18.038 },
      target: { lon: 77.038, lat: 18.002 },
      aiWeights: { slope: 0.35, sand: 0.37, rock: 0.2, uncertainty: 0.34 },
    })
    // Dijkstra reference: cells 0, 6, 12, 18, 24, 25, 26, 33, 34, 35.
    expect(planned.aiOptimized?.riskCost).toBe(25.2)
  })

  it('validates generated Jezero sand.json and sand-detections.geojson provenance', () => {
    const sand = JSON.parse(readFileSync('public/data/jezero/sand.json', 'utf8')) as SandGrid
    const geojson = JSON.parse(
      readFileSync('public/data/jezero/sand-detections.geojson', 'utf8'),
    ) as SandFeatureCollection
    expect(sand.width).toBe(256)
    expect(sand.height).toBe(256)
    expect(sand.values).toHaveLength(256 * 256)
    expect(geojson.features.length).toBeGreaterThan(30)
    for (const feature of geojson.features) {
      expect(['dune_field', 'sand_sheet', 'uncertain_aeolian']).toContain(feature.properties.kind)
      expect(feature.properties.areaM2).toBeGreaterThan(0)
      expect(feature.properties.confidence).toBeGreaterThanOrEqual(0.3)
      expect(feature.properties.confidence).toBeLessThanOrEqual(1.0)
      expect(feature.properties.limitations).toMatch(/bearing capacity/i)
    }
  })

  it('keeps a traversable Jezero route when a shortcut would cross the slope limit', () => {
    const dem = JSON.parse(readFileSync('public/data/jezero/dem.json', 'utf8')) as RasterGrid
    const sand = JSON.parse(readFileSync('public/data/jezero/sand.json', 'utf8')) as SandGrid
    const planned = planTraverseRoutes({
      dem, sand, duneNoGoAssumption: true,
      start: { lon: 77.450947, lat: 18.444543 },
      target: { lon: 77.346647, lat: 18.495396 },
    })
    expect(planned.shortest.reachable).toBe(true)
    expect(buildTerrainProfile(dem, planned.shortest.waypoints).maxSlopeDeg).toBeLessThan(25)
  })

  it('does not increase dune exposure on the risk-aware route from Octavia Landing to Upper Delta', () => {
    const dem = JSON.parse(readFileSync('public/data/jezero/dem.json', 'utf8')) as RasterGrid
    const sand = JSON.parse(readFileSync('public/data/jezero/sand.json', 'utf8')) as SandGrid
    const thermal = JSON.parse(readFileSync('public/data/jezero/thermal.json', 'utf8')) as RasterGrid
    const start = { lon: 77.450947, lat: 18.444543 }
    const target = { lon: 77.346647, lat: 18.495396 }

    const planned = planTraverseRoutes({
      dem,
      sand,
      thermal,
      start,
      target,
      duneNoGoAssumption: false,
    })

    const shortestTerrain = buildTerrainProfile(dem, planned.shortest.waypoints)
    const riskTerrain = buildTerrainProfile(dem, planned.riskAware.waypoints)
    const shortestSand = assessRouteSand(sand, shortestTerrain.samples)
    const riskSand = assessRouteSand(sand, riskTerrain.samples)

    expect(shortestTerrain.totalKm).toBeLessThanOrEqual(riskTerrain.totalKm)
    expect(riskSand.duneKm).toBeLessThanOrEqual(shortestSand.duneKm)
  })
})
