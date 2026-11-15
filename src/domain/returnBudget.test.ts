import { describe, expect, it } from 'vitest'
import type { EvaResult } from '@/types'
import type { RouteTerrain } from './dem'
import { combineVerdict, computeReturnBudget, cautionReasons } from './returnBudget'

function terrain(overrides: Partial<RouteTerrain> = {}): RouteTerrain {
  return {
    samples: [],
    totalKm: 3.52,
    unknownFraction: 0,
    elevationGainM: 0,
    elevationLossM: 0,
    maxSlopeDeg: 0,
    meanSlopeDeg: 0,
    hazardSegments: [],
    ...overrides,
  }
}

const eva = (verdict: EvaResult['verdict']): EvaResult => ({
  distanceKm: 3.52,
  durationHours: 2.35,
  stopCount: 1,
  maxSlopeDeg: 0,
  meanSlopeDeg: 0,
  elevationGainM: 0,
  elevationLossM: 0,
  hazardCount: 0,
  unknownFraction: 0,
  safetyScore: 100,
  scienceScore: 0,
  compositeScore: 60,
  verdict,
  verdictReason: '',
  breakdown: [],
})

describe('return budget', () => {
  it('reserves the return leg and computes the maximum target stay', () => {
    const budget = computeReturnBudget({ terrain: terrain(), targetStayMinutes: 20, reserveMinutes: 30 })
    expect(budget.outboundHours).toBeCloseTo(3.52 / 1.5, 6)
    expect(budget.returnHours).toBeCloseTo(3.52 / 1.5, 6)
    expect(budget.maxTargetStayMinutes).toBe(48)
    expect(budget.latestDeparture).toBe('12:09')
    expect(budget.latestReturn).toBe('14:30')
    expect(budget.exceeded).toBe(false)
    expect(budget.targetReachable).toBe(true)
  })

  it('marks the card exceeded when the target stay is larger than the max stay', () => {
    const budget = computeReturnBudget({ terrain: terrain(), targetStayMinutes: 60, reserveMinutes: 30 })
    expect(budget.maxTargetStayMinutes).toBe(48)
    expect(budget.exceeded).toBe(true)
    expect(budget.excessMinutes).toBe(12)
    expect(budget.marginHours).toBeLessThan(0)
  })

  it('subtracts intermediate sampling time from the allowable target stay', () => {
    const budget = computeReturnBudget({
      terrain: terrain(), targetStayMinutes: 45, scienceStopMinutes: 20, reserveMinutes: 30,
    })
    expect(budget.maxTargetStayMinutes).toBe(28)
    expect(budget.totalHours).toBeCloseTo(6.2767, 4)
    expect(budget.exceeded).toBe(true)
  })

  it('marks a target unreachable when outbound plus return consumes the budget', () => {
    const budget = computeReturnBudget({ terrain: terrain({ totalKm: 12 }), targetStayMinutes: 20 })
    expect(budget.targetReachable).toBe(false)
    expect(budget.maxTargetStayMinutes).toBe(0)
    expect(budget.latestDeparture).toBe('—')
    expect(budget.latestReturn).toBe('—')
  })

  it('does not round a fractional safe stay or departure deadline up', () => {
    const budget = computeReturnBudget({
      terrain: terrain({ totalKm: 3.51 }),
      targetStayMinutes: 50,
      reserveMinutes: 30,
    })
    expect(budget.maxTargetStayMinutes).toBe(49)
    expect(budget.latestDeparture).toBe('12:09')
    expect(budget.exceeded).toBe(true)
    expect(budget.excessMinutes).toBe(1)
  })

  it('flags incomplete elevation coverage as insufficient data', () => {
    const budget = computeReturnBudget({ terrain: terrain({ unknownFraction: 0.1 }) })
    expect(budget.dataInsufficient).toBe(true)
  })

  it('combines the terrain verdict with the return budget', () => {
    const short = computeReturnBudget({ terrain: terrain({ totalKm: 1.5 }), targetStayMinutes: 20 })
    expect(combineVerdict(eva('GO'), short)).toBe('GO')
    expect(combineVerdict(eva('CAUTION'), short)).toBe('CAUTION')

    const over = computeReturnBudget({ terrain: terrain(), targetStayMinutes: 60 })
    expect(combineVerdict(eva('GO'), over)).toBe('NO-GO')

    const insufficient = computeReturnBudget({ terrain: terrain({ unknownFraction: 0.1 }) })
    expect(combineVerdict(eva('GO'), insufficient)).toBe('INSUFFICIENT DATA')
  })
})


describe('visible caution reasons', () => {
  it('explains low-slope caution from both terrain hazards and return margin', () => {
    const assessment = { ...eva('CAUTION'), maxSlopeDeg: 13.3, verdictReason: 'Elevated radiation exposure.' }
    const budget = computeReturnBudget({ terrain: terrain(), targetStayMinutes: 20, reserveMinutes: 30 })
    const reasons = cautionReasons(assessment, budget)
    expect(reasons).toContain('Elevated radiation exposure.')
    expect(reasons.some(reason => reason.includes('30 min'))).toBe(true)
    expect(reasons.some(reason => reason.includes('80%'))).toBe(true)
  })
  it('explains budget-only caution without claiming terrain failed', () => {
    const budget = computeReturnBudget({ terrain: terrain(), targetStayMinutes: 20, reserveMinutes: 30 })
    expect(cautionReasons({ ...eva('GO'), verdictReason: 'Terrain is within limits.' }, budget).join(' ')).not.toContain('Terrain is within limits')
    expect(cautionReasons(eva('GO'), budget).length).toBe(2)
    expect(cautionReasons(eva('GO'), computeReturnBudget({ terrain: terrain({ totalKm: 1 }) }))).toEqual([])
  })
})
