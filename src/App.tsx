import { useEffect, useMemo, useState } from 'react'
import { BudgetControls } from '@/components/BudgetControls'
import { ElevationProfile } from '@/components/ElevationProfile'
import { EvaScoreCard } from '@/components/EvaScoreCard'
import { LayerPanel } from '@/components/LayerPanel'
import { Map2D } from '@/components/Map2D'
import { MissionBrief } from '@/components/MissionBrief'
import { MissionSetup } from '@/components/MissionSetup'
import { ReturnByCard } from '@/components/ReturnByCard'
import { RouteComparison, type RouteAnalysis } from '@/components/RouteComparison'
import { RoutePanel } from '@/components/RoutePanel'
import { TopBar } from '@/components/TopBar'
import { VerdictPlate } from '@/components/VerdictPlate'
import { WaypointDialog, WaypointList } from '@/components/WaypointCard'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { MISSION_TARGETS, TARGET_WAYPOINT_ID } from '@/config/region'
import { PRESET_ROUTES, presetRoute } from '@/config/routes'
import { loadMissionData, type MissionData } from '@/domain/data'
import { buildTerrainProfile, steepestSegment } from '@/domain/dem'
import { computeEva } from '@/domain/eva'
import { combineVerdict, computeReturnBudget } from '@/domain/returnBudget'
import type { EvaResult } from '@/types'
import { useMissionStore } from '@/store/useMissionStore'

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
  const { manifest, dem, waypoints } = data
  const route = useMissionStore((state) => state.route)
  const presetRouteId = useMissionStore((state) => state.presetRouteId)
  const targetId = useMissionStore((state) => state.targetId)
  const targetStayMinutes = useMissionStore((state) => state.targetStayMinutes)
  const reserveMinutes = useMissionStore((state) => state.reserveMinutes)
  const setTargetStayMinutes = useMissionStore((state) => state.setTargetStayMinutes)
  const setReserveMinutes = useMissionStore((state) => state.setReserveMinutes)
  const loadPresetRoute = useMissionStore((state) => state.loadPresetRoute)
  const setHighlightSegment = useMissionStore((state) => state.setHighlightSegment)
  const centerOn = useMissionStore((state) => state.centerOn)
  const setBriefOpen = useMissionStore((state) => state.setBriefOpen)
  const selectedWaypointId = useMissionStore((state) => state.selectedWaypointId)
  const initLayers = useMissionStore((state) => state.initLayers)

  useEffect(() => {
    initLayers(manifest.layers)
  }, [initLayers, manifest.layers])

  const target = MISSION_TARGETS.find((item) => item.id === targetId)
  const thermalPercentile80 = manifest.layers.find((layer) => layer.id === 'thermal')?.percentile80 ?? 348
  const terrain = useMemo(() => buildTerrainProfile(dem, route), [dem, route])
  const routeWaypoints = useMemo(
    () => waypoints.filter((waypoint) => route.some((point) => point.waypointId === waypoint.id)),
    [route, waypoints],
  )
  const eva = useMemo(
    () => computeEva({ terrain, routeWaypoints, target, thermalPercentile80 }),
    [terrain, routeWaypoints, target, thermalPercentile80],
  )
  const budget = useMemo(
    () => computeReturnBudget({ terrain, targetStayMinutes, reserveMinutes }),
    [terrain, targetStayMinutes, reserveMinutes],
  )
  const selectedVerdict = combineVerdict(eva, budget)

  const presetAnalyses = useMemo<RouteAnalysis[]>(
    () =>
      PRESET_ROUTES.map((preset) => {
        const presetWaypoints = waypoints.filter((waypoint) => {
          const index = preset.waypoints.findIndex(
            (point) => point.lon === waypoint.lon && point.lat === waypoint.lat,
          )
          return index === 0 || index === preset.waypoints.length - 1
        })
        const presetTarget = MISSION_TARGETS.find((item) => item.id === preset.targetId)
        const presetTerrain = buildTerrainProfile(dem, preset.waypoints)
        const presetEva = computeEva({
          terrain: presetTerrain,
          routeWaypoints: presetWaypoints,
          target: presetTarget,
          thermalPercentile80,
        })
        const presetBudget = computeReturnBudget({
          terrain: presetTerrain,
          targetStayMinutes,
          reserveMinutes,
        })
        return {
          route: preset,
          terrain: presetTerrain,
          eva: presetEva,
          budget: presetBudget,
          verdict: combineVerdict(presetEva, presetBudget),
        }
      }),
    [dem, waypoints, thermalPercentile80, targetStayMinutes, reserveMinutes],
  )

  const displayEva = useMemo<EvaResult>(() => {
    let verdictReason = eva.verdictReason
    if (budget.dataInsufficient) {
      verdictReason = `${Math.round(budget.unknownFraction * 100)}% of the route crosses terrain with no DEM coverage.`
    } else if (!budget.targetReachable) {
      verdictReason = `The target cannot be reached and returned within the ${budget.timeLimitHours} h budget.`
    } else if (budget.exceeded) {
      verdictReason = `Sample stop exceeds max stay by ${budget.excessMinutes} min; the return reserve is at risk.`
    } else if (budget.marginHours < 0.5) {
      verdictReason = 'Return margin is below 30 minutes.'
    } else if (budget.totalHours > budget.timeLimitHours * 0.8) {
      verdictReason = 'Total mission time uses more than 80% of the six hour budget.'
    }
    return { ...eva, verdict: selectedVerdict, verdictReason }
  }, [eva, budget, selectedVerdict])

  const targetWaypoint = waypoints.find((waypoint) => waypoint.id === TARGET_WAYPOINT_ID[targetId]) ?? null
  const selectedWaypoint = waypoints.find((waypoint) => waypoint.id === selectedWaypointId) ?? null
  const ready = route.length >= 2
  const routeLabel = presetRouteId ? presetRoute(presetRouteId).label : 'Custom traverse'

  function showSteepestSegment() {
    const segment = steepestSegment(terrain)
    if (!segment) return
    setHighlightSegment({ from: segment.from, to: segment.to })
    centerOn((segment.from.lon + segment.to.lon) / 2, (segment.from.lat + segment.to.lat) / 2)
  }

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-bg">
      <TopBar region={manifest.region.name} target={target} />

      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto xl:grid-cols-[288px_minmax(0,1fr)_344px] xl:grid-rows-[minmax(0,1fr)] xl:overflow-hidden">
        <aside
          aria-label="Mission setup and layers"
          className="order-3 space-y-6 border-line px-5 py-5 xl:order-1 xl:h-full xl:min-h-0 xl:overflow-y-auto xl:border-r"
        >
          <MissionSetup />
          <RouteComparison
            analyses={presetAnalyses}
            selectedId={presetRouteId}
            onSelect={loadPresetRoute}
          />
          <LayerPanel manifest={manifest} />

          <footer className="border-t border-line pt-4">
            <p className="meta">provenance</p>
            <p className="mt-1.5 text-[9.5px] leading-relaxed text-faint">
              Local NASA, USGS and ASU products. Elevation from the Mars 2020 DEM mosaic, thermal inertia from THEMIS,
              2.30 µm band depth from CRISM. No live data.
            </p>
            <p className="mt-2 text-[9px] text-faint">Planning aid, not flight software.</p>
          </footer>
        </aside>

        <main className="order-1 h-[60vh] min-h-[360px] xl:order-2 xl:h-full" aria-label="Terrain map">
          <Map2D manifest={manifest} dem={dem} waypoints={waypoints} terrain={terrain} />
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
                target={target}
                targetWaypoint={targetWaypoint ?? undefined}
                budget={budget}
                verdict={selectedVerdict}
                ready={ready}
                onOpenBrief={() => setBriefOpen(true)}
              />
            </div>
            {ready ? (
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
                <TabsTrigger value="stations">Stations</TabsTrigger>
              </TabsList>

              <TabsContent value="traverse" className="space-y-5">
                <RoutePanel terrain={terrain} eva={eva} bounds={manifest.region.bounds} />
                <ElevationProfile terrain={terrain} />
                <EvaScoreCard eva={eva} terrain={terrain} ready={ready} />
              </TabsContent>

              <TabsContent value="stations">
                <WaypointList waypoints={waypoints} />
              </TabsContent>
            </Tabs>
          </div>
        </aside>
      </div>

      <WaypointDialog waypoint={selectedWaypoint} />
      <MissionBrief
        manifest={manifest}
        dem={dem}
        route={route}
        terrain={terrain}
        eva={displayEva}
        budget={budget}
        target={target}
        targetWaypoint={targetWaypoint}
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

  useEffect(() => {
    const controller = new AbortController()
    loadMissionData(controller.signal)
      .then(setData)
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return
        setError(reason instanceof Error ? reason.message : String(reason))
      })
    return () => controller.abort()
  }, [attempt])

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
