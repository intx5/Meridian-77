import { describe, expect, it } from 'vitest'
import { selectRecommendedRoute, type SelectableRoute } from './routeSelection'

function candidate(id: string, safetyScore: number, totalHours: number): SelectableRoute & { id: string } {
  return {
    id, verdict: 'GO', riskCost: 20,
    eva: { safetyScore },
    budget: { totalHours, timeLimitHours: 6, marginHours: 6 - totalHours, exceeded: false, dataInsufficient: false, targetReachable: true },
    safety: { valid: true, rejected: false, reachable: true, targetReached: true },
  }
}

describe('verified route recommendation', () => {
  it('keeps a safer normal route instead of automatically accepting the AI route', () => {
    expect(selectRecommendedRoute([candidate('normal', 60, 3), candidate('ai', 40, 2)])?.id).toBe('normal')
  })
  it('chooses the fastest route at equal safety, regardless of AI preference or input order', () => {
    expect(selectRecommendedRoute([candidate('ai', 85, 4), candidate('normal', 85, 2)])?.id).toBe('normal')
  })
  it('accepts an AI route when it improves safety', () => {
    expect(selectRecommendedRoute([candidate('normal', 60, 3), candidate('ai', 80, 3)])?.id).toBe('ai')
  })
  it('prefers GO over a caution route even when the latter is faster and has a higher score', () => {
    const caution = { ...candidate('caution', 95, 1), verdict: 'CAUTION' as const }
    expect(selectRecommendedRoute([caution, candidate('go', 80, 3)])?.id).toBe('go')
  })
  it('returns no recommendation when all routes fail independent gates', () => {
    const base = candidate('invalid', 100, 1)
    const invalid = [
      { ...base, verdict: 'NO-GO' as const },
      { ...base, verdict: 'INSUFFICIENT DATA' as const },
      { ...base, safety: { ...base.safety, rejected: true } },
      { ...base, safety: { ...base.safety, reachable: false } },
      { ...base, safety: { ...base.safety, targetReached: false } },
      { ...base, budget: { ...base.budget, totalHours: 7, marginHours: -1 } },
      { ...base, budget: { ...base.budget, exceeded: true } },
      { ...base, budget: { ...base.budget, dataInsufficient: true } },
      { ...base, eva: { safetyScore: NaN } },
    ]
    expect(selectRecommendedRoute(invalid)).toBeNull()
  })
  it('keeps the incumbent on exact ties and uses common risk cost to break remaining ties', () => {
    const incumbent = candidate('current', 80, 3)
    expect(selectRecommendedRoute([incumbent, candidate('ai', 80, 3)])?.id).toBe('current')
    expect(selectRecommendedRoute([{ ...incumbent, riskCost: 50 }, candidate('ai', 80, 3)])?.id).toBe('ai')
  })
})
