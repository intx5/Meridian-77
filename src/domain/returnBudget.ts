import { BUDGET_CONFIG } from '@/config/eva'
import type { EvaResult, ReturnBudget, Verdict } from '@/types'
import type { RouteTerrain } from './dem'
import { formatClock } from './geo'

export interface ReturnBudgetInput {
  terrain: RouteTerrain
  scienceStopMinutes?: number
  targetStayMinutes?: number
  reserveMinutes?: number
  timeLimitHours?: number
  walkSpeedKmH?: number
  missionStartMinutes?: number
}

/**
 * Outbound walk + intermediate science stops + target stay + return walk + reserve.
 * The max stay is the time that still preserves the reserve at return.
 */
export function computeReturnBudget({
  terrain,
  scienceStopMinutes = 0,
  targetStayMinutes = BUDGET_CONFIG.targetStayMinutes,
  reserveMinutes = BUDGET_CONFIG.reserveMinutes,
  timeLimitHours = BUDGET_CONFIG.timeLimitHours,
  walkSpeedKmH = BUDGET_CONFIG.walkSpeedKmH,
  missionStartMinutes = BUDGET_CONFIG.missionStartMinutes,
}: ReturnBudgetInput): ReturnBudget {
  const outboundMinutes = (terrain.totalKm / walkSpeedKmH) * 60
  const returnMinutes = outboundMinutes
  const timeLimitMinutes = timeLimitHours * 60
  const fixedMinutes = outboundMinutes + scienceStopMinutes + returnMinutes + reserveMinutes
  const maxStayMinutes = timeLimitMinutes - fixedMinutes
  const totalMinutes = fixedMinutes + targetStayMinutes
  const marginMinutes = timeLimitMinutes - totalMinutes
  const targetReachable = maxStayMinutes >= 0
  const latestReturnMinutes = missionStartMinutes + timeLimitMinutes - reserveMinutes
  const latestDepartureMinutes = latestReturnMinutes - returnMinutes

  return {
    outboundHours: outboundMinutes / 60,
    returnHours: returnMinutes / 60,
    scienceStopMinutes,
    targetStayMinutes,
    reserveMinutes,
    timeLimitHours,
    totalHours: totalMinutes / 60,
    marginHours: marginMinutes / 60,
    maxTargetStayMinutes: Math.max(0, Math.floor(maxStayMinutes)),
    latestDeparture: targetReachable ? formatClock(Math.floor(latestDepartureMinutes)) : '—',
    latestReturn: targetReachable ? formatClock(Math.floor(latestReturnMinutes)) : '—',
    targetReachable,
    exceeded: targetStayMinutes > maxStayMinutes,
    excessMinutes: Math.max(0, Math.ceil(targetStayMinutes - maxStayMinutes)),
    unknownFraction: terrain.unknownFraction,
    dataInsufficient: terrain.unknownFraction > 0.05,
  }
}

/** Merge the terrain assessment with the return-budget gate. */
export function combineVerdict(eva: EvaResult, budget: ReturnBudget): Verdict {
  if (eva.verdict === 'INSUFFICIENT DATA' || budget.dataInsufficient) return 'INSUFFICIENT DATA'
  if (eva.verdict === 'NO-GO' || !budget.targetReachable || budget.exceeded) return 'NO-GO'
  if (eva.verdict === 'CAUTION' || budget.marginHours < 0.5 || budget.totalHours > budget.timeLimitHours * 0.8) {
    return 'CAUTION'
  }
  return 'GO'
}

export function cautionReasons(eva: EvaResult, budget: ReturnBudget): string[] {
  if (combineVerdict(eva, budget) !== 'CAUTION') return []
  const reasons: string[] = []
  if (eva.verdict === 'CAUTION' && eva.verdictReason) reasons.push(eva.verdictReason)
  if (budget.marginHours < 0.5) {
    reasons.push(`Return margin ${Math.round(budget.marginHours * 60)} min is below the 30 min caution threshold.`)
  }
  if (budget.totalHours > budget.timeLimitHours * 0.8) {
    reasons.push(`Mission time ${budget.totalHours.toFixed(2)} / ${budget.timeLimitHours} h uses ${(budget.totalHours / budget.timeLimitHours * 100).toFixed(1)}% of the budget (caution above 80%).`)
  }
  return reasons
}

