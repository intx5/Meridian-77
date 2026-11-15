import { sampleElevation } from '@/domain/dem'
import type { RasterGrid } from '@/types'

/** Fill gaps in a display-only copy using the lower-resolution MOLA grid. */
export function fillTerrainGaps(dem: RasterGrid, mola: RasterGrid): RasterGrid {
  const { bounds: [west, south, east, north], width, height } = dem
  const dx = (east - west) / width
  const dy = (north - south) / height
  const isMeasured = (index: number) =>
    Number.isFinite(dem.values[index]) && dem.values[index] !== dem.noData
  const sampleMola = (index: number) => sampleElevation(
    mola,
    west + (index % width + 0.5) * dx,
    north - (Math.floor(index / width) + 0.5) * dy,
  )
  const values = dem.values.slice()
  const filled: number[] = []
  for (let index = 0; index < values.length; index++) {
    if (isMeasured(index)) continue
    const heightM = sampleMola(index)
    if (heightM === null) continue
    values[index] = heightM
    filled.push(index)
  }
  if (!filled.length) return dem

  // Match the two surfaces at the boundary by diffusing their local height
  // difference a short distance into the filled area. Keep measured samples exact.
  const neighbours = new Int32Array(filled.length * 4)
  let correction = new Float32Array(values.length)
  for (const [ordinal, index] of filled.entries()) {
    const col = index % width
    const row = Math.floor(index / width)
    const adjacent = [
      col === 0 ? index : index - 1,
      col === width - 1 ? index : index + 1,
      row === 0 ? index : index - width,
      row === height - 1 ? index : index + width,
    ]
    neighbours.set(adjacent, ordinal * 4)
    for (const neighbour of adjacent) {
      if (!isMeasured(neighbour)) continue
      const coarseHeight = sampleMola(neighbour)
      if (coarseHeight !== null) correction[neighbour] = dem.values[neighbour] - coarseHeight
    }
  }

  let next = correction.slice()
  for (let pass = 0; pass < 96; pass++) {
    for (let ordinal = 0; ordinal < filled.length; ordinal++) {
      const i = ordinal * 4
      next[filled[ordinal]] = (correction[neighbours[i]] + correction[neighbours[i + 1]] +
        correction[neighbours[i + 2]] + correction[neighbours[i + 3]]) / 4
    }
    const previous = correction
    correction = next
    next = previous
  }
  for (const index of filled) values[index] += correction[index]
  return { ...dem, values }
}
