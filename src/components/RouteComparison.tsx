import type { EvaResult, PresetRoute, PresetRouteId, ReturnBudget, Verdict } from '@/types'
import type { RouteTerrain } from '@/domain/dem'
import { formatDuration, formatKm } from '@/domain/geo'

export interface RouteAnalysis {
  route: PresetRoute
  terrain: RouteTerrain
  eva: EvaResult
  budget: ReturnBudget
  verdict: Verdict
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
      <div className="text-[9px] text-faint">{label}</div>
      <div
        className="num mt-0.5 font-mono text-[11px] text-ink"
        style={tone ? { color: tone === 'danger' ? 'var(--danger)' : 'var(--caution)' } : undefined}
      >
        {value}
      </div>
    </div>
  )
}

export function RouteComparison({
  analyses,
  selectedId,
  onSelect,
}: {
  analyses: RouteAnalysis[]
  selectedId: PresetRouteId | null
  onSelect: (id: PresetRouteId) => void
}) {
  return (
    <section aria-labelledby="route-comparison-heading">
      <div className="flex items-baseline justify-between">
        <h2 id="route-comparison-heading" className="heading">
          Route comparison
        </h2>
        <span className="meta">same start / target</span>
      </div>
      <p className="mt-1 text-[10px] leading-relaxed text-faint">
        Two pre-planned traverses; select one to load it into the map and field card.
      </p>

      <div className="mt-2 divide-y divide-line border-y border-line">
        {analyses.map(({ route, budget, terrain, verdict }) => {
          const selected = selectedId === route.id
          const marginTone = budget.marginHours < 0 ? 'danger' : budget.marginHours < 0.5 ? 'caution' : undefined
          return (
            <button
              key={route.id}
              type="button"
              aria-pressed={selected}
              onClick={() => onSelect(route.id)}
              className={`block w-full border-l-2 py-3 pl-3 pr-1 text-left transition-colors ${
                selected
                  ? 'border-l-accent bg-surface-2/70'
                  : 'border-l-transparent hover:border-l-line-2 hover:bg-surface-2/40'
              }`}
              style={selected ? { borderLeftColor: route.color } : undefined}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="flex min-w-0 items-baseline gap-2">
                  <span className="h-2 w-2 shrink-0" style={{ backgroundColor: route.color }} aria-hidden />
                  <span className="truncate text-[11.5px] font-medium text-ink">{route.label}</span>
                </span>
                <span className="font-mono text-[10px] font-semibold" style={{ color: VERDICT_COLOR[verdict] }}>
                  {verdict}
                </span>
              </div>

              <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5">
                <Metric label="Total mission" value={formatDuration(budget.totalHours)} />
                <Metric label="Max slope" value={`${terrain.maxSlopeDeg.toFixed(1)}°`} />
                <Metric label="Return margin" value={formatDuration(budget.marginHours)} tone={marginTone} />
                <Metric label="Distance" value={formatKm(terrain.totalKm)} />
              </div>

              {budget.exceeded ? (
                <p className="mt-1.5 text-[9px] leading-relaxed text-danger">
                  Target stay exceeds max by {budget.excessMinutes} min.
                </p>
              ) : budget.dataInsufficient ? (
                <p className="mt-1.5 text-[9px] leading-relaxed text-caution">Route crosses no-data terrain.</p>
              ) : null}
            </button>
          )
        })}
      </div>
    </section>
  )
}
