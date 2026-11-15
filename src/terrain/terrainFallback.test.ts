import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { RasterGrid } from '@/types'
import { buildChunk, createFrame, sampleSurface } from './model'
import { fillTerrainGaps } from './terrainFallback'

describe('MOLA display terrain', () => {
  it('fills the Jezero gaps while retaining the native DEM for the route model', () => {
    const dem = JSON.parse(readFileSync('public/data/jezero/dem.json', 'utf8')) as RasterGrid
    const mola = JSON.parse(readFileSync('public/data/jezero/terrain/mola-dem.json', 'utf8')) as RasterGrid
    const point = { lon: 77.3305, lat: 18.5405 }
    const frame = createFrame(dem)
    expect(sampleSurface(dem, frame, point)).toBeNull()

    const terrain = fillTerrainGaps(dem, mola)
    expect(terrain.values).not.toContain(dem.noData)
    expect(dem.values.filter((value) => value === dem.noData)).toHaveLength(81803)
    expect(dem.values.every((value, index) => value === dem.noData || terrain.values[index] === value)).toBe(true)
    expect(sampleSurface(terrain, frame, point)).not.toBeNull()
    expect(buildChunk(terrain, frame, 1, 1, 8, 1).indices).toHaveLength(128 * 128 * 6)
    expect(sampleSurface(dem, frame, point)).toBeNull()
  })

  it('matches the measured edge when the coarse grid differs in height', () => {
    const dem: RasterGrid = {
      bounds: [77, 18, 77.01, 18.01], width: 3, height: 3, noData: -9999,
      values: [100, 100, 100, 100, -9999, 100, 100, 100, 100],
    }
    const mola: RasterGrid = { ...dem, width: 1, height: 1, values: [130] }
    expect(fillTerrainGaps(dem, mola).values[4]).toBeCloseTo(100)
  })

  it('leaves gaps beyond the supplied MOLA coverage empty', () => {
    const dem: RasterGrid = {
      bounds: [77, 18, 77.02, 18.01], width: 2, height: 1, noData: -9999,
      values: [100, -9999],
    }
    const mola: RasterGrid = { ...dem, bounds: [77, 18, 77.01, 18.01], width: 1, values: [130] }
    expect(fillTerrainGaps(dem, mola)).toBe(dem)
  })
})
