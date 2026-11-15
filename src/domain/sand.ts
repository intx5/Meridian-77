import type {
  LonLat,
  RasterGrid,
  RouteSandAssessment,
  SandClassCode,
  SandFeatureCollection,
  SandGrid,
  SandHazardSegment,
  SandKind,
} from '@/types'
import { MIN_TRAVERSE_KM } from '@/config/eva'
import {
  type CandidateRouteId,
  DEFAULT_LOW_RISK_WEIGHTS,
  type RiskWeights,
  validateRiskWeights,
} from './aiPlannerSchema'
import { buildTerrainProfile, type DemSample, rasterCellCount, type RouteTerrain, sampleElevation } from './dem'
import { haversineKm } from './geo'

const CODE_TO_KIND: Record<1 | 2 | 3, SandKind> = {
  1: 'dune_field',
  2: 'sand_sheet',
  3: 'uncertain_aeolian',
}

export const EMPTY_SAND_ASSESSMENT: RouteSandAssessment = {
  duneKm: 0,
  sandSheetKm: 0,
  uncertainKm: 0,
  duneFraction: 0,
  sandSheetFraction: 0,
  uncertainFraction: 0,
  totalSandFraction: 0,
  hazardSegments: [],
}

/** Nearest-cell lookup on the north-first co-registered sand classification grid. */
export function sampleSandClass(grid: SandGrid, lon: number, lat: number): SandClassCode {
  const [minLon, minLat, maxLon, maxLat] = grid.bounds
  if (lon < minLon || lon > maxLon || lat < minLat || lat > maxLat) return 0
  const col = Math.min(grid.width - 1, Math.max(0, Math.floor(((lon - minLon) / (maxLon - minLon)) * grid.width)))
  const row = Math.min(
    grid.height - 1,
    Math.max(0, Math.floor(((maxLat - lat) / (maxLat - minLat)) * grid.height)),
  )
  const raw = grid.values[row * grid.width + col]
  return raw === 1 || raw === 2 || raw === 3 ? raw : 0
}

/** Evaluate sand dune, sand sheet, and uncertain aeolian exposure along a sampled route. */
export function assessRouteSand(
  grid: SandGrid | null | undefined,
  samples: DemSample[],
): RouteSandAssessment {
  if (!grid || samples.length < 2) return EMPTY_SAND_ASSESSMENT

  let duneKm = 0
  let sandSheetKm = 0
  let uncertainKm = 0
  const totalKm = samples.at(-1)!.distanceKm
  if (totalKm <= 0) return EMPTY_SAND_ASSESSMENT

  const hazardSegments: SandHazardSegment[] = []

  for (let i = 1; i < samples.length; i += 1) {
    const prev = samples[i - 1]
    const curr = samples[i]
    const segKm = Math.max(0, curr.distanceKm - prev.distanceKm)
    if (segKm <= 0) continue

    const midLon = (prev.lon + curr.lon) / 2
    const midLat = (prev.lat + curr.lat) / 2
    const code = sampleSandClass(grid, midLon, midLat)
    if (code === 0) continue

    if (code === 1) duneKm += segKm
    else if (code === 2) sandSheetKm += segKm
    else uncertainKm += segKm

    const kind = CODE_TO_KIND[code]
    const last = hazardSegments.at(-1)
    if (last && last.kind === kind && Math.abs(last.toKm - prev.distanceKm) < 1e-5) {
      last.toKm = curr.distanceKm
      last.to = { lon: curr.lon, lat: curr.lat }
    } else {
      hazardSegments.push({
        fromKm: prev.distanceKm,
        toKm: curr.distanceKm,
        kind,
        from: { lon: prev.lon, lat: prev.lat },
        to: { lon: curr.lon, lat: curr.lat },
      })
    }
  }

  const duneFraction = Math.min(1, duneKm / totalKm)
  const sandSheetFraction = Math.min(1, sandSheetKm / totalKm)
  const uncertainFraction = Math.min(1, uncertainKm / totalKm)

  return {
    duneKm: Number(duneKm.toFixed(3)),
    sandSheetKm: Number(sandSheetKm.toFixed(3)),
    uncertainKm: Number(uncertainKm.toFixed(3)),
    duneFraction,
    sandSheetFraction,
    uncertainFraction,
    totalSandFraction: Math.min(1, duneFraction + sandSheetFraction + uncertainFraction),
    hazardSegments,
  }
}

export interface PlanRoutesInput {
  dem: RasterGrid
  sand: SandGrid
  thermal?: RasterGrid | null
  start: LonLat
  target: LonLat
  duneNoGoAssumption?: boolean
  aiWeights?: RiskWeights | null
  viaWaypoints?: LonLat[]
}

export interface PlannedRoute {
  id: CandidateRouteId
  mode: 'shortest' | 'risk-aware' | 'ai-optimized'
  label: string
  color: string
  waypoints: LonLat[]
  reachable: boolean
  riskCost: number
  weights: RiskWeights
}

export interface RouteSafetyVerification {
  valid: boolean
  rejected: boolean
  reachable: boolean
  targetReached: boolean
  rejectionReasons: string[]
}

function cellToLonLat(
  bounds: [number, number, number, number],
  width: number,
  height: number,
  col: number,
  row: number,
): LonLat {
  const [minLon, minLat, maxLon, maxLat] = bounds
  return {
    lon: minLon + ((col + 0.5) / width) * (maxLon - minLon),
    lat: maxLat - ((row + 0.5) / height) * (maxLat - minLat),
  }
}

function lonLatToCell(
  bounds: [number, number, number, number],
  width: number,
  height: number,
  pt: LonLat,
): [number, number] {
  const [minLon, minLat, maxLon, maxLat] = bounds
  const col = Math.min(width - 1, Math.max(0, Math.floor(((pt.lon - minLon) / (maxLon - minLon)) * width)))
  const row = Math.min(height - 1, Math.max(0, Math.floor(((maxLat - pt.lat) / (maxLat - minLat)) * height)))
  return [col, row]
}

interface AStarResult {
  cells: [number, number][]
  reachable: boolean
  totalCost: number
}

function runAStar(
  width: number,
  height: number,
  startCell: [number, number],
  targetCell: [number, number],
  cellWeight: (col: number, row: number) => number,
  canTraverseStep?: (cx: number, cy: number, nx: number, ny: number, stepLen: number) => boolean,
  stepWeightFn?: (cx: number, cy: number, nx: number, ny: number, stepLen: number) => number,
): AStarResult {
  const n = width * height
  const startIdx = startCell[1] * width + startCell[0]
  const targetIdx = targetCell[1] * width + targetCell[0]
  const startW = cellWeight(startCell[0], startCell[1])
  const targetW = cellWeight(targetCell[0], targetCell[1])

  if (!Number.isFinite(startW) || startW >= 1e6 || !Number.isFinite(targetW) || targetW >= 1e6) {
    return { cells: [startCell, targetCell], reachable: false, totalCost: Infinity }
  }
  if (startIdx === targetIdx) {
    return { cells: [startCell], reachable: true, totalCost: 0 }
  }

  const gScore = new Float64Array(n).fill(Infinity)
  const parent = new Int32Array(n).fill(-1)
  const closed = new Uint8Array(n)

  // Keep queued priorities fixed. Updating the score of an entry already in the
  // heap would break its ordering and can close a cell before its cheapest path.
  type QueueEntry = { node: number; cost: number; priority: number }
  const heap: QueueEntry[] = []
  const push = (entry: QueueEntry) => {
    heap.push(entry)
    let idx = heap.length - 1
    while (idx > 0) {
      const p = (idx - 1) >> 1
      if (heap[p].priority <= entry.priority) break
      heap[idx] = heap[p]
      idx = p
    }
    heap[idx] = entry
  }
  const pop = (): QueueEntry | undefined => {
    if (!heap.length) return undefined
    const top = heap[0]
    const last = heap.pop()!
    if (heap.length > 0) {
      heap[0] = last
      let i = 0
      while (true) {
        const l = (i << 1) + 1
        const r = l + 1
        let s = i
        if (l < heap.length && heap[l].priority < heap[s].priority) s = l
        if (r < heap.length && heap[r].priority < heap[s].priority) s = r
        if (s === i) break
        const t = heap[i]
        heap[i] = heap[s]
        heap[s] = t
        i = s
      }
    }
    return top
  }

  gScore[startIdx] = 0
  push({ node: startIdx, cost: 0, priority: Math.hypot(targetCell[0] - startCell[0], targetCell[1] - startCell[1]) })

  const dirs: [number, number, number][] = [
    [1, 0, 1],
    [-1, 0, 1],
    [0, 1, 1],
    [0, -1, 1],
    [1, 1, Math.SQRT2],
    [1, -1, Math.SQRT2],
    [-1, 1, Math.SQRT2],
    [-1, -1, Math.SQRT2],
  ]

  while (heap.length > 0) {
    const { node: current, cost } = pop()!
    if (closed[current] || cost !== gScore[current]) continue
    if (current === targetIdx) break
    closed[current] = 1

    const cx = current % width
    const cy = Math.floor(current / width)
    const wCurr = cellWeight(cx, cy)

    for (const [dx, dy, stepLen] of dirs) {
      const nx = cx + dx
      const ny = cy + dy
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue
      const next = ny * width + nx
      if (closed[next]) continue

      if (canTraverseStep && !canTraverseStep(cx, cy, nx, ny, stepLen)) continue

      const wNext = cellWeight(nx, ny)
      if (!Number.isFinite(wNext) || wNext >= 1e6) continue

      const extraStep = stepWeightFn ? stepWeightFn(cx, cy, nx, ny, stepLen) : 0
      const w = 0.5 * (wCurr + wNext) + extraStep
      const tentative = gScore[current] + stepLen * w
      if (tentative < gScore[next]) {
        parent[next] = current
        gScore[next] = tentative
        push({ node: next, cost: tentative, priority: tentative + Math.hypot(targetCell[0] - nx, targetCell[1] - ny) })
      }
    }
  }

  const cells: [number, number][] = []
  let curr = targetIdx
  if (parent[curr] === -1 && curr !== startIdx) {
    return { cells: [startCell, targetCell], reachable: false, totalCost: Infinity }
  }
  while (curr !== -1) {
    cells.push([curr % width, Math.floor(curr / width)])
    if (curr === startIdx) break
    curr = parent[curr]
  }
  return { cells: cells.reverse(), reachable: true, totalCost: gScore[targetIdx] }
}

function simplifyCellPath(
  cells: [number, number][],
  cellWeight: (col: number, row: number) => number,
  maxAllowedWeight: number,
  preserveContours = false,
): [number, number][] {
  if (cells.length <= 2) return cells

  const pruned: [number, number][] = [cells[0]]
  let anchor = 0
  while (anchor < cells.length - 1) {
    let farthest = anchor + 1
    for (let probe = cells.length - 1; probe > anchor + 1; probe -= 1) {
      const [x0, y0] = cells[anchor]
      const [x1, y1] = cells[probe]
      const steps = Math.max(2, Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2))

      let pathSum = 0
      let pathMax = 0
      for (let k = anchor; k <= probe; k += 1) {
        const pw = cellWeight(cells[k][0], cells[k][1])
        pathSum += pw
        if (pw > pathMax) pathMax = pw
      }
      const pathMean = pathSum / (probe - anchor + 1)
      const weightCap = preserveContours ? Math.min(maxAllowedWeight, pathMax * 1.06) : maxAllowedWeight

      let clear = true
      let chordSum = 0
      for (let s = 1; s < steps; s += 1) {
        const t = s / steps
        const cx = Math.round(x0 + (x1 - x0) * t)
        const cy = Math.round(y0 + (y1 - y0) * t)
        const cw = cellWeight(cx, cy)
        chordSum += cw
        if (cw > weightCap) {
          clear = false
          break
        }
      }
      if (clear && preserveContours) {
        const chordMean = chordSum / (steps - 1)
        if (chordMean > pathMean * 1.015) {
          clear = false
        }
      }
      if (clear) {
        farthest = probe
        break
      }
    }
    pruned.push(cells[farthest])
    anchor = farthest
  }

  const maxPoints = preserveContours ? 64 : 28
  if (pruned.length <= maxPoints) return pruned
  const decimated: [number, number][] = [pruned[0]]
  for (let i = 1; i < maxPoints - 1; i += 1) {
    const idx = Math.round((i / (maxPoints - 1)) * (pruned.length - 1))
    decimated.push(pruned[idx])
  }
  decimated.push(pruned.at(-1)!)
  return decimated
}

/**
 * Compute deterministic composite risk cost for any sampled traverse using:
 *   Cost = DistanceCost + SlopePenalty + SandPenalty + RockPenalty + UncertaintyPenalty
 */
export function computeRouteRiskCost({
  terrain,
  sand,
  thermal,
  weights = DEFAULT_LOW_RISK_WEIGHTS,
  duneNoGoAssumption = false,
}: {
  terrain: RouteTerrain
  sand: RouteSandAssessment
  thermal?: RasterGrid | null
  weights?: RiskWeights
  duneNoGoAssumption?: boolean
}): {
  riskCost: number
  steepSegmentCount15Deg: number
  rockHazardCount: number
  highThermalFraction: number
} {
  const safeWeights = validateRiskWeights(weights)
  const distanceCost = terrain.totalKm * 10
  const steepKm = terrain.hazardSegments.reduce((sum, seg) => sum + Math.max(0, seg.toKm - seg.fromKm), 0)
  const steepFraction = terrain.totalKm > 0 ? Math.min(1, steepKm / terrain.totalKm) : 0

  const slopePenalty =
    safeWeights.slope *
    (terrain.meanSlopeDeg * 3.5 +
      Math.max(0, terrain.maxSlopeDeg - 12) * 4.2 +
      steepFraction * 85 +
      (terrain.maxSlopeDeg >= 25 ? 250 : 0))

  const sandPenalty =
    safeWeights.sand *
    (sand.duneKm * (duneNoGoAssumption ? 400 : 68) + sand.sandSheetKm * 28 + sand.uncertainKm * 18)

  let highThermalCount = 0
  const p80 = thermal?.percentile80 ?? 347.1
  if (thermal && terrain.samples.length > 0) {
    const [minLon, minLat, maxLon, maxLat] = thermal.bounds
    for (const s of terrain.samples) {
      if (s.lon < minLon || s.lon > maxLon || s.lat < minLat || s.lat > maxLat) continue
      const c = Math.min(
        thermal.width - 1,
        Math.max(0, Math.floor(((s.lon - minLon) / (maxLon - minLon)) * thermal.width)),
      )
      const r = Math.min(
        thermal.height - 1,
        Math.max(0, Math.floor(((maxLat - s.lat) / (maxLat - minLat)) * thermal.height)),
      )
      const ti = thermal.values[r * thermal.width + c]
      if (ti !== thermal.noData && ti > p80) highThermalCount += 1
    }
  }
  const highThermalFraction = terrain.samples.length ? highThermalCount / terrain.samples.length : 0
  const rockPenalty = safeWeights.rock * (highThermalFraction * terrain.totalKm * 32)
  const uncertaintyPenalty =
    safeWeights.uncertainty * (terrain.unknownFraction * 160 + sand.uncertainFraction * 30)

  const riskCost = Number(
    (distanceCost + slopePenalty + sandPenalty + rockPenalty + uncertaintyPenalty).toFixed(1),
  )

  return {
    riskCost,
    steepSegmentCount15Deg: terrain.hazardSegments.length,
    rockHazardCount: highThermalCount,
    highThermalFraction: Number(highThermalFraction.toFixed(3)),
  }
}

/**
 * Independent deterministic safety verifier for any planned or AI-recommended route.
 * Ensures AI suggestions can never bypass the >=25° slope gate, dune NO-GO rule, DEM coverage, or target arrival.
 */
export function verifyCandidateRouteSafety({
  waypoints,
  terrain,
  sand,
  start,
  target,
  reachable = true,
  duneNoGoAssumption = false,
}: {
  waypoints: LonLat[]
  terrain: RouteTerrain
  sand: RouteSandAssessment
  start: LonLat
  target: LonLat
  reachable?: boolean
  duneNoGoAssumption?: boolean
}): RouteSafetyVerification {
  const rejectionReasons: string[] = []

  const startTargetDistKm = haversineKm(start, target)
  if (startTargetDistKm < MIN_TRAVERSE_KM || terrain.totalKm < MIN_TRAVERSE_KM) {
    rejectionReasons.push('Start and target points are identical; two distinct coordinates are required.')
  }

  if (!reachable) {
    rejectionReasons.push('Target is unreachable without crossing >= 25° slopes or forbidden terrain.')
  }

  const lastWaypoint = waypoints.at(-1)
  const endSample = terrain.samples.at(-1)
  const endPoint = endSample ?? lastWaypoint
  const targetReached = Boolean(
    endPoint && startTargetDistKm >= MIN_TRAVERSE_KM && haversineKm(endPoint, target) <= 0.22 && reachable,
  )
  if (!targetReached && startTargetDistKm >= MIN_TRAVERSE_KM) {
    rejectionReasons.push('Route does not reach the selected scientific target within tolerance (220 m).')
  }

  if (terrain.maxSlopeDeg >= 25) {
    rejectionReasons.push(
      `Maximum slope (${terrain.maxSlopeDeg.toFixed(1)}°) reaches or exceeds the 25° prototype limit.`,
    )
  }

  if (duneNoGoAssumption && sand.duneFraction > 0.005) {
    rejectionReasons.push(
      `Route crosses ${sand.duneKm.toFixed(2)} km of active dune fields while the dune NO-GO assumption is enabled.`,
    )
  }

  const rejected = rejectionReasons.length > 0
  const valid = !rejected && terrain.unknownFraction <= 0.05

  return {
    valid,
    rejected,
    reachable,
    targetReached,
    rejectionReasons,
  }
}

/**
 * Prepare the terrain grid once for multiple searches between the same endpoints.
 */
export function createTraversePlanner({
  dem,
  sand,
  thermal,
  start,
  target,
  duneNoGoAssumption = false,
}: Omit<PlanRoutesInput, 'aiWeights' | 'viaWaypoints'>) {
  const width = sand.width
  const height = sand.height
  const bounds = sand.bounds
  const startCell = lonLatToCell(bounds, width, height, start)
  const targetCell = lonLatToCell(bounds, width, height, target)

  const cellWidthM =
    (((bounds[2] - bounds[0]) * Math.PI) / 180) *
    3396190 *
    Math.cos(((bounds[1] + bounds[3]) * Math.PI) / 360) /
    width
  const cellHeightM = (((bounds[3] - bounds[1]) * Math.PI) / 180) * 3396190 / height
  const stepM = Math.max(1, 0.5 * (cellWidthM + cellHeightM))

  const elevGrid = new Float64Array(width * height)
  const slopeGrid = new Float64Array(width * height)
  const knownGrid = new Uint8Array(width * height)

  for (let r = 0; r < height; r += 1) {
    for (let c = 0; c < width; c += 1) {
      const pt = cellToLonLat(bounds, width, height, c, r)
      const h = sampleElevation(dem, pt.lon, pt.lat)
      const idx = r * width + c
      if (h !== null) {
        elevGrid[idx] = h
        knownGrid[idx] = 1
      }
    }
  }

  for (let r = 0; r < height; r += 1) {
    for (let c = 0; c < width; c += 1) {
      const idx = r * width + c
      if (!knownGrid[idx]) {
        slopeGrid[idx] = 20
        continue
      }
      const cL = Math.max(0, c - 1)
      const cR = Math.min(width - 1, c + 1)
      const rU = Math.max(0, r - 1)
      const rD = Math.min(height - 1, r + 1)
      const hC = elevGrid[idx]
      const hL = knownGrid[r * width + cL] ? elevGrid[r * width + cL] : hC
      const hR = knownGrid[r * width + cR] ? elevGrid[r * width + cR] : hC
      const hU = knownGrid[rU * width + c] ? elevGrid[rU * width + c] : hC
      const hD = knownGrid[rD * width + c] ? elevGrid[rD * width + c] : hC
      const dxCentral = (hR - hL) / Math.max(1, (cR - cL) * stepM)
      const dyCentral = (hD - hU) / Math.max(1, (rD - rU) * stepM)
      slopeGrid[idx] = (Math.atan(Math.hypot(dxCentral, dyCentral)) * 180) / Math.PI
    }
  }

  const canTraverseStep = (cx: number, cy: number, nx: number, ny: number, stepLen: number): boolean => {
    const currIdx = cy * width + cx
    const nextIdx = ny * width + nx
    if (duneNoGoAssumption && sand.values[nextIdx] === 1) return false
    if (knownGrid[currIdx] && knownGrid[nextIdx]) {
      const dh = Math.abs(elevGrid[nextIdx] - elevGrid[currIdx])
      const stepSlopeDeg = (Math.atan(dh / (stepLen * stepM)) * 180) / Math.PI
      if (stepSlopeDeg >= 25) return false
    }
    return true
  }

  const thermalP80 = thermal?.percentile80 ?? 347.1

  const buildWeightFn = (weights: RiskWeights, isShortestMode: boolean) => {
    return (c: number, r: number): number => {
      const idx = r * width + c
      const s = slopeGrid[idx]
      const sandCode = sand.values[idx]

      // Hard non-overridable geometric safety gates
      if (knownGrid[idx] && s >= 25) return Infinity
      if (duneNoGoAssumption && sandCode === 1) return Infinity

      if (isShortestMode) {
        if (!knownGrid[idx]) return 12
        return 1 + 0.015 * s
      }

      if (!knownGrid[idx]) return 1 + weights.uncertainty * 220

      const slopePenalty =
        weights.slope *
        (s >= 14.5 ? 65 + (s - 14.5) * 14 : s >= 10 ? 4 + (s - 10) * 2.5 : 0.45 * s)
      const sandPenalty =
        weights.sand * (sandCode === 1 ? 110 : sandCode === 2 ? 38 : sandCode === 3 ? 14 : 0)
      const uncertaintyPenalty = weights.uncertainty * (sandCode === 3 ? 8 : 0)

      let rockPenalty = 0
      if (thermal && thermal.width > 0 && thermal.height > 0) {
        const tc = Math.min(thermal.width - 1, Math.floor((c / width) * thermal.width))
        const tr = Math.min(thermal.height - 1, Math.floor((r / height) * thermal.height))
        const ti = thermal.values[tr * thermal.width + tc]
        if (ti !== thermal.noData) {
          if (ti > thermalP80) {
            rockPenalty = weights.rock * (18 + Math.max(0, ti - thermalP80) * 0.25)
          } else if (ti < 185) {
            rockPenalty = weights.rock * 12
          }
        }
      }

      return 1 + slopePenalty + sandPenalty + rockPenalty + uncertaintyPenalty
    }
  }

  const buildStepWeightFn = (weights: RiskWeights, isShortestMode: boolean) => {
    if (isShortestMode) return undefined
    return (cx: number, cy: number, nx: number, ny: number, stepLen: number): number => {
      const currIdx = cy * width + cx
      const nextIdx = ny * width + nx
      if (!knownGrid[currIdx] || !knownGrid[nextIdx]) return 0
      const dh = Math.abs(elevGrid[nextIdx] - elevGrid[currIdx])
      const stepSlopeDeg = (Math.atan(dh / (stepLen * stepM)) * 180) / Math.PI
      if (stepSlopeDeg >= 14.5) {
        return weights.slope * (80 + (stepSlopeDeg - 14.5) * 18)
      }
      if (stepSlopeDeg >= 10) {
        return weights.slope * (stepSlopeDeg - 10) * 2.2
      }
      return 0
    }
  }

  const shortestWeights: RiskWeights = { slope: 0.05, sand: 0.05, rock: 0.05, uncertainty: 0.05 }
  const shortestFn = buildWeightFn(shortestWeights, true)
  const riskFn = buildWeightFn(DEFAULT_LOW_RISK_WEIGHTS, false)
  const riskStepFn = buildStepWeightFn(DEFAULT_LOW_RISK_WEIGHTS, false)

  const rawShortest = runAStar(width, height, startCell, targetCell, shortestFn, canTraverseStep)
  const rawRisk = runAStar(width, height, startCell, targetCell, riskFn, canTraverseStep, riskStepFn)

  function toWaypoints(
    result: AStarResult,
    from: LonLat,
    to: LonLat,
    weight: (col: number, row: number) => number,
    weightCap: number,
    preserveContours: boolean,
  ): LonLat[] {
    const fromCells = (cells: AStarResult['cells']) =>
      [from, ...cells.slice(1, -1).map(([c, r]) => cellToLonLat(bounds, width, height, c, r)), to]
    if (!result.reachable) return [from, to]
    const simplified = simplifyCellPath(result.cells, weight, weightCap, preserveContours)
    const compact = fromCells(simplified)
    if (simplified.length === result.cells.length) return compact
    const passesTerrainGates = (points: LonLat[]) => {
      const terrain = buildTerrainProfile(dem, points)
      return terrain.maxSlopeDeg < 25 && terrain.unknownFraction <= 0.05 &&
        (!duneNoGoAssumption || assessRouteSand(sand, terrain.samples).duneFraction <= 0.005)
    }
    if (passesTerrainGates(compact)) return compact
    const original = fromCells(result.cells)
    return passesTerrainGates(original) ? original : compact
  }

  function weightedRoute(weights: RiskWeights, viaWaypoints: LonLat[] = []): PlannedRoute {
    const validatedWeights = validateRiskWeights(weights)
    const weightFn = buildWeightFn(validatedWeights, false)
    const stepWeightFn = buildStepWeightFn(validatedWeights, false)
    const maxClearWeight = 1 + validatedWeights.slope * 3.5 + validatedWeights.rock * 1.2

    const chainPoints: LonLat[] = [start, ...viaWaypoints.slice(0, 2), target]
    const allWaypoints: LonLat[] = [start]
    let allReachable = true
    let totalCost = 0

    for (let i = 0; i < chainPoints.length - 1; i += 1) {
      const segStart = chainPoints[i]
      const segEnd = chainPoints[i + 1]
      const c0 = lonLatToCell(bounds, width, height, segStart)
      const c1 = lonLatToCell(bounds, width, height, segEnd)
      const res = runAStar(width, height, c0, c1, weightFn, canTraverseStep, stepWeightFn)
      if (!res.reachable) allReachable = false
      totalCost += res.totalCost
      const segWps = toWaypoints(res, segStart, segEnd, weightFn, maxClearWeight, true)
      allWaypoints.push(...segWps.slice(1))
    }

    return {
      id: 'route_c',
      mode: 'ai-optimized',
      label: 'Route C · Local ML Optimized',
      color: '#3b82f6',
      waypoints: allWaypoints,
      reachable: allReachable,
      riskCost: Number.isFinite(totalCost) ? Number(totalCost.toFixed(1)) : 9999,
      weights: validatedWeights,
    }
  }

  return {
    shortest: {
      id: 'route_a',
      mode: 'shortest',
      label: 'Route A · Shortest Route',
      color: '#ef4444',
      waypoints: toWaypoints(rawShortest, start, target, shortestFn, 1.45, false),
      reachable: rawShortest.reachable,
      riskCost: Number.isFinite(rawShortest.totalCost) ? Number(rawShortest.totalCost.toFixed(1)) : 9999,
      weights: shortestWeights,
    },
    riskAware: {
      id: 'route_b',
      mode: 'risk-aware',
      label: 'Route B · Low-Risk Route',
      color: '#22c55e',
      waypoints: toWaypoints(rawRisk, start, target, riskFn, 2, true),
      reachable: rawRisk.reachable,
      riskCost: Number.isFinite(rawRisk.totalCost) ? Number(rawRisk.totalCost.toFixed(1)) : 9999,
      weights: DEFAULT_LOW_RISK_WEIGHTS,
    },
    weightedRoute,
  } satisfies { shortest: PlannedRoute; riskAware: PlannedRoute; weightedRoute: typeof weightedRoute }
}

export function planTraverseRoutes({ aiWeights, viaWaypoints, ...input }: PlanRoutesInput) {
  const { shortest, riskAware, weightedRoute } = createTraversePlanner(input)
  return {
    shortest,
    riskAware,
    aiOptimized: aiWeights ? weightedRoute(aiWeights, viaWaypoints) : null,
  }
}

export function validateSandData(
  sand: SandGrid,
  detections: SandFeatureCollection,
  regionBounds: [number, number, number, number],
): void {
  const expectedCells = rasterCellCount('sand.json', sand, regionBounds)
  if (!Array.isArray(sand.values) || sand.values.length !== expectedCells) {
    throw new Error(`sand.json: expected ${expectedCells} values, got ${sand.values?.length ?? 0}`)
  }
  if (detections.type !== 'FeatureCollection' || !Array.isArray(detections.features)) {
    throw new Error('sand-detections.geojson: invalid FeatureCollection')
  }
}
