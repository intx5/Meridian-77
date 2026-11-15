import { useEffect, useMemo, useState } from 'react'
import { BudgetControls } from '@/components/BudgetControls'
import { ElevationProfile } from '@/components/ElevationProfile'
import { EvaScoreCard } from '@/components/EvaScoreCard'
import { LayerPanel } from '@/components/LayerPanel'
import type { CandidateMapRoute } from '@/components/Map2D'
import { TerrainView } from '@/components/TerrainView'
import { MissionBrief } from '@/components/MissionBrief'
import { MissionSetup } from '@/components/MissionSetup'
import { RadiationPanel } from '@/components/RadiationPanel'
import { ReturnByCard } from '@/components/ReturnByCard'
import { RouteComparison, type PlannedRouteAnalysis, type RouteAnalysis } from '@/components/RouteComparison'
import { RoutePanel } from '@/components/RoutePanel'
import { SandFeatureDialog } from '@/components/SandFeatureCard'
import { TopBar } from '@/components/TopBar'
import { VerdictPlate } from '@/components/VerdictPlate'
import { WaypointDialog, WaypointList } from '@/components/WaypointCard'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { MIN_TRAVERSE_KM } from '@/config/eva'
import { MISSION_TARGETS, TARGET_WAYPOINT_ID } from '@/config/region'
import { PRESET_ROUTES, SHARED_START, presetRoute } from '@/config/routes'
import {
  type AiModelId,
  type AiPlanRequest,
  type AiPlanResponse,
  type CandidateRouteId,
  type CandidateRouteMetrics,
  validateAiDecision,
} from '@/domain/aiPlannerSchema'
import { loadMissionData, type MissionData } from '@/domain/data'
import { buildTerrainProfile, steepestSegment } from '@/domain/dem'
import { computeEva, EVA_CONFIG, intermediateScienceStopMinutes } from '@/domain/eva'
import { formatCoord, haversineKm } from '@/domain/geo'
import {
  assessRouteTopographicShielding,
  computeEvaRadiationExposure,
  resolveComponentDoseRate,
} from '@/domain/radiation'
import { cautionReasons, combineVerdict, computeReturnBudget } from '@/domain/returnBudget'
import {
  assessLocalAlternatives,
  assessPlannedRoute,
  assessRouteCandidate,
  explainRoutePreference,
  sameRouteGeometry,
  type AssessedRouteCandidate,
} from '@/domain/routeAssessment'
import { selectRecommendedRoute } from '@/domain/routeSelection'
import {
  assessRouteSand,
  computeRouteRiskCost,
  createTraversePlanner,
} from '@/domain/sand'
import type { EvaResult } from '@/types'
import { useMissionStore } from '@/store/useMissionStore'

type RoutingSnapshot = Pick<ReturnType<typeof useMissionStore.getState>,
  'route' | 'targetId' | 'startWaypointId' | 'targetStayMinutes' | 'reserveMinutes' |
  'duneNoGoAssumption' | 'radiationScenarioId' | 'radiationComponent'>

interface RouteAnalysisResult {
  response: AiPlanResponse
  context: RoutingSnapshot
  localRecommendation: AssessedRouteCandidate | null
  aiCandidate: AssessedRouteCandidate | null
  retainedCurrentRoute: boolean
}

const CANDIDATE_PRESENTATION = {
  route_a: {
    label: 'Plan Route A · Shortest path',
    summary: 'Short traverse between the selected endpoints.',
    dashArray: '8 5',
  },
  route_b: {
    label: 'Terrain-aware recommendation',
    summary: 'Best verified alternative from the local terrain searches.',
    dashArray: '6 4',
    color: '#c4a6ff',
  },
  route_c: {
    label: 'Plan Route C · AI candidate',
    summary: 'Route generated locally from the model’s proposed terrain weights.',
    dashArray: '3 5',
  },
} as const

function failedAiResponse(model: AiModelId, err: unknown): AiPlanResponse {
  return {
    ok: false,
    aiVerified: false,
    model,
    cached: false,
    decision: null,
    telemetry: { requestCount: 0, cacheHits: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, latencyMs: 0 },
    error: err instanceof Error ? err.message : 'AI analysis is unavailable.',
    errorCode: 'MODEL_ERROR',
  }
}

function sameRoutingContext(a: RoutingSnapshot, b: RoutingSnapshot): boolean {
  return a.route === b.route && a.targetId === b.targetId && a.startWaypointId === b.startWaypointId &&
    a.targetStayMinutes === b.targetStayMinutes && a.reserveMinutes === b.reserveMinutes &&
    a.duneNoGoAssumption === b.duneNoGoAssumption && a.radiationScenarioId === b.radiationScenarioId &&
    a.radiationComponent === b.radiationComponent
}

function LoadingScreen() {
  return (
    <div className="grid h-dvh place-items-center bg-bg px-6">
      <div className="w-full max-w-[300px]">
        <div className="flex items-center gap-2.5">
          <span className="h-5 w-[2px] bg-accent" aria-hidden />
          <p className="text-[11px] font-semibold tracking-[0.16em] text-ink">MERIDIAN 77</p>
        </div>
        <p className="mt-3 text-[10px] text-faint">Loading local Jezero terrain</p>
        <div className="mt-3 h-px w-full overflow-hidden bg-line">
          <div className="h-px w-1/3 animate-pulse bg-accent" />
        </div>
        <p className="mt-2 meta">dem / overlays / stations</p>
      </div>
    </div>
  )
}

function ErrorScreen({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="grid h-dvh place-items-center bg-bg px-6">
      <div className="w-full max-w-[440px] border-l-2 border-danger pl-5">
        <p className="meta text-danger">data unavailable</p>
        <h1 className="mt-2 text-[20px] font-medium leading-tight tracking-[-0.02em] text-ink">
          The mission data could not be loaded
        </h1>
        <p className="mt-2 font-mono text-[10px] leading-relaxed text-muted">{message}</p>
        <p className="mt-2 text-[10.5px] leading-relaxed text-faint">
          Confirm that <span className="font-mono text-muted">public/data/jezero</span> contains the manifest, DEM and
          waypoints, then retry.
        </p>
        <Button className="mt-4" variant="outline" size="sm" onClick={onRetry}>
          Retry loading
        </Button>
      </div>
    </div>
  )
}

function Planner({ data }: { data: MissionData }) {
  const {
    manifest,
    dem,
    waypoints,
    sand,
    sandDetections,
    thermal,
    temperature,
    mineralogy,
    radiationReference,
    radiationScenarios,
    radiationProvenance,
    shieldingGrid,
  } = data
  const route = useMissionStore((state) => state.route)
  const presetRouteId = useMissionStore((state) => state.presetRouteId)
  const startWaypointId = useMissionStore((state) => state.startWaypointId)
  const setStartWaypointId = useMissionStore((state) => state.setStartWaypointId)
  const targetId = useMissionStore((state) => state.targetId)
  const targetStayMinutes = useMissionStore((state) => state.targetStayMinutes)
  const reserveMinutes = useMissionStore((state) => state.reserveMinutes)
  const setTargetStayMinutes = useMissionStore((state) => state.setTargetStayMinutes)
  const setReserveMinutes = useMissionStore((state) => state.setReserveMinutes)
  const loadPresetRoute = useMissionStore((state) => state.loadPresetRoute)
  const loadPlannedRoute = useMissionStore((state) => state.loadPlannedRoute)
  const setHighlightSegment = useMissionStore((state) => state.setHighlightSegment)
  const centerOn = useMissionStore((state) => state.centerOn)
  const setBriefOpen = useMissionStore((state) => state.setBriefOpen)
  const selectedWaypointId = useMissionStore((state) => state.selectedWaypointId)
  const selectedSandFeatureId = useMissionStore((state) => state.selectedSandFeatureId)
  const duneNoGoAssumption = useMissionStore((state) => state.duneNoGoAssumption)
  const setDuneNoGoAssumption = useMissionStore((state) => state.setDuneNoGoAssumption)
  const showCandidateOverlay = useMissionStore((state) => state.showCandidateOverlay)
  const setShowCandidateOverlay = useMissionStore((state) => state.setShowCandidateOverlay)
  const radiationScenarioId = useMissionStore((state) => state.radiationScenarioId)
  const radiationComponent = useMissionStore((state) => state.radiationComponent)
  const initLayers = useMissionStore((state) => state.initLayers)

  const [aiModel, setAiModel] = useState<AiModelId>('jezero-ml')
  const [aiLoading, setAiLoading] = useState(false)
  const [aiResult, setAiResult] = useState<RouteAnalysisResult | null>(null)
  const [aiSelection, setAiSelection] = useState<{ message: string; context: RoutingSnapshot } | null>(null)
  const currentRoutingContext = { route, targetId, startWaypointId, targetStayMinutes, reserveMinutes,
    duneNoGoAssumption, radiationScenarioId, radiationComponent }
  const analysisResult = aiResult && sameRoutingContext(aiResult.context, currentRoutingContext) ? aiResult : null
  const aiResponse = analysisResult?.response ?? null
  const aiSelectionMessage = aiSelection && sameRoutingContext(aiSelection.context, currentRoutingContext)
    ? aiSelection.message : ''
  function setAiSelectionMessage(message: string) {
    setAiSelection({ message, context: useMissionStore.getState() })
  }
  const [activePlannedId, setActivePlannedId] = useState<CandidateRouteId | null>(null)

  useEffect(() => {
    initLayers(manifest.layers)
  }, [initLayers, manifest.layers])

  const target = MISSION_TARGETS.find((item) => item.id === targetId)
  const targetWaypoint = waypoints.find((waypoint) => waypoint.id === TARGET_WAYPOINT_ID[targetId]) ?? null
  const startStation = waypoints.find((waypoint) => waypoint.id === startWaypointId) ?? waypoints[0] ?? null
  const routeEnd = route.length >= 2 ? route.at(-1) : undefined
  const destinationWaypoint = routeEnd
    ? waypoints.find((waypoint) => haversineKm(waypoint, routeEnd) <= 0.001) ?? null
    : targetWaypoint
  const destination = routeEnd && (!destinationWaypoint || destinationWaypoint.id !== targetWaypoint?.id)
    ? {
        ...routeEnd,
        id: destinationWaypoint?.id ?? 'user-point-2',
        name: destinationWaypoint?.name ?? `${formatCoord(routeEnd.lon, 'lon')} / ${formatCoord(routeEnd.lat, 'lat')}`,
        description: 'Traverse endpoint',
      }
    : target
  const thermalPercentile80 = manifest.layers.find((layer) => layer.id === 'thermal')?.percentile80 ?? 348
  const terrain = useMemo(() => buildTerrainProfile(dem, route), [dem, route])
  const routeSand = useMemo(() => assessRouteSand(sand, terrain.samples), [sand, terrain.samples])
  const scienceStopMinutes = useMemo(() => intermediateScienceStopMinutes(terrain, waypoints), [terrain, waypoints])
  const budget = useMemo(
    () => computeReturnBudget({ terrain, scienceStopMinutes, targetStayMinutes, reserveMinutes }),
    [terrain, scienceStopMinutes, targetStayMinutes, reserveMinutes],
  )
  const activeRadiationScenario = useMemo(
    () =>
      radiationScenarios.scenarios.find((s) => s.id === radiationScenarioId) ??
      radiationScenarios.scenarios[0],
    [radiationScenarios, radiationScenarioId],
  )
  const activeDoseRate = useMemo(
    () => resolveComponentDoseRate(activeRadiationScenario, radiationComponent).doseRateMicroGyPerHour,
    [activeRadiationScenario, radiationComponent],
  )
  const routeShielding = useMemo(
    () => assessRouteTopographicShielding(shieldingGrid, terrain.samples),
    [shieldingGrid, terrain.samples],
  )
  const eva = useMemo(
    () =>
      computeEva({
        terrain,
        routeWaypoints: terrain.samples.length >= 2 ? waypoints : [],
        target: routeEnd ?? target,
        requireTargetArrival: true,
        thermalPercentile80,
        thermalGrid: thermal,
        mineralogyGrid: mineralogy,
        sand: routeSand,
        duneNoGoAssumption,
        radiation: {
          scenarioId: activeRadiationScenario.id,
          doseRateMicroGyPerHour: activeDoseRate,
          budget,
          meanSkyVisibilityFraction: routeShielding.meanSkyVisibilityFraction,
        },
      }),
    [
      routeEnd,
      terrain,
      waypoints,
      target,
      thermalPercentile80,
      thermal,
      mineralogy,
      routeSand,
      duneNoGoAssumption,
      activeRadiationScenario.id,
      activeDoseRate,
      budget,
      routeShielding.meanSkyVisibilityFraction,
    ],
  )
  const radiationAssessment = useMemo(
    () =>
      computeEvaRadiationExposure({
        terrain,
        budget,
        scenario: activeRadiationScenario,
        component: radiationComponent,
        shieldingGrid,
      }),
    [terrain, budget, activeRadiationScenario, radiationComponent, shieldingGrid],
  )
  const selectedVerdict = combineVerdict(eva, budget)

  const presetAnalyses = useMemo<RouteAnalysis[]>(
    () =>
      PRESET_ROUTES.map((preset) => {
        const presetTerrain = buildTerrainProfile(dem, preset.waypoints)
        const presetSand = assessRouteSand(sand, presetTerrain.samples)
        const presetBudget = computeReturnBudget({
          terrain: presetTerrain,
          scienceStopMinutes: intermediateScienceStopMinutes(presetTerrain, waypoints),
          targetStayMinutes,
          reserveMinutes,
        })
        const presetShielding = assessRouteTopographicShielding(shieldingGrid, presetTerrain.samples)
        const presetEva = computeEva({
          terrain: presetTerrain,
          routeWaypoints: waypoints,
          target: preset.waypoints.at(-1),
          requireTargetArrival: true,
          thermalPercentile80,
          thermalGrid: thermal,
          mineralogyGrid: mineralogy,
          sand: presetSand,
          duneNoGoAssumption,
          radiation: {
            scenarioId: activeRadiationScenario.id,
            doseRateMicroGyPerHour: activeDoseRate,
            budget: presetBudget,
            meanSkyVisibilityFraction: presetShielding.meanSkyVisibilityFraction,
          },
        })
        const presetRadiation = computeEvaRadiationExposure({
          terrain: presetTerrain,
          budget: presetBudget,
          scenario: activeRadiationScenario,
          component: radiationComponent,
          shieldingGrid,
        })
        return {
          route: preset,
          terrain: presetTerrain,
          eva: presetEva,
          budget: presetBudget,
          verdict: combineVerdict(presetEva, presetBudget),
          radiation: presetRadiation,
        }
      }),
    [
      dem,
      sand,
      thermal,
      mineralogy,
      waypoints,
      thermalPercentile80,
      targetStayMinutes,
      reserveMinutes,
      duneNoGoAssumption,
      activeRadiationScenario,
      activeDoseRate,
      radiationComponent,
      shieldingGrid,
    ],
  )

  const hasUserPoints = route.length >= 2
  const point1 = route[0] ?? startStation ?? SHARED_START
  const point2 = routeEnd ?? targetWaypoint ?? target ?? SHARED_START

  const startLon = point1.lon
  const startLat = point1.lat
  const resolvedStartWpId =
    'waypointId' in point1 && point1.waypointId
      ? point1.waypointId
      : waypoints.find((w) => haversineKm(w, point1) <= 0.12)?.id
  const startLabel =
    (resolvedStartWpId ? waypoints.find((w) => w.id === resolvedStartWpId)?.name : undefined) ??
    (route.length > 0
      ? `Point 1 (${startLon.toFixed(4)}°E, ${startLat.toFixed(4)}°N)`
      : startStation?.name ?? 'Octavia E. Butler Landing')

  const endLon = point2.lon
  const endLat = point2.lat
  const resolvedEndWpId = destinationWaypoint?.id
  const endLabel =
    (resolvedEndWpId ? waypoints.find((w) => w.id === resolvedEndWpId)?.name : undefined) ??
    (hasUserPoints
      ? `Point 2 (${endLon.toFixed(4)}°E, ${endLat.toFixed(4)}°N)`
      : targetWaypoint?.name ?? 'Three Forks Depot')

  const assessmentContext = useMemo(() => ({
    dem, sand, thermal, mineralogy, waypoints, shieldingGrid,
    start: { lon: startLon, lat: startLat }, target: { lon: endLon, lat: endLat },
    thermalPercentile80, duneNoGoAssumption, targetStayMinutes, reserveMinutes,
    radiationScenarioId: activeRadiationScenario.id, doseRate: activeDoseRate,
  }), [dem, sand, thermal, mineralogy, waypoints, shieldingGrid, startLon, startLat, endLon, endLat,
    thermalPercentile80, duneNoGoAssumption, targetStayMinutes, reserveMinutes,
    activeRadiationScenario.id, activeDoseRate])

  const planner = useMemo(() => createTraversePlanner({
    dem, sand, thermal,
    start: { lon: startLon, lat: startLat },
    target: { lon: endLon, lat: endLat },
    duneNoGoAssumption,
  }), [dem, sand, thermal, startLon, startLat, endLon, endLat, duneNoGoAssumption])
  const shortest = useMemo(() => assessRouteCandidate(planner.shortest, assessmentContext), [planner, assessmentContext])

  const plannedAnalyses = useMemo<PlannedRouteAnalysis[]>(() => {
    const candidates = [shortest, analysisResult?.localRecommendation, analysisResult?.aiCandidate]
    return candidates.filter((candidate) => candidate != null).map((candidate) => ({
      ...candidate,
      ...CANDIDATE_PRESENTATION[candidate.id],
      radiation: computeEvaRadiationExposure({
        terrain: candidate.terrain, budget: candidate.budget, scenario: activeRadiationScenario,
        component: radiationComponent, shieldingGrid,
      }),
    }))
  }, [shortest, analysisResult, activeRadiationScenario, radiationComponent, shieldingGrid])

  const candidateMapRoutes = useMemo<CandidateMapRoute[]>(
    () =>
      plannedAnalyses.filter((item) => item.safety.reachable).map((item) => ({
        id: item.id,
        label: item.label,
        color: item.color,
        dashArray: item.dashArray,
        waypoints: item.waypoints,
        canApply: !item.safety.rejected,
      })),
    [plannedAnalyses],
  )

  async function runAiAnalysis() {
    const requestState = useMissionStore.getState()
    setAiLoading(true)
    setAiResult(null)
    setAiSelectionMessage('')
    try {
      const { baseline, best: localAlternative } = assessLocalAlternatives(planner, assessmentContext, PRESET_ROUTES)
      const candidateMetrics: CandidateRouteMetrics[] = [shortest, localAlternative ?? baseline]
        .map((item) => {
          const costInfo = computeRouteRiskCost({
            terrain: item.terrain,
            sand: item.sand,
            thermal,
            duneNoGoAssumption,
          })
          const visitedIds = waypoints
            .filter((w) => item.terrain.samples.some((s) => haversineKm(s, w) <= 0.25))
            .map((w) => w.id)
          return {
            id: item.id,
            label: item.id === 'route_b'
              ? localAlternative ? 'Best verified local alternative' : 'Balanced terrain baseline'
              : CANDIDATE_PRESENTATION.route_a.label,
            distanceKm: Number(item.terrain.totalKm.toFixed(3)),
            roundTripKm: Number((item.terrain.totalKm * 2).toFixed(3)),
            oneWayHours: Number((item.budget.outboundHours + item.budget.scienceStopMinutes / 60).toFixed(2)),
            roundTripHours: Number(item.budget.totalHours.toFixed(2)),
            marginHours: Number(item.budget.marginHours.toFixed(2)),
            elevationGainM: item.terrain.elevationGainM,
            elevationLossM: item.terrain.elevationLossM,
            maxSlopeDeg: Number(item.terrain.maxSlopeDeg.toFixed(1)),
            meanSlopeDeg: Number(item.terrain.meanSlopeDeg.toFixed(1)),
            steepSegmentCount15Deg: costInfo.steepSegmentCount15Deg,
            unknownDemFraction: Number(item.terrain.unknownFraction.toFixed(3)),
            sandKm: Number((item.sand.duneKm + item.sand.sandSheetKm).toFixed(3)),
            duneKm: item.sand.duneKm,
            sandSheetKm: item.sand.sandSheetKm,
            rockHazardCount: costInfo.rockHazardCount,
            highThermalFraction: costInfo.highThermalFraction,
            riskCost: item.riskCost,
            safetyScore: item.eva.safetyScore,
            searchWeights: item.searchWeights,
            scienceStopCount: item.eva.stopCount,
            visitedStationIds: visitedIds,
            targetReached: item.safety.targetReached,
            verdict: item.verdict,
          }
        })

      const requestBody: AiPlanRequest = {
        model: aiModel,
        mission: {
          start: { lon: startLon, lat: startLat, label: startLabel },
          target: {
            id: resolvedEndWpId ?? 'user-point-2',
            name: endLabel,
            lon: endLon,
            lat: endLat,
            summary: hasUserPoints
              ? `User-selected traverse from Point 1 (${startLon.toFixed(4)}°E, ${startLat.toFixed(4)}°N) to Point 2 (${endLon.toFixed(4)}°E, ${endLat.toFixed(4)}°N)`
              : target?.description ?? 'Jezero delta science objective',
          },
          timeLimitHours: EVA_CONFIG.timeLimitHours,
          targetStayMinutes,
          reserveMinutes,
          duneNoGoAssumption,
        },
        candidates: candidateMetrics,
        stations: waypoints.map((w) => ({
          id: w.id,
          name: w.name,
          lon: w.lon,
          lat: w.lat,
          kind: w.kind,
          minerals: w.minerals,
        })),
      }

      let response: AiPlanResponse
      try {
        const res = await fetch('/api/ml/plan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
          signal: AbortSignal.timeout(50_000),
        })
        response = (await res.json()) as AiPlanResponse
        if (typeof response?.ok !== 'boolean' ||
          (response.ok && (!res.ok || response.aiVerified !== true || !response.telemetry))) {
          throw new Error('The AI endpoint returned an invalid analysis.')
        }
        if (response.ok) response = { ...response, decision: validateAiDecision(response.decision) }
      } catch (err) {
        response = failedAiResponse(aiModel, err)
      }

      if (!sameRoutingContext(useMissionStore.getState(), requestState)) {
        setAiSelectionMessage('Mission changed during analysis. Run AI Analysis again for the current route.')
        return
      }
      const aiCandidate = response.ok && response.decision
        ? assessRouteCandidate(planner.weightedRoute(response.decision.riskWeights), assessmentContext)
        : null
      const current = { id: 'current' as const, waypoints: route,
        ...assessPlannedRoute(route, route.length >= 2, assessmentContext) }
      const candidates = [current, shortest, localAlternative, aiCandidate].filter((candidate) => candidate != null)
      const chosen = selectRecommendedRoute(candidates)
      if (!chosen) {
        setAiSelectionMessage('No feasible route found within the terrain and return-budget limits.')
      } else {
        const next = selectRecommendedRoute(candidates.filter(
          (candidate) => !sameRouteGeometry(chosen.waypoints, candidate.waypoints),
        ))
        const label = chosen.id === 'current' ? 'Current route' : CANDIDATE_PRESENTATION[chosen.id].label
        const comparison = next
          ? ` Compared with ${next.id === 'current' ? 'the current route' : CANDIDATE_PRESENTATION[next.id].label}: ${explainRoutePreference(chosen, next)}.`
          : ' Only eligible route found.'
        if (chosen.id !== 'current') {
          setActivePlannedId(chosen.id)
          loadPlannedRoute(chosen.waypoints, targetId, resolvedStartWpId, resolvedEndWpId)
        }
        setAiSelectionMessage(`${label} ${chosen.id === 'current' ? 'retained' : 'selected'}: ${chosen.verdict}. Safety ${chosen.eva.safetyScore}/100, ${chosen.budget.totalHours.toFixed(2)} h mission, ${chosen.terrain.maxSlopeDeg.toFixed(1)}° max slope, ${Math.floor(chosen.budget.marginHours * 60)} min beyond reserve.${comparison}`)
      }
      const retainsLocalRecommendation = chosen?.id === 'current' && activePlannedId === 'route_b' &&
        localAlternative && sameRouteGeometry(chosen.waypoints, localAlternative.waypoints)
      setAiResult({
        response, context: useMissionStore.getState(), aiCandidate,
        localRecommendation: chosen?.id === 'route_b' || retainsLocalRecommendation ? localAlternative : null,
        retainedCurrentRoute: chosen?.id === 'current',
      })
    } catch (err) {
      setAiSelectionMessage(err instanceof Error ? `Route analysis failed: ${err.message}` : 'Route analysis failed.')
    } finally {
      setAiLoading(false)
    }
  }

  const displayEva = useMemo<EvaResult>(() => {
    let verdictReason = eva.verdictReason
    if (budget.dataInsufficient) {
      verdictReason = `${Math.round(budget.unknownFraction * 100)}% of the route crosses terrain with no DEM coverage.`
    } else if (eva.verdict !== 'NO-GO' && !budget.targetReachable) {
      verdictReason = `The target cannot be reached and returned within the ${budget.timeLimitHours} h budget.`
    } else if (eva.verdict !== 'NO-GO' && budget.exceeded) {
      verdictReason = `Sample stop exceeds max stay by ${budget.excessMinutes} min; the return reserve is at risk.`
    }
    if (selectedVerdict === 'CAUTION') verdictReason = cautionReasons(eva, budget).join(' ')
    return { ...eva, verdict: selectedVerdict, verdictReason }
  }, [eva, budget, selectedVerdict])

  const selectedWaypoint = waypoints.find((waypoint) => waypoint.id === selectedWaypointId) ?? null
  const selectedSandFeature =
    sandDetections.features.find((feature) => feature.properties.id === selectedSandFeatureId) ?? null
  const ready = route.length >= 2
  const hasMeasuredRoute = terrain.totalKm >= MIN_TRAVERSE_KM
  const activePlannedAnalysis = useMemo(() => {
    if (!activePlannedId) return null
    const found = plannedAnalyses.find((item) => item.id === activePlannedId) ?? null
    return found && sameRouteGeometry(route, found.waypoints) ? found : null
  }, [activePlannedId, plannedAnalyses, route])
  const effectiveActivePlannedId = activePlannedAnalysis?.id ?? null
  const routeLabel = activePlannedAnalysis
    ? activePlannedAnalysis.label
    : presetRouteId
      ? presetRoute(presetRouteId).label
      : 'Custom traverse'

  function applyCandidateRoute(id: CandidateRouteId) {
    const chosen = plannedAnalyses.find((item) => item.id === id)
    if (!chosen || chosen.safety.rejected) return
    setActivePlannedId(chosen.id)
    loadPlannedRoute(chosen.waypoints, targetId, resolvedStartWpId, resolvedEndWpId)
    if (analysisResult) setAiResult({ ...analysisResult, context: useMissionStore.getState() })
  }

  function showSteepestSegment() {
    const segment = steepestSegment(terrain)
    if (!segment) return
    setHighlightSegment({ from: segment.from, to: segment.to })
    centerOn((segment.from.lon + segment.to.lon) / 2, (segment.from.lat + segment.to.lat) / 2)
  }

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-bg">
      <TopBar region={manifest.region.name} target={destination} />

      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto xl:grid-cols-[320px_minmax(0,1fr)_380px] xl:grid-rows-[minmax(0,1fr)] xl:overflow-hidden">
        <aside
          aria-label="Mission setup and layers"
          className="order-3 space-y-6 border-line px-5 py-5 xl:order-1 xl:h-full xl:min-h-0 xl:overflow-y-auto xl:border-r"
        >
          <MissionSetup />
          <RouteComparison
            analyses={presetAnalyses}
            selectedId={presetRouteId}
            onSelect={(id) => {
              setActivePlannedId(null)
              loadPresetRoute(id)
            }}
            plannedAnalyses={plannedAnalyses}
            activePlannedId={effectiveActivePlannedId}
            onSelectPlanned={(item) => applyCandidateRoute(item.id)}
            duneNoGoAssumption={duneNoGoAssumption}
            onDuneNoGoChange={setDuneNoGoAssumption}
            showCandidateOverlay={showCandidateOverlay}
            onShowCandidateOverlayChange={setShowCandidateOverlay}
            waypoints={waypoints}
            startWaypointId={startWaypointId}
            onStartWaypointChange={(id) => {
              setStartWaypointId(id)
              setAiResult(null)
              setActivePlannedId(null)
            }}
            point1Label={startLabel}
            point2Label={endLabel}
            hasUserPoints={hasUserPoints}
            aiModel={aiModel}
            onAiModelChange={(model) => {
              setAiModel(model)
              setAiResult(null)
              setAiSelectionMessage('')
            }}
            aiLoading={aiLoading}
            aiResponse={aiResponse}
            aiSelectionMessage={aiSelectionMessage}
            onRunAiAnalysis={runAiAnalysis}
          />
          <LayerPanel manifest={manifest} />

          <footer className="border-t border-line pt-4">
            <p className="meta">provenance</p>
            <p className="mt-1.5 text-[9.5px] leading-relaxed text-faint">
              Local NASA, USGS and ASU products. Elevation from the Mars 2020 DEM mosaic, thermal inertia from THEMIS,
              2.30 µm band depth from CRISM, surface radiation reference from Curiosity MSL RAD RDR (`MSL-M-RAD-3-RDR-V1.0`)
              and MAVEN SEP context. No live data.
            </p>
            <p className="mt-2 text-[9px] text-faint">Planning aid, not flight software.</p>
          </footer>
        </aside>

        <main className="order-1 h-[60vh] min-h-[360px] xl:order-2 xl:h-full" aria-label="Terrain map">
          <TerrainView
            manifest={manifest}
            dem={dem}
            sand={sand}
            thermal={thermal}
            temperature={temperature}
            waypoints={waypoints}
            terrain={terrain}
            sandDetections={sandDetections}
            candidateRoutes={candidateMapRoutes}
            activeCandidateId={effectiveActivePlannedId}
            showRouteDirections={Boolean(effectiveActivePlannedId || analysisResult?.retainedCurrentRoute)}
            onApplyCandidateRoute={applyCandidateRoute}
          />
        </main>

        <aside
          aria-label="Assessment and stations"
          className="order-2 flex flex-col border-line xl:order-3 xl:h-full xl:min-h-0 xl:overflow-hidden xl:border-l"
        >
          <VerdictPlate eva={displayEva} ready={ready} onShowSteepest={showSteepestSegment} />

          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6">
            <div className="pt-4">
              <ReturnByCard
                routeLabel={routeLabel}
                target={destination}
                targetWaypoint={destinationWaypoint ?? undefined}
                budget={budget}
                verdict={selectedVerdict}
                ready={hasMeasuredRoute}
                onOpenBrief={() => setBriefOpen(true)}
              />
            </div>
            {hasMeasuredRoute ? (
              <BudgetControls
                budget={budget}
                targetStayMinutes={targetStayMinutes}
                reserveMinutes={reserveMinutes}
                onTargetStayChange={setTargetStayMinutes}
                onReserveChange={setReserveMinutes}
              />
            ) : null}
            <Tabs defaultValue="traverse" className="mt-4">
              <TabsList>
                <TabsTrigger value="traverse">Traverse</TabsTrigger>
                <TabsTrigger value="radiation">Radiation</TabsTrigger>
                <TabsTrigger value="stations">Stations</TabsTrigger>
              </TabsList>

              <TabsContent value="traverse" className="space-y-5">
                <RoutePanel
                  terrain={terrain}
                  eva={eva}
                  bounds={manifest.region.bounds}
                />
                <ElevationProfile terrain={terrain} />
                <EvaScoreCard eva={eva} terrain={terrain} ready={ready} />
                <RadiationPanel
                  assessment={radiationAssessment}
                  reference={radiationReference}
                  scenarios={radiationScenarios}
                  provenance={radiationProvenance}
                />
              </TabsContent>

              <TabsContent value="radiation" className="space-y-5">
                <RadiationPanel
                  assessment={radiationAssessment}
                  reference={radiationReference}
                  scenarios={radiationScenarios}
                  provenance={radiationProvenance}
                />
              </TabsContent>

              <TabsContent value="stations">
                <WaypointList waypoints={waypoints} />
              </TabsContent>
            </Tabs>
          </div>
        </aside>
      </div>

      <WaypointDialog waypoint={selectedWaypoint} />
      <SandFeatureDialog feature={selectedSandFeature} />
      <MissionBrief
        manifest={manifest}
        dem={dem}
        route={route}
        terrain={terrain}
        eva={displayEva}
        budget={budget}
        radiation={radiationAssessment}
        target={destination}
        targetWaypoint={destinationWaypoint}
        routeLabel={routeLabel}
        cards={waypoints}
      />
    </div>
  )
}

export default function App() {
  const [data, setData] = useState<MissionData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const hasLatestData = Boolean(
    data?.temperature &&
      data?.mineralogy &&
      data.manifest.layers.some((layer) => layer.id === 'temperature'),
  )

  useEffect(() => {
    const controller = new AbortController()
    loadMissionData(controller.signal)
      .then(setData)
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return
        setError(reason instanceof Error ? reason.message : String(reason))
      })
    return () => controller.abort()
  }, [attempt, hasLatestData])

  if (error) {
    return (
      <ErrorScreen
        message={error}
        onRetry={() => {
          setError(null)
          setAttempt((value) => value + 1)
        }}
      />
    )
  }
  if (!data) return <LoadingScreen />
  return <Planner data={data} />
}
