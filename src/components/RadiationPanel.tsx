import { useState } from 'react'
import { Switch } from '@/components/ui/switch'
import type { EvaRadiationAssessment } from '@/domain/radiation'
import type {
  RadiationComponentId,
  RadiationProvenanceData,
  RadiationReferenceData,
  RadiationScenarioId,
  RadiationScenariosData,
  RadObservationRecord,
} from '@/types'
import { useMissionStore } from '@/store/useMissionStore'

function MetricCell({
  label,
  value,
  sub,
  tone,
}: {
  label: string
  value: string
  sub?: string
  tone?: 'caution' | 'info'
}) {
  return (
    <div className="border border-line bg-surface-2/40 p-2">
      <div className="text-[9px] text-faint">{label}</div>
      <div
        className="num mt-0.5 font-mono text-[12px] font-semibold text-ink"
        style={
          tone === 'caution'
            ? { color: 'var(--caution)' }
            : tone === 'info'
              ? { color: '#38bdf8' }
              : undefined
        }
      >
        {value}
      </div>
      {sub ? <div className="mt-0.5 font-mono text-[8.5px] text-muted">{sub}</div> : null}
    </div>
  )
}

function HistoricalRadChart({
  records,
  mode,
  onModeChange,
}: {
  records: RadObservationRecord[]
  mode: 'sep2017' | 'solar_cycle'
  onModeChange: (mode: 'sep2017' | 'solar_cycle') => void
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)
  if (!records.length) return null

  const width = 280
  const height = 112
  const padL = 28
  const padR = 8
  const padT = 10
  const padB = 20
  const plotW = width - padL - padR
  const plotH = height - padT - padB

  const allVals = records.flatMap((r) => [
    r.absorbedDoseRateTissuePlasticMicroGyPerHour,
    r.absorbedDoseRateSiliconMicroGyPerHour,
  ])
  const minVal = Math.max(0, Math.floor(Math.min(...allVals) - 1.5))
  const maxVal = Math.ceil(Math.max(...allVals) + 1.5)
  const spanVal = Math.max(1, maxVal - minVal)

  const xAt = (i: number) =>
    records.length === 1 ? padL + plotW / 2 : padL + (i / (records.length - 1)) * plotW
  const yAt = (v: number) => padT + plotH - ((v - minVal) / spanVal) * plotH

  const pathE = records
    .map((r, i) => `${i === 0 ? 'M' : 'L'}${xAt(i).toFixed(1)},${yAt(r.absorbedDoseRateTissuePlasticMicroGyPerHour).toFixed(1)}`)
    .join(' ')
  const pathB = records
    .map((r, i) => `${i === 0 ? 'M' : 'L'}${xAt(i).toFixed(1)},${yAt(r.absorbedDoseRateSiliconMicroGyPerHour).toFixed(1)}`)
    .join(' ')

  const activeRecord = hoverIdx !== null ? records[hoverIdx] : records[records.length - 1]

  return (
    <div className="mt-3 border border-line bg-surface-2/40 p-2.5">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-[10px] font-medium text-ink">
            Historical Curiosity RAD Series (Gale Crater)
          </div>
          <div className="font-mono text-[8.5px] text-caution">
            Reference archive · NOT live Jezero telemetry
          </div>
        </div>
        <div className="flex border border-line bg-bg text-[8.5px] font-mono">
          <button
            type="button"
            onClick={() => {
              setHoverIdx(null)
              onModeChange('sep2017')
            }}
            className={`px-1.5 py-0.5 transition-colors ${
              mode === 'sep2017' ? 'bg-accent/20 text-ink' : 'text-muted hover:text-ink'
            }`}
          >
            Sep 2017 SEP
          </button>
          <button
            type="button"
            onClick={() => {
              setHoverIdx(null)
              onModeChange('solar_cycle')
            }}
            className={`border-l border-line px-1.5 py-0.5 transition-colors ${
              mode === 'solar_cycle' ? 'bg-accent/20 text-ink' : 'text-muted hover:text-ink'
            }`}
          >
            Solar Cycle
          </button>
        </div>
      </div>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="mt-2 h-28 w-full overflow-visible select-none"
        role="img"
        aria-label="Historical MSL Curiosity RAD absorbed dose rate time series in microGray per hour"
        onMouseLeave={() => setHoverIdx(null)}
      >
        {[0, 0.5, 1].map((frac) => {
          const val = minVal + frac * spanVal
          const y = yAt(val)
          return (
            <g key={frac}>
              <line
                x1={padL}
                y1={y}
                x2={width - padR}
                y2={y}
                stroke="currentColor"
                className="text-line"
                strokeDasharray="2 3"
                strokeWidth="0.7"
              />
              <text
                x={padL - 4}
                y={y + 3}
                textAnchor="end"
                className="fill-muted font-mono text-[7.5px]"
              >
                {val.toFixed(0)}
              </text>
            </g>
          )
        })}

        <path d={pathB} fill="none" stroke="#38bdf8" strokeWidth="1.2" strokeDasharray="3 2" />
        <path d={pathE} fill="none" stroke="#f97316" strokeWidth="1.6" />

        {records.map((rec, i) => {
          const cx = xAt(i)
          const cy = yAt(rec.absorbedDoseRateTissuePlasticMicroGyPerHour)
          const isHovered = hoverIdx === i
          return (
            <g key={`${rec.sol}-${rec.obsIndex}`}>
              <circle
                cx={cx}
                cy={cy}
                r={isHovered ? 3.2 : 1.8}
                fill={isHovered ? '#ffffff' : '#f97316'}
              />
              <rect
                x={cx - plotW / Math.max(2, records.length) / 2}
                y={padT}
                width={plotW / Math.max(2, records.length)}
                height={plotH}
                fill="transparent"
                className="cursor-crosshair"
                onMouseEnter={() => setHoverIdx(i)}
              />
            </g>
          )
        })}

        <text x={padL} y={height - 4} className="fill-muted font-mono text-[7.5px]">
          Sol {records[0].sol} ({records[0].startUtc.slice(0, 10)})
        </text>
        <text
          x={width - padR}
          y={height - 4}
          textAnchor="end"
          className="fill-muted font-mono text-[7.5px]"
        >
          Sol {records[records.length - 1].sol} ({records[records.length - 1].startUtc.slice(0, 10)})
        </text>
      </svg>

      <div className="mt-1 flex items-center justify-between border-t border-line/60 pt-1.5 font-mono text-[8.5px]">
        <div className="flex items-center gap-2.5">
          <span className="flex items-center gap-1 text-ink">
            <span className="h-1.5 w-2.5 bg-[#f97316]" aria-hidden />
            Det E (Tissue plastic)
          </span>
          <span className="flex items-center gap-1 text-muted">
            <span className="h-1.5 w-2.5 bg-[#38bdf8]" aria-hidden />
            Det B (Silicon)
          </span>
        </div>
        <span className="text-faint">unit: µGy/h</span>
      </div>

      {activeRecord ? (
        <div className="mt-1.5 flex items-baseline justify-between bg-bg/70 px-2 py-1 font-mono text-[8.5px]">
          <span className="text-muted">
            Sol {activeRecord.sol} · {activeRecord.startUtc.replace('T', ' ').slice(0, 16)} UTC
          </span>
          <span className="text-ink">
            E: {activeRecord.absorbedDoseRateTissuePlasticMicroGyPerHour.toFixed(2)} · B:{' '}
            {activeRecord.absorbedDoseRateSiliconMicroGyPerHour.toFixed(2)} µGy/h
          </span>
        </div>
      ) : null}
    </div>
  )
}

export function RadiationPanel({
  assessment,
  reference,
  scenarios,
  provenance,
}: {
  assessment: EvaRadiationAssessment
  reference: RadiationReferenceData
  scenarios: RadiationScenariosData
  provenance: RadiationProvenanceData
}) {
  const [chartMode, setChartMode] = useState<'sep2017' | 'solar_cycle'>('sep2017')
  const radiationScenarioId = useMissionStore((s) => s.radiationScenarioId)
  const setRadiationScenarioId = useMissionStore((s) => s.setRadiationScenarioId)
  const radiationComponent = useMissionStore((s) => s.radiationComponent)
  const setRadiationComponent = useMissionStore((s) => s.setRadiationComponent)
  const layers = useMissionStore((s) => s.layers)
  const toggleLayer = useMissionStore((s) => s.toggleLayer)
  const shieldingOverlay = useMissionStore((s) => s.shieldingOverlay)
  const setShieldingOverlay = useMissionStore((s) => s.setShieldingOverlay)
  const centerOn = useMissionStore((s) => s.centerOn)

  const chartRecords =
    chartMode === 'sep2017'
      ? reference.sep2017HighCadenceSeries
      : reference.solarCycleReferenceSeries

  const shielding = assessment.topographicShielding

  return (
    <section aria-labelledby="radiation-env-heading" className="space-y-3">
      <div className="flex items-baseline justify-between">
        <h2 id="radiation-env-heading" className="heading">
          RADIATION ENVIRONMENT
        </h2>
        <span className="font-mono text-[9px] text-caution">
          {assessment.scenarioId === 'sep_sep2017' ? 'SEP SCENARIO' : 'GCR REFERENCE'}
        </span>
      </div>

      <div
        role="status"
        aria-label="Radiation measurement and model status"
        className="border-l-2 border-caution bg-surface-2/50 p-2.5"
      >
        <div className="flex items-baseline justify-between gap-2">
          <span className="font-mono text-[9.5px] font-semibold text-caution">
            {assessment.measurementVsModelLabel}
          </span>
          <span className="font-mono text-[8.5px] text-faint">MSL-M-RAD-3-RDR-V1.0</span>
        </div>
        <p className="mt-1 text-[9.5px] leading-relaxed text-muted">
          {assessment.estimateLabel}. Perseverance carries no active radiation dosimeter at Jezero; reference dose
          rates are transferred from NASA Curiosity RAD measurements at Gale Crater with ±
          {assessment.uncertaintyPercent}% model uncertainty.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="meta mb-1 block">Selected scenario</span>
          <select
            aria-label="Selected radiation scenario"
            value={radiationScenarioId}
            onChange={(e) => {
              const nextScenario = e.target.value as RadiationScenarioId
              setRadiationScenarioId(nextScenario)
              if (!layers.radiation?.visible) toggleLayer('radiation')
            }}
            className="input h-7 w-full px-1.5 text-[10px]"
          >
            {scenarios.scenarios.map((s) => (
              <option key={s.id} value={s.id}>
                {s.shortLabel}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="meta mb-1 block">Radiation component</span>
          <select
            aria-label="Selected radiation component"
            value={radiationComponent}
            onChange={(e) => {
              const nextComp = e.target.value as RadiationComponentId
              setRadiationComponent(nextComp)
              if (nextComp === 'sep_only' && radiationScenarioId === 'background_gcr') {
                setRadiationScenarioId('sep_sep2017')
              }
              if (!layers.radiation?.visible) toggleLayer('radiation')
            }}
            className="input h-7 w-full px-1.5 text-[10px]"
          >
            <option value="total">Total (GCR + SEP)</option>
            <option value="gcr_only">GCR Baseline Only</option>
            <option value="sep_only">SEP Surge Only</option>
          </select>
        </label>
      </div>

      <div className="space-y-1.5 border border-line bg-surface-2/30 p-2.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] text-ink">Show Radiation Exposure layer on map</span>
          <Switch
            checked={Boolean(layers.radiation?.visible)}
            onCheckedChange={() => toggleLayer('radiation')}
            aria-label="Show Radiation Exposure layer on map"
          />
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-line/60 pt-1.5">
          <span className="text-[10px] text-muted">
            Show Terrain Shielding Potential — Experimental
          </span>
          <Switch
            checked={shieldingOverlay}
            onCheckedChange={setShieldingOverlay}
            aria-label="Show Terrain Shielding Potential — Experimental"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <MetricCell
          label="Reference dose rate"
          value={`${assessment.referenceDoseRateMicroGyPerHour.toFixed(2)} µGy/h`}
          sub={`Det B (Si): ${assessment.siliconDoseRateMicroGyPerHour.toFixed(2)} µGy/h`}
          tone={assessment.scenarioId === 'sep_sep2017' ? 'caution' : undefined}
        />
        <MetricCell
          label="Total modeled EVA exposure"
          value={
            assessment.status === 'OK'
              ? `${assessment.totalModeledExposureMicroGy.toFixed(1)} µGy`
              : 'No traverse'
          }
          sub={
            assessment.status === 'OK'
              ? `${assessment.uncertaintyRangeMicroGy[0].toFixed(1)}–${assessment.uncertaintyRangeMicroGy[1].toFixed(1)} µGy (±${assessment.uncertaintyPercent}%)`
              : 'Place >=2 route points'
          }
          tone={assessment.scenarioId === 'sep_sep2017' ? 'caution' : undefined}
        />
        <MetricCell
          label="Estimated route exposure"
          value={
            assessment.status === 'OK'
              ? `${assessment.estimatedRouteExposureMicroGy.toFixed(2)} µGy`
              : '—'
          }
          sub={
            assessment.status === 'OK'
              ? `Walk ${assessment.outboundWalkExposureMicroGy.toFixed(1)} + stops ${assessment.scienceStopExposureMicroGy.toFixed(1)} µGy`
              : 'Outbound + stops'
          }
        />
        <MetricCell
          label="Return leg exposure"
          value={
            assessment.status === 'OK' ? `${assessment.returnExposureMicroGy.toFixed(2)} µGy` : '—'
          }
          sub={
            assessment.status === 'OK'
              ? `${assessment.returnWalkHours.toFixed(2)} h return walk`
              : 'Return traverse'
          }
        />
      </div>

      {assessment.status === 'OK' ? (
        <div className="border border-line bg-surface-2/30 p-2.5 font-mono text-[9px]">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-faint">Science & target stop exposure</span>
            <span className="text-ink">
              {assessment.scienceStopExposureMicroGy.toFixed(2)} µGy ({assessment.scienceStopHours.toFixed(2)} h)
            </span>
          </div>
          <div className="mt-1 flex items-baseline justify-between gap-2">
            <span className="text-faint">Total mission exposure time</span>
            <span className="text-ink">{assessment.totalExposureHours.toFixed(2)} h / 6.00 h budget</span>
          </div>
          <div className="mt-1 flex items-baseline justify-between gap-2 border-t border-line/60 pt-1">
            <span className="text-faint">
              Informational H*(10) ref. (&lt;Q&gt;={assessment.publishedQualityFactorQ.toFixed(2)})
            </span>
            <span className="text-muted">~{assessment.informationalDoseEquivalentMicroSv.toFixed(1)} µSv</span>
          </div>
          <p className="mt-1 font-sans text-[8.5px] leading-relaxed text-faint">
            Note: Absorbed dose (µGy) measures physical energy deposition; dose equivalent (µSv) applies published
            MSL-RAD quality factor &lt;Q&gt; (Hassler et al., 2014) for unshielded surface reference only.
          </p>
        </div>
      ) : null}

      <div className="border border-line bg-surface-2/40 p-2.5">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[10.5px] font-medium text-ink">{shielding.statusLabel}</span>
          <span className="font-mono text-[8.5px] text-[#38bdf8]">16-azimuth DEM horizon</span>
        </div>
        <p className="mt-1 text-[9px] leading-relaxed text-faint">
          Evaluates geometric horizon obstruction and upper-hemisphere sky visibility (Ω_sky / 2π) from the Mars 2020
          DEM. Sky visibility is never equated to a percentage dose reduction.
        </p>

        <div className="mt-2 grid grid-cols-3 gap-1.5 text-center font-mono text-[9px]">
          <div className="border border-line bg-bg/60 p-1.5">
            <span className="block text-[8px] text-faint">Sky visibility</span>
            <span className="text-ink">
              {shielding.meanSkyVisibilityFraction !== null
                ? `${(shielding.meanSkyVisibilityFraction * 100).toFixed(1)}%`
                : `${(reference.stationTopographicContext[0]?.skyVisibilityFraction ?? 0.943) * 100}%`}
            </span>
          </div>
          <div className="border border-line bg-bg/60 p-1.5">
            <span className="block text-[8px] text-faint">Mean horizon</span>
            <span className="text-ink">
              {shielding.meanHorizonObstructionDeg !== null
                ? `${shielding.meanHorizonObstructionDeg.toFixed(1)}°`
                : '3.3°'}
            </span>
          </div>
          <div className="border border-line bg-bg/60 p-1.5">
            <span className="block text-[8px] text-faint">Shielding proxy</span>
            <span className="text-[#38bdf8]">
              {shielding.meanExperimentalShieldingProxy !== null
                ? shielding.meanExperimentalShieldingProxy.toFixed(2)
                : '0.16'}
            </span>
          </div>
        </div>

        {shielding.bestShelterCandidate ? (
          <div className="mt-2 flex items-center justify-between border-t border-line/60 pt-1.5 font-mono text-[8.5px]">
            <span className="text-muted">
              Max scarp obstruction along route: {shielding.bestShelterCandidate.horizonObstructionDeg.toFixed(1)}° (SVF{' '}
              {(shielding.bestShelterCandidate.skyVisibilityFraction * 100).toFixed(1)}%)
            </span>
            <button
              type="button"
              onClick={() =>
                centerOn(shielding.bestShelterCandidate!.lon, shielding.bestShelterCandidate!.lat)
              }
              className="text-[#38bdf8] hover:underline"
            >
              Locate
            </button>
          </div>
        ) : null}
      </div>

      <HistoricalRadChart records={chartRecords} mode={chartMode} onModeChange={setChartMode} />

      <div className="space-y-1.5 border border-line bg-surface-2/30 p-2.5 text-[9px]">
        <div className="font-mono text-[9.5px] font-semibold text-ink">
          Provenance, Sources & Scientific Limitations
        </div>
        <div className="grid grid-cols-[88px_1fr] gap-x-2 gap-y-1 font-mono text-[8.5px]">
          <span className="text-faint">Radiation source</span>
          <span className="text-ink">{assessment.radiationSource}</span>
          <span className="text-faint">Data origin</span>
          <span className="text-ink">{assessment.referenceOrigin}</span>
          <span className="text-faint">Data date</span>
          <span className="text-ink">{assessment.referenceDateRange}</span>
          <span className="text-faint">Verdict policy</span>
          <span className="text-caution">Advisory only · No unverified GO/NO-GO gate</span>
        </div>

        <p className="mt-1.5 border-t border-line/60 pt-1.5 text-[9px] leading-relaxed text-muted">
          <strong>Pre-mission advisory:</strong> {assessment.shelterAdvisory}
        </p>

        <ul className="mt-1 space-y-1 text-[8.5px] leading-relaxed text-faint">
          {assessment.limitations.map((lim, idx) => (
            <li key={idx}>• {lim}</li>
          ))}
          {shielding.caveats.map((cav, idx) => (
            <li key={`cav-${idx}`}>• {cav}</li>
          ))}
        </ul>

        <div className="mt-1.5 flex flex-wrap gap-3 border-t border-line/60 pt-1.5 font-mono text-[8.5px]">
          {provenance.sources.map((src) => {
            const href = src.profileUrl ?? src.url
            if (!href) return null
            return (
              <a
                key={src.id}
                href={href}
                target="_blank"
                rel="noreferrer"
                className="text-signal no-underline hover:underline"
              >
                {src.id === 'msl_rad_pds' ? 'NASA PDS MSL-RAD' : src.id === 'maven_sep' ? 'MAVEN SEP' : 'Mars 2020 DEM'}
              </a>
            )
          })}
        </div>
      </div>
    </section>
  )
}
