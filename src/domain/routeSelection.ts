import type { EvaResult, ReturnBudget, Verdict } from '@/types'
import type { RouteSafetyVerification } from './sand'

export interface SelectableRoute {
  verdict: Verdict
  eva: Pick<EvaResult, 'safetyScore'>
  budget: Pick<ReturnBudget, 'totalHours' | 'timeLimitHours' | 'marginHours' | 'exceeded' | 'dataInsufficient' | 'targetReachable'>
  safety: Pick<RouteSafetyVerification, 'valid' | 'rejected' | 'reachable' | 'targetReached'>
  riskCost: number
}

export function selectRecommendedRoute<T extends SelectableRoute>(routes: readonly T[]): T | null {
  const eligible = routes.filter(({ verdict, safety, budget, eva, riskCost }) =>
    (verdict === 'GO' || verdict === 'CAUTION') &&
    safety.valid && !safety.rejected && safety.reachable && safety.targetReached &&
    !budget.exceeded && !budget.dataInsufficient && budget.targetReachable &&
    Number.isFinite(budget.totalHours) && budget.totalHours > 0 &&
    budget.totalHours <= budget.timeLimitHours && budget.marginHours >= 0 &&
    Number.isFinite(eva.safetyScore) && Number.isFinite(riskCost),
  )
  // Stable ties preserve the incumbent. AI origin never improves a route's rank.
  eligible.sort((a, b) =>
    Number(b.verdict === 'GO') - Number(a.verdict === 'GO') ||
    b.eva.safetyScore - a.eva.safetyScore ||
    a.budget.totalHours - b.budget.totalHours ||
    a.riskCost - b.riskCost,
  )
  return eligible[0] ?? null
}
