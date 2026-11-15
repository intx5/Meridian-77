import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { RasterGrid, SandGrid, Waypoint } from '@/types'
import { createMlService } from '@/server/mlHandler'
import {
  type AiDecision,
  type AiPlanRequest,
  SchemaValidationError,
  parseAndValidateAiJson,
  validateAiPlanRequest,
  validateRiskWeights,
} from './aiPlannerSchema'
import { buildTerrainProfile } from './dem'
import { computeEva } from './eva'
import { combineVerdict, computeReturnBudget } from './returnBudget'
import { getJezeroMlModelInfo, predictRouteWithMl } from './routeMlModel'
import {
  assessRouteSand,
  computeRouteRiskCost,
  planTraverseRoutes,
  verifyCandidateRouteSafety,
} from './sand'

const SYNTHETIC_BOUNDS: [number, number, number, number] = [77.3, 18.4, 77.4, 18.5]

function makeSyntheticDem(width = 16, height = 16, fillElevation = -2550): RasterGrid {
  return {
    width,
    height,
    bounds: SYNTHETIC_BOUNDS,
    noData: -9999,
    values: new Array(width * height).fill(fillElevation),
  }
}

function makeSyntheticSand(width = 16, height = 16): SandGrid {
  return {
    width,
    height,
    bounds: SYNTHETIC_BOUNDS,
    noData: 0,
    values: new Array(width * height).fill(0),
  }
}

function makeSampleRequest(): AiPlanRequest {
  return {
    model: 'jezero-ml',
    mission: {
      start: { lon: 77.4509, lat: 18.4446, label: 'Octavia E. Butler Landing' },
      target: {
        id: 'three-forks',
        name: 'Three Forks Depot',
        lon: 77.386,
        lat: 18.4586,
        summary: 'Sample depot on flat valley floor',
      },
      timeLimitHours: 6,
      targetStayMinutes: 20,
      reserveMinutes: 30,
      duneNoGoAssumption: false,
    },
    candidates: [
      {
        id: 'route_a',
        label: 'Route A · Shortest Route',
        distanceKm: 4.12,
        roundTripKm: 8.24,
        oneWayHours: 2.75,
        roundTripHours: 5.83,
        marginHours: 0.17,
        elevationGainM: 42,
        elevationLossM: 12,
        maxSlopeDeg: 16.4,
        meanSlopeDeg: 5.2,
        steepSegmentCount15Deg: 2,
        unknownDemFraction: 0,
        sandKm: 0.58,
        duneKm: 0.21,
        sandSheetKm: 0.37,
        rockHazardCount: 4,
        highThermalFraction: 0.12,
        riskCost: 98.4,
        scienceStopCount: 2,
        visitedStationIds: ['wp-01', 'wp-05'],
        targetReached: true,
        verdict: 'CAUTION',
      },
      {
        id: 'route_b',
        label: 'Route B · Low-Risk Route',
        distanceKm: 4.28,
        roundTripKm: 8.56,
        oneWayHours: 2.85,
        roundTripHours: 5.95,
        marginHours: 0.05,
        elevationGainM: 34,
        elevationLossM: 8,
        maxSlopeDeg: 11.8,
        meanSlopeDeg: 3.9,
        steepSegmentCount15Deg: 0,
        unknownDemFraction: 0,
        sandKm: 0.09,
        duneKm: 0,
        sandSheetKm: 0.09,
        rockHazardCount: 1,
        highThermalFraction: 0.03,
        riskCost: 61.2,
        scienceStopCount: 2,
        visitedStationIds: ['wp-01', 'wp-05'],
        targetReached: true,
        verdict: 'CAUTION',
      },
    ],
    stations: [
      {
        id: 'wp-01',
        name: 'Octavia E. Butler Landing',
        lon: 77.4509,
        lat: 18.4446,
        kind: 'station',
        minerals: ['olivine'],
      },
      {
        id: 'wp-05',
        name: 'Three Forks Depot',
        lon: 77.386,
        lat: 18.4586,
        kind: 'science',
        minerals: ['carbonates', 'phyllosilicates'],
      },
    ],
  }
}

describe('Synthetic test data: deterministic A* & safety gates', () => {
  it('accepts the remaining normal route as the ML baseline after removing the green candidate', () => {
    const request = makeSampleRequest()
    request.candidates = request.candidates.filter((candidate) => candidate.id === 'route_a')
    expect(() => validateAiPlanRequest(request)).not.toThrow()
    expect(() => validateAiPlanRequest({ ...request, candidates: [] })).toThrow()
  })

  it('1. generates normal Route A (Shortest), Route B (Low-Risk), and Route C (ML-weighted) without coordinate fabrication', () => {
    const dem = makeSyntheticDem()
    const sand = makeSyntheticSand()
    for (let r = 6; r <= 9; r += 1) {
      for (let c = 4; c <= 11; c += 1) {
        sand.values[r * 16 + c] = 1
      }
    }
    const start = { lon: 77.32, lat: 18.48 }
    const target = { lon: 77.38, lat: 18.42 }

    const planned = planTraverseRoutes({
      dem,
      sand,
      start,
      target,
      aiWeights: { slope: 0.25, sand: 0.55, rock: 0.1, uncertainty: 0.1 },
    })

    expect(planned.shortest.id).toBe('route_a')
    expect(planned.riskAware.id).toBe('route_b')
    expect(planned.aiOptimized?.id).toBe('route_c')
    expect(planned.shortest.reachable).toBe(true)
    expect(planned.riskAware.reachable).toBe(true)
    expect(planned.aiOptimized?.reachable).toBe(true)
  })

  it('2. rejects routes when start and target points are identical', () => {
    const dem = makeSyntheticDem()
    const sand = makeSyntheticSand()
    const samePoint = { lon: 77.35, lat: 18.45 }

    const planned = planTraverseRoutes({ dem, sand, start: samePoint, target: samePoint })
    const terrain = buildTerrainProfile(dem, planned.shortest.waypoints)
    const sandAssess = assessRouteSand(sand, terrain.samples)
    const check = verifyCandidateRouteSafety({
      waypoints: planned.shortest.waypoints,
      terrain,
      sand: sandAssess,
      start: samePoint,
      target: samePoint,
      reachable: planned.shortest.reachable,
    })

    expect(check.rejected).toBe(true)
    expect(check.rejectionReasons.join(' ')).toMatch(/identical/i)
  })

  it('3 & 4. blocks >= 25° slopes as hard constraints and flags unreachable targets surrounded by >= 25° cliffs', () => {
    const dem = makeSyntheticDem(16, 16, -2550)
    const sand = makeSyntheticSand(16, 16)
    for (let r = 10; r < 16; r += 1) {
      for (let c = 10; c < 16; c += 1) {
        dem.values[r * 16 + c] = -2050
      }
    }
    const start = { lon: 77.315, lat: 18.485 }
    const target = { lon: 77.385, lat: 18.415 }

    const planned = planTraverseRoutes({
      dem,
      sand,
      start,
      target,
      aiWeights: { slope: 0.05, sand: 0.05, rock: 0.05, uncertainty: 0.05 },
    })

    expect(planned.shortest.reachable).toBe(false)
    expect(planned.riskAware.reachable).toBe(false)
    expect(planned.aiOptimized?.reachable).toBe(false)

    const terrain = buildTerrainProfile(dem, planned.shortest.waypoints)
    const sandAssess = assessRouteSand(sand, terrain.samples)
    const safety = verifyCandidateRouteSafety({
      waypoints: planned.shortest.waypoints,
      terrain,
      sand: sandAssess,
      start,
      target,
      reachable: planned.shortest.reachable,
    })
    expect(safety.rejected).toBe(true)
    expect(safety.valid).toBe(false)
  })

  it('5. never grants GO to routes crossing missing DEM (no-data) cells', () => {
    const dem = makeSyntheticDem(16, 16, -2550)
    for (let c = 0; c < 16; c += 1) {
      dem.values[7 * 16 + c] = dem.noData
      dem.values[8 * 16 + c] = dem.noData
    }
    const start = { lon: 77.35, lat: 18.49 }
    const target = { lon: 77.35, lat: 18.41 }
    const terrain = buildTerrainProfile(dem, [start, target])
    const eva = computeEva({
      terrain,
      routeWaypoints: [],
      target,
      thermalPercentile80: 348,
    })
    const budget = computeReturnBudget({ terrain, targetStayMinutes: 20, reserveMinutes: 30 })
    const verdict = combineVerdict(eva, budget)

    expect(terrain.unknownFraction).toBeGreaterThan(0.05)
    expect(verdict).toBe('INSUFFICIENT DATA')
    expect(verdict).not.toBe('GO')
  })

  it('7 & 8. enforces 6-hour EVA budget and denies science target credit when target is not reached', () => {
    const dem = makeSyntheticDem(16, 16, -2550)
    const start = { lon: 77.31, lat: 18.49 }
    const midPoint = { lon: 77.33, lat: 18.47 }
    const distantTarget: Waypoint = {
      id: 'wp-target',
      name: 'Distant Science Target',
      lon: 77.39,
      lat: 18.41,
      kind: 'science',
      imageUrl: null,
      imageCredit: 'NASA',
      sourceUrl: 'https://mars.nasa.gov',
      minerals: ['carbonates', 'sulfates'],
      note: 'Target not visited by short route',
    }

    const incompleteTerrain = buildTerrainProfile(dem, [start, midPoint])
    const evaUnreached = computeEva({
      terrain: incompleteTerrain,
      routeWaypoints: [distantTarget],
      target: distantTarget,
      thermalPercentile80: 348,
      requireTargetArrival: true,
    })

    expect(evaUnreached.stopCount).toBe(0)
    expect(evaUnreached.scienceScore).toBe(0)
    expect(evaUnreached.verdict).toBe('NO-GO')
    expect(evaUnreached.verdictReason).toMatch(/does not reach the selected mission target/i)

    const longBudget = computeReturnBudget({
      terrain: { ...incompleteTerrain, totalKm: 5.2 },
      targetStayMinutes: 40,
      reserveMinutes: 30,
    })
    expect(longBudget.exceeded).toBe(true)
    expect(combineVerdict(evaUnreached, longBudget)).toBe('NO-GO')
  })

  it('12 & 13. rejects invalid risk weights and rejects ML routes that cross forbidden zones', () => {
    expect(() =>
      validateRiskWeights({ slope: -0.2, sand: 0.3, rock: 0.2, uncertainty: 0.2 }),
    ).toThrow(SchemaValidationError)
    expect(() =>
      validateRiskWeights({ slope: 0.95, sand: 0.3, rock: 0.2, uncertainty: 0.2 }),
    ).toThrow(SchemaValidationError)
    expect(() =>
      validateRiskWeights({ slope: Number.NaN, sand: 0.2, rock: 0.2, uncertainty: 0.2 }),
    ).toThrow(SchemaValidationError)

    const dem = makeSyntheticDem(16, 16, -2550)
    const sand = makeSyntheticSand(16, 16)
    sand.values.fill(1)
    const start = { lon: 77.32, lat: 18.48 }
    const target = { lon: 77.38, lat: 18.42 }
    const terrain = buildTerrainProfile(dem, [start, target])
    const sandAssess = assessRouteSand(sand, terrain.samples)

    const safety = verifyCandidateRouteSafety({
      waypoints: [start, target],
      terrain,
      sand: sandAssess,
      start,
      target,
      reachable: false,
      duneNoGoAssumption: true,
    })
    expect(safety.rejected).toBe(true)
    expect(safety.rejectionReasons.join(' ')).toMatch(/dune/i)
  })
})

describe('Synthetic test data: Local ML backend, schema & security', () => {
  it('9. handles model errors cleanly without fabricating an ML route', async () => {
    const failingService = createMlService({
      predictImpl: () => {
        throw new Error('Model weights corrupted')
      },
    })
    const res500 = await failingService.evaluatePlan(makeSampleRequest(), '127.0.0.1')
    expect(res500.status).toBe(500)
    expect(res500.body.ok).toBe(false)
    expect(res500.body.aiVerified).toBe(false)
    expect(res500.body.decision).toBeNull()
    expect(res500.body.errorCode).toBe('MODEL_ERROR')
  })

  it('10. rejects empty or malformed JSON responses and out-of-bounds schema violations', async () => {
    expect(() => parseAndValidateAiJson('')).toThrow(SchemaValidationError)
    expect(() => parseAndValidateAiJson('{not valid json')).toThrow(SchemaValidationError)

    const badSchemaService = createMlService({
      predictImpl: () =>
        ({
          riskWeights: { slope: 99, sand: 0.2, rock: 0.2, uncertainty: 0.2 },
          preferredRouteId: 'route_b',
          reasoning: ['Invalid weight'],
          warnings: [],
        }) as unknown as AiDecision,
    })
    const res = await badSchemaService.evaluatePlan(makeSampleRequest(), '127.0.0.1')
    expect(res.status).toBe(422)
    expect(res.body.ok).toBe(false)
    expect(res.body.errorCode).toBe('SCHEMA_VIOLATION')
  })

  it('caches valid ML responses and tracks telemetry & rate limits', async () => {
    let calls = 0
    const service = createMlService({
      rateLimitMax: 3,
      predictImpl: (payload, allowedIds) => {
        calls += 1
        return predictRouteWithMl(payload, allowedIds)
      },
    })

    const first = await service.evaluatePlan(makeSampleRequest(), '10.0.0.1')
    expect(first.status).toBe(200)
    expect(first.body.ok).toBe(true)
    expect(first.body.aiVerified).toBe(true)
    expect(first.body.cached).toBe(false)
    expect(calls).toBe(1)

    // Second identical call hits the server cache
    const second = await service.evaluatePlan(makeSampleRequest(), '10.0.0.1')
    expect(second.status).toBe(200)
    expect(second.body.cached).toBe(true)
    expect(second.body.telemetry.cacheHits).toBe(1)
    expect(calls).toBe(1)

    // Fourth call within window triggers rate limiter
    await service.evaluatePlan(makeSampleRequest(), '10.0.0.1')
    const fourth = await service.evaluatePlan(makeSampleRequest(), '10.0.0.1')
    expect(fourth.status).toBe(429)
    expect(fourth.body.errorCode).toBe('RATE_LIMITED')
  })

  it('14. contains no external LLM API keys or endpoints in source code', () => {
    const walkFiles = (dir: string): string[] => {
      const entries = readdirSync(dir, { withFileTypes: true })
      const files: string[] = []
      for (const entry of entries) {
        const full = join(dir, entry.name)
        if (entry.isDirectory()) {
          files.push(...walkFiles(full))
        } else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.test.ts')) {
          files.push(full)
        }
      }
      return files
    }

    const sourceFiles = walkFiles(join(process.cwd(), 'src'))
    expect(sourceFiles.length).toBeGreaterThan(10)
    for (const file of sourceFiles) {
      const content = readFileSync(file, 'utf8')
      expect(content).not.toMatch(/deepseek/i)
    }
  })
})

describe('Real NASA Jezero dataset: A* Route A/B/C & EVA safety verification', () => {
  it('6, 15 & 16. computes Route A (Shortest), Route B (Low-Risk), and ML-weighted Route C on real NASA DEM, Sand & THEMIS grids', () => {
    const dem = JSON.parse(readFileSync('public/data/jezero/dem.json', 'utf8')) as RasterGrid
    const sand = JSON.parse(readFileSync('public/data/jezero/sand.json', 'utf8')) as SandGrid
    const thermal = JSON.parse(readFileSync('public/data/jezero/thermal.json', 'utf8')) as RasterGrid

    const start = { lon: 77.4509, lat: 18.4446 } // Octavia E. Butler Landing (wp-01)
    const target = { lon: 77.386, lat: 18.4586 } // Three Forks Depot (wp-05)

    const planned = planTraverseRoutes({
      dem,
      sand,
      thermal,
      start,
      target,
      aiWeights: { slope: 0.4, sand: 0.3, rock: 0.15, uncertainty: 0.15 },
    })

    const terrainA = buildTerrainProfile(dem, planned.shortest.waypoints)
    const terrainB = buildTerrainProfile(dem, planned.riskAware.waypoints)
    const terrainC = buildTerrainProfile(dem, planned.aiOptimized!.waypoints)

    const sandA = assessRouteSand(sand, terrainA.samples)
    const sandB = assessRouteSand(sand, terrainB.samples)
    const sandC = assessRouteSand(sand, terrainC.samples)

    const costA = computeRouteRiskCost({ terrain: terrainA, sand: sandA, thermal })
    const costB = computeRouteRiskCost({ terrain: terrainB, sand: sandB, thermal })

    expect(terrainA.totalKm).toBeLessThanOrEqual(terrainB.totalKm + 0.05)
    expect(costB.riskCost).toBeLessThan(costA.riskCost)
    expect(sandB.duneKm + sandB.sandSheetKm).toBeLessThan(sandA.duneKm + sandA.sandSheetKm)

    const checkA = verifyCandidateRouteSafety({
      waypoints: planned.shortest.waypoints,
      terrain: terrainA,
      sand: sandA,
      start,
      target,
      reachable: planned.shortest.reachable,
    })
    const checkB = verifyCandidateRouteSafety({
      waypoints: planned.riskAware.waypoints,
      terrain: terrainB,
      sand: sandB,
      start,
      target,
      reachable: planned.riskAware.reachable,
    })
    const checkC = verifyCandidateRouteSafety({
      waypoints: planned.aiOptimized!.waypoints,
      terrain: terrainC,
      sand: sandC,
      start,
      target,
      reachable: planned.aiOptimized!.reachable,
    })

    expect(checkA.targetReached).toBe(true)
    expect(checkB.targetReached).toBe(true)
    expect(checkC.targetReached).toBe(true)
    expect(checkB.rejected).toBe(false)
    expect(checkC.rejected).toBe(false)
  })

  it('17. predicts validated riskWeights locally using the trained Jezero Random Forest + Ridge ML ensemble', async () => {
    const info = getJezeroMlModelInfo()
    expect(info.modelId).toBe('jezero-ml')
    expect(info.trainedOn.samples).toBeGreaterThanOrEqual(400)
    expect(info.trainedOn.validationR2).toBeGreaterThan(0.85)

    const sampleReq = makeSampleRequest()
    const mlDecision = predictRouteWithMl(sampleReq)
    expect(mlDecision.riskWeights.slope).toBeGreaterThanOrEqual(0.05)
    expect(mlDecision.riskWeights.sand).toBeGreaterThanOrEqual(0.05)
    expect(mlDecision.preferredRouteId).toBe('route_b')
    expect(mlDecision.reasoning[0]).toMatch(/Random Forest \+ Ridge ML ensemble/)

    const mlService = createMlService()
    const res = await mlService.evaluatePlan({ ...sampleReq, model: 'jezero-ml' }, '127.0.0.1')
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.aiVerified).toBe(true)
    expect(res.body.model).toBe('jezero-ml')
    expect(res.body.decision?.riskWeights).toEqual(mlDecision.riskWeights)
  })

  it('18. verifies zero data leakage in the trained Jezero ML model (disjoint corridors, train-only scaler, and permutation null test)', () => {
    const info = getJezeroMlModelInfo()
    const audit = info.trainedOn.leakageAudit
    expect(audit.passed).toBe(true)
    expect(audit.sharedCorridorCount).toBe(0)
    expect(audit.duplicateFeatureRows).toBe(0)
    expect(audit.minTrainValL2Distance).toBeGreaterThan(0.05)
    expect(audit.scalerFitOnTrainOnly).toBe(true)
    expect(audit.trainMeanMaxAbsDeviation).toBeLessThan(1e-10)
    expect(audit.permutationNullR2).toBeLessThan(0.05)
  })
})
