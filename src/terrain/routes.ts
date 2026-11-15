import type { LonLat, RasterGrid } from '@/types'
import { sampleElevation } from '@/domain/dem'
import { haversineKm } from '@/domain/geo'
import { sampleSurface, toLocal, type TerrainFrame } from './model'

export type RouteLine = { color: string; points: [number, number, number][] }
export function drapeRoute(
  grid: RasterGrid,
  frame: TerrainFrame,
  route: LonLat[],
  relief: number,
  colorOverride?: string,
  heightOffset = 0.8,
) {
  const lines: RouteLine[] = [],
    tiles = new Set<string>()
  let unknown = 0
  const [w, s, e, n] = grid.bounds
  const gridPoint = (p: LonLat) => ({
    x: ((p.lon - w) / (e - w)) * grid.width,
    y: ((n - p.lat) / (n - s)) * grid.height,
  })
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1],
      b = route[i],
      ga = gridPoint(a),
      gb = gridPoint(b)
    const times = new Set([0, 1])
    // Cross every triangle boundary (vertical, horizontal and x+y diagonal).
    for (const [start, end] of [
      [ga.x, gb.x],
      [ga.y, gb.y],
      [ga.x + ga.y, gb.x + gb.y],
    ]) {
      if (start === end) continue
      for (let j = Math.floor(Math.min(start, end)) + 1; j < Math.max(start, end); j++)
        times.add((j - start) / (end - start))
    }
    const sorted = [...times].sort((x, y) => x - y)
    const at = (t: number) => ({ lon: a.lon + (b.lon - a.lon) * t, lat: a.lat + (b.lat - a.lat) * t })
    for (let j = 1; j < sorted.length; j++) {
      const start = at(sorted[j - 1]),
        end = at(sorted[j]),
        mid = at((sorted[j - 1] + sorted[j]) / 2)
      const ha = sampleSurface(grid, frame, start),
        hb = sampleSurface(grid, frame, end),
        hm = sampleSurface(grid, frame, mid)
      if (ha === null || hb === null || hm === null) {
        unknown++
        continue
      }
      const g = gridPoint(mid)
      tiles.add(
        `${Math.min(7, Math.floor((g.x / grid.width) * 8))}-${Math.min(7, Math.floor((g.y / grid.height) * 8))}`,
      )
      const ea = sampleElevation(grid, start.lon, start.lat),
        eb = sampleElevation(grid, end.lon, end.lat)
      const distance = haversineKm(start, end) * 1000
      const slope =
        ea === null || eb === null
          ? 0
          : (Math.atan(Math.abs(eb - ea) / Math.max(distance, 0.001)) * 180) / Math.PI
      const color = colorOverride ?? (slope >= 25 ? '#ff8172' : slope >= 15 ? '#efc46b' : '#ff6b3d')
      const pa = toLocal(frame, start),
        pb = toLocal(frame, end)
      const p: [number, number, number] = [pa.x, (ha - frame.referenceM) * relief + heightOffset, pa.z]
      const q: [number, number, number] = [pb.x, (hb - frame.referenceM) * relief + heightOffset, pb.z]
      const last = lines.at(-1),
        lastPoint = last?.points.at(-1)
      if (
        last &&
        last.color === color &&
        lastPoint &&
        Math.hypot(lastPoint[0] - p[0], lastPoint[2] - p[2]) < 0.001
      )
        last.points.push(q)
      else lines.push({ color, points: [p, q] })
    }
  }
  return { lines, tiles, unknown }
}
