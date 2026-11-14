import { BUDGET_CONFIG } from '@/config/eva'
import type { EvaResult, ReturnBudget, Verdict } from '@/types'
import type { RouteTerrain } from './dem'
import { formatClock } from './geo'

export interface ReturnBudgetInput {
  terrain: RouteTerrain
  targetStayMinutes?: number
  reserveMinutes?: number
  timeLimitHours?: number
  walkSpeedKmH?: number
  missionStartMinutes?: number
}

/**
 * Outbound + target stay + return + reserve, all on the same reverse route.
 * The max stay is the time that still preserves the reserve at return.
 */
export function computeReturnBudget({
  terrain,
  targetStayMinutes = BUDGET_CONFIG.targetStayMinutes,
  reserveMinutes = BUDGET_CONFIG.reserveMinutes,
  timeLimitHours = BUDGET_CONFIG.timeLimitHours,
  walkSpeedKmH = BUDGET_CONFIG.walkSpeedKmH,
  missionStartMinutes = BUDGET_CONFIG.missionStartMinutes,
}: ReturnBudgetInput): ReturnBudget {
  const outboundMinutes = (terrain.totalKm / walkSpeedKmH) * 60
  const returnMinutes = outboundMinutes
  const timeLimitMinutes = timeLimitHours * 60
  const maxStayMinutes = timeLimitMinutes - outboundMinutes - returnMinutes - reserveMinutes
  const totalMinutes = outboundMinutes + targetStayMinutes + returnMinutes + reserveMinutes
  const marginMinutes = timeLimitMinutes - totalMinutes
  const latestDepartureMinutes = missionStartMinutes + outboundMinutes + Math.max(0, maxStayMinutes)
  const latestReturnMinutes = latestDepartureMinutes + returnMinutes

  return {
    outboundHours: outboundMinutes / 60,
    returnHours: returnMinutes / 60,
    targetStayMinutes,
    reserveMinutes,
    timeLimitHours,
    totalHours: totalMinutes / 60,
    marginHours: marginMinutes / 60,
    maxTargetStayMinutes: Math.max(0, Math.round(maxStayMinutes)),
    latestDeparture: formatClock(latestDepartureMinutes),
    latestReturn: formatClock(latestReturnMinutes),
    targetReachable: maxStayMinutes >= 0,
    exceeded: targetStayMinutes > maxStayMinutes,
    excessMinutes: Math.max(0, Math.round(targetStayMinutes - maxStayMinutes)),
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

