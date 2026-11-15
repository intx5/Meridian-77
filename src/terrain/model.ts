import type { LonLat, RasterGrid } from '@/types'
import { sampleElevation } from '@/domain/dem'

export const PROJECTION_RADIUS_M = 3396190
const DEG = Math.PI / 180
export const TILE_COUNT = 8
export interface TerrainFrame {
  lon: number
  lat: number
  width: number
  depth: number
  referenceM: number
  metresLon: number
  metresLat: number
  minM: number
  maxM: number
}
export interface ChunkData {
  positions: Float32Array
  normals: Float32Array
  uvs: Float32Array
  indices: Uint32Array
}

export function createFrame(grid: RasterGrid): TerrainFrame {
  const [w, s, e, n] = grid.bounds
  const lat = (s + n) / 2
  const metresLat = PROJECTION_RADIUS_M * DEG
  const metresLon = metresLat * Math.cos(lat * DEG)
  let minM = Infinity,
    maxM = -Infinity
  for (const v of grid.values)
    if (Number.isFinite(v) && v !== grid.noData) {
      minM = Math.min(minM, v)
      maxM = Math.max(maxM, v)
    }
  if (!Number.isFinite(minM)) throw new Error('The DEM has no measured elevations.')
  return {
    lon: (w + e) / 2,
    lat,
    width: (e - w) * metresLon,
    depth: (n - s) * metresLat,
    metresLon,
    metresLat,
    referenceM: Math.round((minM + maxM) / 200) * 100,
    minM,
    maxM,
  }
}
export function toLocal(f: TerrainFrame, p: LonLat) {
  return { x: (p.lon - f.lon) * f.metresLon, z: (f.lat - p.lat) * f.metresLat }
}
export function fromLocal(f: TerrainFrame, x: number, z: number): LonLat {
  return { lon: f.lon + x / f.metresLon, lat: f.lat - z / f.metresLat }
}

interface Lattice {
  heights: Float64Array
  missing: Uint32Array
  size: number
}
const lattices = new WeakMap<RasterGrid, Lattice>()
export function releaseTerrainCache(grid: RasterGrid) {
  lattices.delete(grid)
}

/** A conservative neighbourhood bounds even the coarse LOD triangles above the DEM. */
export function cameraFloor(
  grid: RasterGrid,
  frame: TerrainFrame,
  x: number,
  z: number,
  relief: number,
): number {
  const p = fromLocal(frame, x, z)
  const h = sampleElevation(grid, p.lon, p.lat)
  if (h === null) return (frame.maxM - frame.referenceM) * relief + 45
  const gx = Math.floor(((p.lon - grid.bounds[0]) / (grid.bounds[2] - grid.bounds[0])) * grid.width)
  const gy = Math.floor(((grid.bounds[3] - p.lat) / (grid.bounds[3] - grid.bounds[1])) * grid.height)
  let maximum = h
  for (let row = Math.max(0, gy - 5); row <= Math.min(grid.height - 1, gy + 5); row++)
    for (let col = Math.max(0, gx - 5); col <= Math.min(grid.width - 1, gx + 5); col++) {
      const v = grid.values[row * grid.width + col]
      if (Number.isFinite(v) && v !== grid.noData) maximum = Math.max(maximum, v)
    }
  return (maximum - frame.referenceM) * relief + 45
}
function lattice(grid: RasterGrid): Lattice {
  const cached = lattices.get(grid)
  if (cached) return cached
  const size = grid.width + 1
  const heights = new Float64Array(size * (grid.height + 1))
  const missing = new Uint32Array((size + 1) * (grid.height + 2))
  const [w, s, e, n] = grid.bounds
  for (let y = 0; y <= grid.height; y++)
    for (let x = 0; x <= grid.width; x++) {
      const h = sampleElevation(grid, w + ((e - w) * x) / grid.width, n - ((n - s) * y) / grid.height)
      heights[y * size + x] = h ?? NaN
      const i = (y + 1) * (size + 1) + x + 1
      missing[i] = (h === null ? 1 : 0) + missing[i - 1] + missing[i - size - 1] - missing[i - size - 2]
    }
  const result = { heights, missing, size }
  lattices.set(grid, result)
  return result
}
function hasMissing(l: Lattice, x0: number, y0: number, x1: number, y1: number) {
  const s = l.size + 1,
    p = l.missing
  return p[(y1 + 1) * s + x1 + 1] - p[y0 * s + x1 + 1] - p[(y1 + 1) * s + x0] + p[y0 * s + x0] > 0
}

/** Finest rendered triangle height, in original areoid metres. No relief multiplier here. */
export function sampleSurface(grid: RasterGrid, _frame: TerrainFrame, p: LonLat): number | null {
  const [w, s, e, n] = grid.bounds
  if (p.lon < w || p.lon > e || p.lat < s || p.lat > n) return null
  const fx = ((p.lon - w) / (e - w)) * grid.width,
    fy = ((n - p.lat) / (n - s)) * grid.height
  const x = Math.min(grid.width - 1, Math.floor(fx)),
    y = Math.min(grid.height - 1, Math.floor(fy))
  const l = lattice(grid)
  if (hasMissing(l, x, y, x + 1, y + 1)) return null
  const a = l.heights[y * l.size + x],
    b = l.heights[y * l.size + x + 1],
    c = l.heights[(y + 1) * l.size + x],
    d = l.heights[(y + 1) * l.size + x + 1]
  const tx = fx - x,
    ty = fy - y
  return tx + ty <= 1 ? a + (b - a) * tx + (c - a) * ty : d + (c - d) * (1 - tx) + (b - d) * (1 - ty)
}

/** Chunk boundaries always retain full resolution, so mixed LODs meet without fabricated skirts. */
export function buildChunk(
  grid: RasterGrid,
  f: TerrainFrame,
  col: number,
  row: number,
  count: number,
  stride: number,
): ChunkData {
  if (grid.width % count || grid.height % count || ![1, 2, 4].includes(stride))
    throw new Error('Unsupported terrain chunk grid')
  const l = lattice(grid),
    cw = grid.width / count,
    ch = grid.height / count
  const ox = col * cw,
    oy = row * ch
  const positions: number[] = [],
    normals: number[] = [],
    uvs: number[] = [],
    indices: number[] = []
  const vertices = new Map<string, number>()
  const dx = f.width / grid.width,
    dz = f.depth / grid.height
  function vertex(x: number, y: number) {
    const key = `${x}/${y}`
    const old = vertices.get(key)
    if (old !== undefined) return old
    const h = l.heights[y * l.size + x]
    const i = positions.length / 3
    positions.push(x * dx - f.width / 2, Number.isFinite(h) ? h - f.referenceM : 0, y * dz - f.depth / 2)
    const xl = Math.max(0, x - 1),
      xr = Math.min(grid.width, x + 1),
      yu = Math.max(0, y - 1),
      yd = Math.min(grid.height, y + 1)
    const height = (a: number, b: number) =>
      Number.isFinite(l.heights[b * l.size + a]) ? l.heights[b * l.size + a] : h
    const nx = -(height(xr, y) - height(xl, y)) / ((xr - xl) * dx),
      nz = -(height(x, yd) - height(x, yu)) / ((yd - yu) * dz)
    const length = Math.hypot(nx, 1, nz)
    normals.push(
      Number.isFinite(nx) ? nx / length : 0,
      Number.isFinite(length) ? 1 / length : 1,
      Number.isFinite(nz) ? nz / length : 0,
    )
    uvs.push((x - ox) / cw, 1 - (y - oy) / ch)
    vertices.set(key, i)
    return i
  }
  // Include north-west first for stable UV semantics even if its cells are absent.
  vertex(ox, oy)
  for (let y = oy; y < oy + ch; y += stride)
    for (let x = ox; x < ox + cw; x += stride) {
      const x1 = Math.min(x + stride, ox + cw),
        y1 = Math.min(y + stride, oy + ch)
      if (hasMissing(l, x, y, x1, y1)) continue
      if (stride > 1 && (x === ox || y === oy || x1 === ox + cw || y1 === oy + ch)) {
        const ring: number[] = []
        const top = y === oy ? 1 : stride,
          right = x1 === ox + cw ? 1 : stride,
          bottom = y1 === oy + ch ? 1 : stride,
          left = x === ox ? 1 : stride
        for (let a = x; a < x1; a += top) ring.push(vertex(a, y))
        for (let b = y; b < y1; b += right) ring.push(vertex(x1, b))
        for (let a = x1; a > x; a -= bottom) ring.push(vertex(a, y1))
        for (let b = y1; b > y; b -= left) ring.push(vertex(x, b))
        const centre = vertex((x + x1) / 2, (y + y1) / 2)
        for (let k = 0; k < ring.length; k++) indices.push(centre, ring[(k + 1) % ring.length], ring[k])
      } else {
        const a = vertex(x, y),
          b = vertex(x1, y),
          c = vertex(x, y1),
          d = vertex(x1, y1)
        indices.push(a, c, b, b, c, d)
      }
    }
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    uvs: new Float32Array(uvs),
    indices: new Uint32Array(indices),
  }
}
