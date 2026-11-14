import { describe, expect, it } from 'vitest'
import type { LayersManifest, RasterGrid, Waypoint } from '@/types'
import { validateMissionData } from './data'

const manifest: LayersManifest = {
  region: {
    name: 'Jezero',
    bounds: [77.3, 18.4, 77.5, 18.6],
    projectedBoundsM: [0, 0, 10000, 10000],
    coordinateSystem: 'planetocentric',
  },
  layers: (['optical', 'topography', 'geology', 'thermal', 'mineralogy'] as const).map((id) => ({
    id,
    label: id,
    imageUrl: `/data/${id}.webp`,
    sourceUrl: 'https://example.com',
    resolution: '1 m',
    legend: [],
  })),
  elevation: { url: '/data/dem.json', sourceUrl: 'https://example.com', coveragePercent: 90, verticalReference: 'areoid' },
}

const dem: RasterGrid = {
  bounds: [77.3, 18.4, 77.5, 18.6],
  width: 2,
  height: 2,
  noData: -9999,
  values: [1, 2, 3, 4],
}

const waypoint: Waypoint = {
  id: 'wp-1',
  name: 'Site',
  lon: 77.4,
  lat: 18.5,
  kind: 'science',
  imageUrl: null,
  imageCredit: 'NASA',
  sourceUrl: 'https://example.com',
  minerals: [],
  note: '',
}

describe('mission data contract', () => {
  it('accepts a complete manifest, DEM and waypoint set', () => {
    expect(() => validateMissionData(manifest, dem, [waypoint])).not.toThrow()
  })

  it('reports a DEM whose value count does not match its grid', () => {
    expect(() => validateMissionData(manifest, { ...dem, values: [1, 2] }, [waypoint])).toThrow(
      /dem.json: expected 4 values/i,
    )
  })

  it('reports a layer that uses different bounds from the region', () => {
    const shifted = { ...manifest, layers: manifest.layers.map((l, i) => (i === 0 ? { ...l, bounds: [0, 0, 1, 1] } : l)) }
    expect(() => validateMissionData(shifted as LayersManifest, dem, [waypoint])).toThrow(/bounds do not match/i)
  })

  it('reports a missing required layer id', () => {
    const incomplete = { ...manifest, layers: manifest.layers.filter((l) => l.id !== 'thermal') }
    expect(() => validateMissionData(incomplete as LayersManifest, dem, [waypoint])).toThrow(/missing layer: thermal/i)
  })

  it('reports waypoints outside the region', () => {
    expect(() => validateMissionData(manifest, dem, [{ ...waypoint, lon: 0 }])).toThrow(/outside the region/i)
  })
})
