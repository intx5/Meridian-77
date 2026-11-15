import type { LonLat, RadiationScenario, RasterGrid, SandGrid, ShieldingGrid, Waypoint } from '@/types'
import { buildTerrainProfile } from './dem'
import { computeEva, intermediateScienceStopMinutes } from './eva'
import { assessRouteTopographicShielding } from './radiation'
import { combineVerdict, computeReturnBudget } from './returnBudget'
import { assessRouteSand, computeRouteRiskCost, verifyCandidateRouteSafety } from './sand'
import type { createTraversePlanner, PlannedRoute } from './sand'
import { selectRecommendedRoute, type SelectableRoute } from './routeSelection'
import type { RiskWeights } from './aiPlannerSchema'

// Include a distance-leaning search as well as profiles emphasizing individual
// hazards. A large search penalty can avoid sand at the expense of a steeper or
// much longer route, so the final ranking always uses the same EVA assessment.
const SEARCH_PROFILES = [
  { slope: 0.05, sand: 0.05, rock: 0.05, uncertainty: 0.20 },
  { slope: 0.74, sand: 0.10, rock: 0.08, uncertainty: 0.20 },
  { slope: 0.25, sand: 0.70, rock: 0.12, uncertainty: 0.50 },
  { slope: 0.25, sand: 0.10, rock: 0.70, uncertainty: 0.40 },
] satisfies RiskWeights[]

export interface RouteAssessmentContext {
  dem: RasterGrid
  sand: SandGrid
  thermal: RasterGrid
  mineralogy?: RasterGrid
  waypoints: Waypoint[]
  shieldingGrid: ShieldingGrid
  start: LonLat
  target: LonLat
  thermalPercentile80: number
  duneNoGoAssumption: boolean
  targetStayMinutes: number
  reserveMinutes: number
  radiationScenarioId: RadiationScenario['id']
  doseRate: number
}

/** One evaluator for previews, AI selection, and the currently loaded geometry. */
export function assessPlannedRoute(points: LonLat[], reachable: boolean, context: RouteAssessmentContext) {
  const terrain = buildTerrainProfile(context.dem, points)
  const sand = assessRouteSand(context.sand, terrain.samples)
  // Fixed evaluation weights make costs comparable even when search weights differ.
  const cost = computeRouteRiskCost({ terrain, sand, thermal: context.thermal, duneNoGoAssumption: context.duneNoGoAssumption })
  const safety = verifyCandidateRouteSafety({
    waypoints: points, terrain, sand, start: context.start, target: context.target,
    reachable, duneNoGoAssumption: context.duneNoGoAssumption,
  })
  const budget = computeReturnBudget({
    terrain,
    scienceStopMinutes: intermediateScienceStopMinutes(terrain, context.waypoints),
    targetStayMinutes: context.targetStayMinutes,
    reserveMinutes: context.reserveMinutes,
  })
  const shielding = assessRouteTopographicShielding(context.shieldingGrid, terrain.samples)
  const eva = computeEva({
    terrain, routeWaypoints: terrain.samples.length >= 2 ? context.waypoints : [], target: context.target,
    thermalPercentile80: context.thermalPercentile80, thermalGrid: context.thermal, mineralogyGrid: context.mineralogy,
    sand, duneNoGoAssumption: context.duneNoGoAssumption, requireTargetArrival: true,
    radiation: {
      scenarioId: context.radiationScenarioId, doseRateMicroGyPerHour: context.doseRate,
      budget,
      meanSkyVisibilityFraction: shielding.meanSkyVisibilityFraction,
    },
  })
  const verdict = safety.rejected ? 'NO-GO' : combineVerdict(eva, budget)
  return { terrain, sand, eva, budget, safety, verdict, riskCost: cost.riskCost } as const
}

export type AssessedRouteCandidate = PlannedRoute & ReturnType<typeof assessPlannedRoute> & { searchWeights?: RiskWeights }

export function assessRouteCandidate(route: PlannedRoute, context: RouteAssessmentContext): AssessedRouteCandidate {
  return { ...route, ...assessPlannedRoute(route.waypoints, route.reachable, context), searchWeights: route.weights }
}

export function assessLocalAlternatives(
  planner: ReturnType<typeof createTraversePlanner>,
  context: RouteAssessmentContext,
  presetRoutes: readonly { label: string; waypoints: LonLat[] }[],
) {
  const baseline = planner.riskAware
  const profileCandidates = [
    baseline,
    ...SEARCH_PROFILES.map((weights) => planner.weightedRoute(weights)),
  ].map((candidate) => assessRouteCandidate({ ...candidate, id: 'route_b', mode: 'risk-aware' }, context))
  const matchingPresets = presetRoutes
    .filter(({ waypoints }) =>
      waypoints[0]?.lon === context.start.lon && waypoints[0]?.lat === context.start.lat &&
      waypoints.at(-1)?.lon === context.target.lon && waypoints.at(-1)?.lat === context.target.lat,
    )
    .map(({ label, waypoints }) => ({
      ...assessRouteCandidate({ ...baseline, label, waypoints, reachable: true }, context), searchWeights: undefined,
    }))
  return { baseline: profileCandidates[0], best: selectRecommendedRoute([...profileCandidates, ...matchingPresets]) }
}

export function sameRouteGeometry(a: readonly LonLat[], b: readonly LonLat[]): boolean {
  return a.length === b.length && a.every(
    (point, index) => Math.abs(point.lon - b[index].lon) < 1e-6 && Math.abs(point.lat - b[index].lat) < 1e-6,
  )
}

export function explainRoutePreference(winner: SelectableRoute, next: SelectableRoute): string {
  if (winner.verdict !== next.verdict) return `better verdict (${winner.verdict} vs ${next.verdict})`
  if (winner.eva.safetyScore !== next.eva.safetyScore) {
    return `higher safety (${winner.eva.safetyScore} vs ${next.eva.safetyScore})`
  }
  if (winner.budget.totalHours !== next.budget.totalHours) return 'shorter mission at equal safety'
  if (winner.riskCost !== next.riskCost) return 'lower terrain risk at equal safety and time'
  return 'equal verdict, safety, mission time and terrain risk'
}
