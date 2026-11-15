import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { buildChunk, createFrame, fromLocal, sampleSurface, toLocal } from './model'
import type { RasterGrid } from '@/types'
import { useMissionStore } from '@/store/useMissionStore'
import { buildTerrainProfile } from '@/domain/dem'

const grid: RasterGrid = {
  bounds: [77, 18, 77.01, 18.01],
  width: 8,
  height: 8,
  noData: -9999,
  values: Array(64).fill(-2500),
}

describe('planar Mars terrain', () => {
  it('uses Mars local ground metres, east x and south z with reversible coordinates', () => {
    const f = createFrame(grid)
    const p = toLocal(f, { lon: 77.005, lat: 18.005 })
    expect(p.x).toBeCloseTo(0, 6)
    expect(p.z).toBeCloseTo(0, 6)
    expect(toLocal(f, { lon: 77.01, lat: 18.01 }).x).toBeCloseTo(281.855, 2)
    expect(toLocal(f, { lon: 77.01, lat: 18.01 }).z).toBeCloseTo(-296.373, 2)
    expect(fromLocal(f, 0, 0).lon).toBeCloseTo(77.005, 10)
    expect(fromLocal(f, 0, 0).lat).toBeCloseTo(18.005, 10)
  })
  it('maps north to the top of the texture and shares exact chunk edges across LOD', () => {
    const f = createFrame(grid)
    const a = buildChunk(grid, f, 0, 0, 2, 1)
    const b = buildChunk(grid, f, 1, 0, 2, 2)
    const edge = (p: Float32Array) =>
      Array.from({ length: p.length / 3 }, (_, i) => [p[i * 3], p[i * 3 + 1], p[i * 3 + 2]])
        .filter((v) => Math.abs(v[0]) < 0.001)
        .map((v) => v[2])
        .sort((x, y) => x - y)
    expect(edge(a.positions)).toEqual(edge(b.positions))
    expect(Array.from(a.uvs.slice(0, 2))).toEqual([0, 1])
    expect(a.indices.length).toBeGreaterThan(0)
  })
  it('does not bridge interior missing DEM pixels at coarse LOD', () => {
    const missing = { ...grid, values: grid.values.map((v, i) => (i === 27 ? -9999 : v)) }
    const f = createFrame(missing)
    const full = buildChunk(grid, f, 0, 0, 1, 4)
    const holes = buildChunk(missing, f, 0, 0, 1, 4)
    expect(holes.indices.length).toBeLessThan(full.indices.length)
    expect(sampleSurface(missing, f, { lon: 77.004375, lat: 18.005625 })).toBeNull()
    for (const i of holes.indices) expect(Number.isFinite(holes.positions[i * 3 + 1])).toBe(true)
  })
  it('uses the actual displayed triangle height instead of inventing an unknown height', () => {
    const f = createFrame(grid)
    expect(sampleSurface(grid, f, { lon: 77.005, lat: 18.005 })).toBe(-2500)
    expect(sampleSurface(grid, f, { lon: 76, lat: 18 })).toBeNull()
  })
  it('round trips real waypoints and leaves route/analysis unchanged by viewing options', () => {
    const dem = JSON.parse(readFileSync('public/data/jezero/dem.json', 'utf8')) as RasterGrid
    const f = createFrame(dem)
    const point = { lon: 77.450947, lat: 18.444543 }
    const local = toLocal(f, point)
    expect(fromLocal(f, local.x, local.z).lon).toBeCloseTo(point.lon, 10)
    expect(fromLocal(f, local.x, local.z).lat).toBeCloseTo(point.lat, 10)
    expect(sampleSurface(dem, f, point)).toBeCloseTo(-2567, 0)
    useMissionStore.getState().loadPresetRoute('A')
    const route = useMissionStore.getState().route
    const before = buildTerrainProfile(dem, route)
    useMissionStore.getState().setViewMode('3d')
    useMissionStore.getState().setRelief(3)
    expect(useMissionStore.getState().route).toBe(route)
    expect(buildTerrainProfile(dem, route)).toEqual(before)
    useMissionStore.getState().setViewMode('2d')
    useMissionStore.getState().setRelief(1)
  })
})
