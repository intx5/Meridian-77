import { describe, expect, it } from 'vitest'
import type { EvaResult } from '@/types'
import type { RouteTerrain } from './dem'
import { combineVerdict, computeReturnBudget } from './returnBudget'

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

  it('marks a target unreachable when outbound plus return consumes the budget', () => {
    const budget = computeReturnBudget({ terrain: terrain({ totalKm: 12 }), targetStayMinutes: 20 })
    expect(budget.targetReachable).toBe(false)
    expect(budget.maxTargetStayMinutes).toBe(0)
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
