import type { LonLat, RasterGrid } from '@/types'
import { haversineKm, interpolateSegment } from './geo'

export interface DemSample extends LonLat {
  distanceKm: number
  elevationM: number | null
}

export interface HazardSegment {
  fromKm: number
  toKm: number
  slopeDeg: number
  elevationM: number
}

export interface RouteTerrain {
  samples: DemSample[]
  totalKm: number
  unknownFraction: number
  elevationGainM: number
  elevationLossM: number
  maxSlopeDeg: number
  meanSlopeDeg: number
  hazardSegments: HazardSegment[]
}

export interface TerrainOptions {
  spacingKm?: number
  cautionSlopeDeg?: number
  noGoSlopeDeg?: number
}

export interface SteepestSegment {
  from: LonLat
  to: LonLat
  slopeDeg: number
}

/** The sampled segment with the highest absolute slope, for map highlighting. */
export function steepestSegment(terrain: RouteTerrain): SteepestSegment | null {
  let best: SteepestSegment | null = null
  for (let i = 1; i < terrain.samples.length; i += 1) {
    const previous = terrain.samples[i - 1]
    const current = terrain.samples[i]
    if (previous.elevationM === null || current.elevationM === null) continue
    const horizontalM = (current.distanceKm - previous.distanceKm) * 1000
    if (horizontalM <= 0.001) continue
    const slopeDeg = (Math.atan(Math.abs(current.elevationM - previous.elevationM) / horizontalM) * 180) / Math.PI
    if (!best || slopeDeg > best.slopeDeg) {
      best = {
        from: { lon: previous.lon, lat: previous.lat },
        to: { lon: current.lon, lat: current.lat },
        slopeDeg,
      }
    }
  }
  return best
}

const EMPTY: RouteTerrain = {
  samples: [],
  totalKm: 0,
  unknownFraction: 0,
  elevationGainM: 0,
  elevationLossM: 0,
  maxSlopeDeg: 0,
  meanSlopeDeg: 0,
  hazardSegments: [],
}

function isNoData(grid: RasterGrid, value: number): boolean {
  return value === grid.noData || !Number.isFinite(value)
}

/** Bilinear sample of a north-first raster. Any invalid neighbour makes the point unknown. */
export function sampleElevation(grid: RasterGrid, lon: number, lat: number): number | null {
  const [minLon, minLat, maxLon, maxLat] = grid.bounds
  if (lon < minLon || lon > maxLon || lat < minLat || lat > maxLat) return null

  const fx = ((lon - minLon) / (maxLon - minLon)) * grid.width - 0.5
  const fy = ((maxLat - lat) / (maxLat - minLat)) * grid.height - 0.5
  const x = Math.min(grid.width - 1, Math.max(0, fx))
  const y = Math.min(grid.height - 1, Math.max(0, fy))
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const x1 = Math.min(grid.width - 1, x0 + 1)
  const y1 = Math.min(grid.height - 1, y0 + 1)
  const tx = x - x0
  const ty = y - y0

  const v00 = grid.values[y0 * grid.width + x0]
  const v10 = grid.values[y0 * grid.width + x1]
  const v01 = grid.values[y1 * grid.width + x0]
  const v11 = grid.values[y1 * grid.width + x1]
  if ([v00, v10, v01, v11].some((value) => isNoData(grid, value))) return null

  return (
    v00 * (1 - tx) * (1 - ty) +
    v10 * tx * (1 - ty) +
    v01 * (1 - tx) * ty +
    v11 * tx * ty
  )
}

export function buildTerrainProfile(
  grid: RasterGrid,
  route: LonLat[],
  options: TerrainOptions = {},
): RouteTerrain {
  if (route.length < 2) return EMPTY

  const spacingKm =
    options.spacingKm ?? Math.max(0.005, (grid.bounds[3] - grid.bounds[1]) * 111175 / grid.height / 2000)
  const caution = options.cautionSlopeDeg ?? 15
  const path: LonLat[] = []
  for (let i = 1; i < route.length; i += 1) {
    path.push(...interpolateSegment(route[i - 1], route[i], spacingKm))
  }
  path.push(route.at(-1)!)

  const samples: DemSample[] = []
  let distanceKm = 0
  for (let i = 0; i < path.length; i += 1) {
    if (i > 0) distanceKm += haversineKm(path[i - 1], path[i])
    samples.push({
      ...path[i],
      distanceKm,
      elevationM: sampleElevation(grid, path[i].lon, path[i].lat),
    })
  }

  let gain = 0
  let loss = 0
  let maxSlope = 0
  let slopeSum = 0
  let slopeCount = 0
  let unknown = 0
  const hazards: HazardSegment[] = []

  for (let i = 0; i < samples.length; i += 1) {
    if (samples[i].elevationM === null) unknown += 1
    if (i === 0) continue
    const prev = samples[i - 1]
    if (prev.elevationM === null || samples[i].elevationM === null) continue
    const elevationM = samples[i].elevationM
    const deltaH = elevationM! - prev.elevationM!
    const horizontalM = (samples[i].distanceKm - prev.distanceKm) * 1000
    if (deltaH > 0) gain += deltaH
    else loss += Math.abs(deltaH)
    if (horizontalM > 0.001) {
      const slope = (Math.atan(Math.abs(deltaH) / horizontalM) * 180) / Math.PI
      maxSlope = Math.max(maxSlope, slope)
      slopeSum += slope
      slopeCount += 1
      if (slope >= caution) {
        hazards.push({
          fromKm: prev.distanceKm,
          toKm: samples[i].distanceKm,
          slopeDeg: slope,
          elevationM: elevationM!,
        })
      }
    }
  }

  return {
    samples,
    totalKm: distanceKm,
    unknownFraction: samples.length ? unknown / samples.length : 0,
    elevationGainM: Math.round(gain),
    elevationLossM: Math.round(loss),
    maxSlopeDeg: maxSlope,
    meanSlopeDeg: slopeCount ? slopeSum / slopeCount : 0,
    hazardSegments: hazards,
  }
}
