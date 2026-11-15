import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import type {
  AiDecision,
  AiModelId,
  AiPlanResponse,
  CandidateRouteId,
  RiskWeights,
} from '@/domain/aiPlannerSchema'
import type { RouteTerrain } from '@/domain/dem'
import { formatDuration, formatKm } from '@/domain/geo'
import { cautionReasons } from '@/domain/returnBudget'
import type { EvaRadiationAssessment } from '@/domain/radiation'
import type { RouteSafetyVerification } from '@/domain/sand'
import type {
  EvaResult,
  LonLat,
  PresetRoute,
  PresetRouteId,
  ReturnBudget,
  RouteSandAssessment,
  Verdict,
  Waypoint,
} from '@/types'

export interface RouteAnalysis {
  route: PresetRoute
  terrain: RouteTerrain
  eva: EvaResult
  budget: ReturnBudget
  verdict: Verdict
  radiation?: EvaRadiationAssessment
}

export interface PlannedRouteAnalysis {
  id: CandidateRouteId
  mode: 'shortest' | 'risk-aware' | 'ai-optimized'
  label: string
  summary: string
  color: string
  dashArray?: string
  waypoints: LonLat[]
  terrain: RouteTerrain
  sand: RouteSandAssessment
  eva: EvaResult
  budget: ReturnBudget
  verdict: Verdict
  riskCost: number
  weights: RiskWeights
  safety: RouteSafetyVerification
  radiation?: EvaRadiationAssessment
}

const VERDICT_COLOR: Record<Verdict, string> = {
  GO: 'var(--go)',
  CAUTION: 'var(--caution)',
  'NO-GO': 'var(--danger)',
  'INSUFFICIENT DATA': 'var(--caution)',
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: 'danger' | 'caution' }) {
  return (
    <div>
      <div className="text-[13px] text-faint">{label}</div>
      <div
        className="num mt-1 font-mono text-[15px] text-ink"
        style={tone ? { color: tone === 'danger' ? 'var(--danger)' : 'var(--caution)' } : undefined}
      >
        {value}
      </div>
    </div>
  )
}

function CautionExplanation({ eva, budget }: { eva: EvaResult; budget: ReturnBudget }) {
  return (
    <div className="mt-2 border-l-2 border-caution bg-caution/10 px-3 py-3 text-[14px] leading-relaxed text-caution">
      <span className="font-semibold">Why CAUTION?</span>
      <ul className="mt-1 space-y-1">
        {cautionReasons(eva, budget).map(reason => <li key={reason}>{reason}</li>)}
      </ul>
    </div>
  )
}

export function RouteComparison({
  analyses,
  selectedId,
  onSelect,
  plannedAnalyses,
  activePlannedId = null,
  onSelectPlanned,
  duneNoGoAssumption = false,
  onDuneNoGoChange,
  showCandidateOverlay = true,
  onShowCandidateOverlayChange,
  waypoints = [],
  startWaypointId = 'wp-01',
  onStartWaypointChange,
  point1Label,
  point2Label,
  hasUserPoints = false,
  aiModel = 'jezero-ml',
  onAiModelChange,
  aiLoading = false,
  aiResponse = null,
  aiSelectionMessage = '',
  onRunAiAnalysis,
}: {
  analyses: RouteAnalysis[]
  selectedId: PresetRouteId | null
  onSelect: (id: PresetRouteId) => void
  plannedAnalyses?: PlannedRouteAnalysis[]
  activePlannedId?: CandidateRouteId | null
  onSelectPlanned?: (analysis: PlannedRouteAnalysis) => void
  duneNoGoAssumption?: boolean
  onDuneNoGoChange?: (enabled: boolean) => void
  showCandidateOverlay?: boolean
  onShowCandidateOverlayChange?: (visible: boolean) => void
  waypoints?: Waypoint[]
  startWaypointId?: string
  onStartWaypointChange?: (id: string) => void
  point1Label?: string
  point2Label?: string
  hasUserPoints?: boolean
  aiModel?: AiModelId
  onAiModelChange?: (model: AiModelId) => void
  aiLoading?: boolean
  aiResponse?: AiPlanResponse | null
  aiSelectionMessage?: string
  onRunAiAnalysis?: () => void
}) {
  const decision: AiDecision | null =
    aiResponse?.ok && aiResponse.aiVerified ? aiResponse.decision : null

  return (
    <section aria-labelledby="route-comparison-heading" className="space-y-5">
      {plannedAnalyses && plannedAnalyses.length > 0 ? (
        <div className="border border-accent/40 bg-surface-2/40 p-3.5" aria-labelledby="ai-planner-heading">
          <div className="flex items-baseline justify-between">
            <h3 id="ai-planner-heading" className="heading text-accent">
              AI Route Planner
            </h3>
            <span className="meta">A* + Random Forest ML</span>
          </div>
          <p className="mt-1 text-[13px] leading-relaxed text-faint">
            Select Point 1 and Point 2. Route analysis compares local terrain searches and the available AI
            candidate within the return budget. It prefers higher safety, then shorter mission time at equal safety.
          </p>

          {onRunAiAnalysis ? (
            <div className="mt-3">
              <Button
                type="button"
                variant="default"
                size="sm"
                disabled={aiLoading}
                onClick={onRunAiAnalysis}
                className="h-10 w-full justify-between bg-accent px-3.5 font-mono text-[13px] font-semibold text-bg hover:bg-accent/90"
              >
                <span>{aiLoading ? 'Analyzing via ML…' : '▶ Run AI Analysis'}</span>
                <span className="text-[12px] opacity-90">ml-local · R² 0.93</span>
              </Button>
            </div>
          ) : null}

          {point1Label && point2Label ? (
            <div className="mt-2.5 border border-line bg-surface-2/60 p-2 font-mono text-[13px]">
              <div className="flex items-start justify-between gap-3">
                <span className="text-faint">Point 1 (Start)</span>
                <span className="truncate text-ink">{point1Label}</span>
              </div>
              <div className="mt-1 flex items-start justify-between gap-3">
                <span className="text-faint">Point 2 (End)</span>
                <span className="truncate text-ink">{point2Label}</span>
              </div>
              {!hasUserPoints ? (
                <p className="mt-1 font-sans text-[13px] text-faint">
                  Tip: Click any 2 points on the map to route between custom coordinates.
                </p>
              ) : null}
            </div>
          ) : null}

          {waypoints.length > 0 && onStartWaypointChange ? (
            <div className="mt-2.5 grid grid-cols-2 gap-2">
              <label className="block">
                <span className="meta mb-1 block">Default start station</span>
                <select
                  aria-label="Start station"
                  value={startWaypointId}
                  onChange={(e) => onStartWaypointChange(e.target.value)}
                  className="input h-10 w-full px-1.5 text-[13px]"
                >
                  {waypoints.map((wp) => (
                    <option key={wp.id} value={wp.id}>
                      {wp.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="meta mb-1 block">ML model</span>
                <select
                  aria-label="AI model"
                  disabled={aiLoading}
                  value={aiModel}
                  onChange={(e) => onAiModelChange?.(e.target.value as AiModelId)}
                  className="input h-10 w-full px-1.5 text-[13px]"
                >
                  <option value="jezero-ml">ml-local (Jezero RF)</option>
                </select>
              </label>
            </div>
          ) : null}

          <div className="mt-2.5 space-y-2 border border-line bg-surface-2/40 p-2.5">
            {onDuneNoGoChange ? (
              <div className="flex items-start justify-between gap-2.5">
                <div className="min-w-0">
                  <div className="text-[13px] font-medium text-ink">Treat dense dune fields as NO-GO</div>
                  <p className="mt-0.5 text-[13px] leading-relaxed text-faint">
                    Orbital data cannot measure bearing capacity; enable only when mission rules forbid crossing active
                    bedforms.
                  </p>
                </div>
                <Switch
                  checked={duneNoGoAssumption}
                  onCheckedChange={onDuneNoGoChange}
                  aria-label="Treat dense dune fields as NO-GO"
                />
              </div>
            ) : null}

            {onShowCandidateOverlayChange ? (
              <div className="flex items-center justify-between gap-2.5 border-t border-line pt-2">
                <span className="text-[13px] text-muted">Show normal / AI routes on map</span>
                <Switch
                  checked={showCandidateOverlay}
                  onCheckedChange={onShowCandidateOverlayChange}
                  aria-label="Show normal / AI routes on map"
                />
              </div>
            ) : null}
          </div>

          {aiSelectionMessage ? (
            <p role="status" aria-label="Route selection" className="mt-2.5 border-l-2 border-signal bg-surface-2/50 p-2.5 text-[13px] leading-relaxed text-ink">
              {aiSelectionMessage}
            </p>
          ) : null}

          {aiResponse && !aiResponse.ok ? (
            <div
              role="status"
              aria-label="AI status"
              className="mt-2.5 border-l-2 border-caution bg-surface-2/50 p-2.5"
            >
              <div className="flex items-start justify-between gap-3">
                <span className="shrink-0 font-mono text-[14px] font-semibold text-caution">
                  AI Not Verified · Local Routes Active
                </span>
                <span className="font-mono text-[13px] text-faint">{aiResponse.errorCode}</span>
              </div>
              <p className="mt-1 text-[13px] leading-relaxed text-muted">{aiResponse.error}</p>
            </div>
          ) : null}

          {decision && aiResponse ? (
            <div
              role="region"
              aria-label="AI assessment"
              className="mt-2.5 border-l-2 border-[#3b82f6] bg-surface-2/60 p-2.5"
            >
              <div className="flex items-start justify-between gap-3">
                <span className="shrink-0 font-mono text-[14px] font-semibold text-[#60a5fa]">
                  ML Response Validated (ml-local)
                </span>
                <span className="font-mono text-[13px] text-faint">
                  {aiResponse.cached ? 'cached' : `${aiResponse.telemetry.latencyMs} ms`} · RF+Ridge
                </span>
              </div>

              <details className="my-3 text-[13px] text-muted">
                <summary className="cursor-pointer py-2">Model search proposal</summary>
              <div className="mt-1.5 grid grid-cols-4 gap-1 border-y border-line py-1 text-center font-mono text-[13px]">
                <div>
                  <span className="block text-faint">slope</span>
                  <span className="text-ink">{decision.riskWeights.slope.toFixed(2)}</span>
                </div>
                <div>
                  <span className="block text-faint">sand</span>
                  <span className="text-ink">{decision.riskWeights.sand.toFixed(2)}</span>
                </div>
                <div>
                  <span className="block text-faint">rock</span>
                  <span className="text-ink">{decision.riskWeights.rock.toFixed(2)}</span>
                </div>
                <div>
                  <span className="block text-faint">uncert</span>
                  <span className="text-ink">{decision.riskWeights.uncertainty.toFixed(2)}</span>
                </div>
              </div>

              <ul className="mt-1.5 space-y-1">
                {decision.reasoning.map((line, idx) => (
                  <li key={idx} className="text-[13px] leading-relaxed text-ink">
                    • {line}
                  </li>
                ))}
              </ul>

              {decision.warnings.length > 0 ? (
                <div className="mt-1.5 border-t border-line pt-1.5">
                  {decision.warnings.map((warn, idx) => (
                    <p key={idx} className="text-[13px] leading-relaxed text-caution">
                      ⚠ {warn}
                    </p>
                  ))}
                </div>
              ) : null}
              </details>
            </div>
          ) : null}

          <div className="mt-2.5 divide-y divide-line border-y border-line">
            {plannedAnalyses.map((item) => {
              const selected = activePlannedId === item.id
              const sandKm = item.sand.duneKm + item.sand.sandSheetKm
              const sandExposurePct = Math.round((item.sand.duneFraction + item.sand.sandSheetFraction) * 100)
              const coveragePct = Math.round((1 - item.terrain.unknownFraction) * 100)
              const marginTone =
                item.budget.marginHours < 0 ? 'danger' : item.budget.marginHours < 0.5 ? 'caution' : undefined
              const sandTone =
                item.sand.duneFraction >= 0.08 && duneNoGoAssumption
                  ? 'danger'
                  : item.sand.duneFraction > 0 || item.sand.sandSheetFraction >= 0.1
                    ? 'caution'
                    : undefined
              return (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={selected}
                  disabled={item.safety.rejected}
                  onClick={() => onSelectPlanned?.(item)}
                  className={`block w-full border-l-2 py-4 pl-3 pr-2 text-left transition-colors ${
                    selected
                      ? 'bg-surface-2/70'
                      : 'border-l-transparent hover:border-l-line-2 hover:bg-surface-2/40'
                  }`}
                  style={selected ? { borderLeftColor: item.color } : undefined}
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className="flex min-w-0 flex-1 items-baseline gap-2">
                      <span className="h-2.5 w-2.5 shrink-0" style={{ backgroundColor: item.color }} aria-hidden />
                      <span className="min-w-0 whitespace-normal text-[15px] font-semibold text-ink">{item.label}</span>
                    </span>
                    <span
                      className="shrink-0 font-mono text-[14px] font-semibold"
                      style={{ color: VERDICT_COLOR[item.verdict] }}
                    >
                      {item.verdict}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[13px] leading-relaxed text-faint">
                    {item.summary}
                  </p>

                  {item.verdict === 'CAUTION' ? <CautionExplanation eva={item.eva} budget={item.budget} /> : null}
                  <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-3">
                    <Metric label="Distance" value={formatKm(item.terrain.totalKm)} />
                    <Metric label="Round-trip time" value={formatDuration(item.budget.totalHours)} />
                    <Metric label="Max slope" value={`${item.terrain.maxSlopeDeg.toFixed(1)}°`} />
                    <Metric
                      label="Sand exposure"
                      value={`${sandExposurePct}% (${sandKm.toFixed(2)} km)`}
                      tone={sandTone}
                    />
                    <Metric label="Comparable risk cost" value={item.riskCost.toFixed(1)} />
                    <Metric label="Safety score" value={`${item.eva.safetyScore}/100`} />
                    <Metric label="Science stops" value={`${item.eva.stopCount}`} />
                    <Metric
                      label="EVA reserve"
                      value={formatDuration(item.budget.marginHours)}
                      tone={marginTone}
                    />
                    <Metric
                      label="Data coverage"
                      value={`${coveragePct}% DEM`}
                      tone={coveragePct < 95 ? 'caution' : undefined}
                    />
                    {item.radiation ? (
                      <>
                        <Metric
                          label="Est. radiation"
                          value={`${item.radiation.totalModeledExposureMicroGy.toFixed(1)} µGy ±${item.radiation.uncertaintyPercent}%`}
                          tone={item.radiation.scenarioId === 'sep_sep2017' ? 'caution' : undefined}
                        />
                        <Metric
                          label="Rad. basis"
                          value={`${item.radiation.totalExposureHours.toFixed(2)} h × ${item.radiation.referenceDoseRateMicroGyPerHour.toFixed(1)} µGy/h`}
                        />
                      </>
                    ) : null}
                  </div>

                  {item.radiation ? (
                    <p className="mt-1.5 text-[13px] leading-relaxed text-faint">
                      Dose difference between routes reflects EVA duration in a shared regional field (±
                      {item.radiation.uncertaintyPercent}% model uncertainty), not verified local radiation hotspots.
                    </p>
                  ) : null}

                  {item.safety.rejected ? (
                    <p className="mt-1.5 font-mono text-[13px] text-danger">
                      Rejected by safety check: {item.safety.rejectionReasons[0]}
                    </p>
                  ) : item.sand.duneKm > 0 ? (
                    <p className="mt-1.5 font-mono text-[13px] text-caution">
                      High-risk dune crossing: {item.sand.duneKm.toFixed(2)} km ({item.sand.hazardSegments.length}{' '}
                      segment{item.sand.hazardSegments.length === 1 ? '' : 's'})
                    </p>
                  ) : null}

                  <div className="mt-2 flex items-center justify-between border-t border-line/60 pt-1.5 font-mono text-[13px]">
                    <span style={{ color: selected ? item.color : undefined }} className={selected ? 'font-semibold' : 'text-muted'}>
                      {selected ? '● Active Main Route' : item.safety.rejected ? 'Unavailable' : '→ Click to set as Main Route'}
                    </span>
                    <span className="text-faint">{item.waypoints.length} pts</span>
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      ) : null}

      <div>
        <div className="flex items-baseline justify-between">
          <h2 id="route-comparison-heading" className="heading">
            Route comparison
          </h2>
          <span className="meta">same start / target</span>
        </div>
        <p className="mt-1 text-[13px] leading-relaxed text-faint">
          Two pre-planned traverses; select one to load it into the map and field card.
        </p>

        <div className="mt-2 divide-y divide-line border-y border-line">
          {analyses.map(({ route, budget, terrain, verdict, radiation, eva }) => {
            const selected = selectedId === route.id
            const marginTone = budget.marginHours < 0 ? 'danger' : budget.marginHours < 0.5 ? 'caution' : undefined
            return (
              <button
                key={route.id}
                type="button"
                aria-pressed={selected}
                onClick={() => onSelect(route.id)}
                className={`block w-full border-l-2 py-4 pl-3 pr-2 text-left transition-colors ${
                  selected
                    ? 'border-l-accent bg-surface-2/70'
                    : 'border-l-transparent hover:border-l-line-2 hover:bg-surface-2/40'
                }`}
                style={selected ? { borderLeftColor: route.color } : undefined}
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="flex min-w-0 flex-1 items-baseline gap-2">
                    <span className="h-2 w-2 shrink-0" style={{ backgroundColor: route.color }} aria-hidden />
                    <span className="min-w-0 whitespace-normal text-[15px] font-semibold text-ink">{route.label}</span>
                  </span>
                  <span className="shrink-0 font-mono text-[14px] font-semibold" style={{ color: VERDICT_COLOR[verdict] }}>
                    {verdict}
                  </span>
                </div>

                <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-3">
                  <Metric label="Total mission" value={formatDuration(budget.totalHours)} />
                  <Metric label="Max slope" value={`${terrain.maxSlopeDeg.toFixed(1)}°`} />
                  <Metric label="Return margin" value={formatDuration(budget.marginHours)} tone={marginTone} />
                  <Metric label="Distance" value={formatKm(terrain.totalKm)} />
                  {radiation ? (
                    <>
                      <Metric
                        label="Est. radiation"
                        value={`${radiation.totalModeledExposureMicroGy.toFixed(1)} µGy ±${radiation.uncertaintyPercent}%`}
                        tone={radiation.scenarioId === 'sep_sep2017' ? 'caution' : undefined}
                      />
                      <Metric
                        label="Rad. scenario"
                        value={radiation.scenarioId === 'sep_sep2017' ? 'Sep 2017 SEP' : 'GCR Baseline'}
                      />
                    </>
                  ) : null}
                </div>

                {verdict === 'CAUTION' ? <CautionExplanation eva={eva} budget={budget} /> : null}
                {budget.exceeded ? (
                  <p className="mt-1.5 text-[13px] leading-relaxed text-danger">
                    Target stay exceeds max by {budget.excessMinutes} min.
                  </p>
                ) : budget.dataInsufficient ? (
                  <p className="mt-1.5 text-[13px] leading-relaxed text-caution">Route crosses no-data terrain.</p>
                ) : null}
              </button>
            )
          })}
        </div>
      </div>
    </section>
  )
}
