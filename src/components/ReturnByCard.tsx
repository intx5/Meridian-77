import { Printer } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatDuration } from '@/domain/geo'
import type { MissionTarget, ReturnBudget, Verdict, Waypoint } from '@/types'

const VERDICT_COLOR: Record<Verdict, string> = {
  GO: '#2f7d4f',
  CAUTION: '#8a6415',
  'NO-GO': '#a63a24',
  'INSUFFICIENT DATA': '#8a6415',
}

function Big({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[8px] uppercase tracking-[0.12em] text-[#6b6153]">{label}</p>
      <p className="num mt-1 font-mono text-[15px] font-semibold leading-none text-[#14181b]">{value}</p>
    </div>
  )
}

function BudgetBar({ budget }: { budget: ReturnBudget }) {
  const outbound = budget.outboundHours * 60
  const stay = budget.targetStayMinutes
  const returnMinutes = budget.returnHours * 60
  const reserve = budget.reserveMinutes
  const total = outbound + stay + returnMinutes + reserve
  const limit = budget.timeLimitHours * 60
  const scale = Math.max(limit, total, 1)
  const width = (minutes: number) => `${(minutes / scale) * 100}%`
  const limitLeft = `${(limit / scale) * 100}%`

  return (
    <div className="mt-3">
      <div className="relative h-2 w-full overflow-hidden border border-[#b8ad9b] bg-[#ddd4c4]">
        <div className="absolute inset-y-0 left-0 flex w-full">
          <span style={{ width: width(outbound), background: '#c24a22' }} />
          <span style={{ width: width(stay), background: budget.exceeded ? '#a63a24' : '#b07a1e' }} />
          <span style={{ width: width(returnMinutes), background: '#2f7d9e' }} />
          <span style={{ width: width(reserve), background: '#2f7d4f' }} />
        </div>
        <span
          className="absolute inset-y-0 w-px bg-[#14181b]"
          style={{ left: limitLeft }}
          aria-hidden
        />
      </div>
      <div className="mt-1 flex justify-between gap-2 text-[8px] text-[#6b6153]">
        <span>out {formatDuration(budget.outboundHours)}</span>
        <span>stay {budget.targetStayMinutes} min</span>
        <span>return {formatDuration(budget.returnHours)}</span>
        <span>reserve {budget.reserveMinutes} min</span>
      </div>
    </div>
  )
}

export function ReturnByCard({
  routeLabel,
  target,
  targetWaypoint,
  budget,
  verdict,
  ready,
  onOpenBrief,
  showPrintButton = true,
}: {
  routeLabel: string
  target: MissionTarget | undefined
  targetWaypoint: Waypoint | undefined
  budget: ReturnBudget
  verdict: Verdict
  ready: boolean
  onOpenBrief: () => void
  showPrintButton?: boolean
}) {
  const imageUrl = targetWaypoint?.imageUrl
  const credit = targetWaypoint?.imageCredit ?? 'NASA/JPL-Caltech/ASU/MSSS'
  const showNumbers = ready && !budget.dataInsufficient

  return (
    <section className="field-card border border-[#c8bfae] bg-paper p-3 text-paper-ink" aria-labelledby="return-card-heading">
      <header className="flex items-start justify-between gap-3 border-b border-[#bfb5a4] pb-2">
        <div>
          <p className="meta text-[#6b6153]">RETURN-BY CARD</p>
          <h2 id="return-card-heading" className="mt-0.5 text-[12px] font-semibold leading-tight text-[#14181b]">
            {routeLabel}
          </h2>
        </div>
        <span
          className="font-mono text-[10px] font-semibold"
          style={{ color: ready ? VERDICT_COLOR[verdict] : '#6b6153' }}
        >
          {ready ? verdict : 'NO ROUTE'}
        </span>
      </header>

      <div className="mt-2 grid grid-cols-[84px_minmax(0,1fr)] gap-2.5">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={`${target?.name ?? 'Science target'} surface view`}
            className="h-[58px] w-[84px] border border-[#b8ad9b] object-cover"
          />
        ) : (
          <div className="grid h-[58px] w-[84px] place-items-center border border-[#b8ad9b] text-[8px] text-[#6b6153]">
            no frame
          </div>
        )}
        <div className="min-w-0">
          <p className="truncate text-[11px] font-medium text-[#14181b]">{target?.name ?? 'No target selected'}</p>
          <p className="mt-0.5 text-[8.5px] leading-snug text-[#5d5549]">
            {targetWaypoint?.geologyUnit?.label ?? 'USGS map unit unavailable'}
          </p>
          <p className="mt-0.5 truncate text-[8px] text-[#6b6153]">{credit}</p>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2 border-y border-[#c9bfae] py-2">
        <Big label="Max stay" value={showNumbers ? `${budget.maxTargetStayMinutes} min` : '—'} />
        <Big label="Latest departure" value={showNumbers ? budget.latestDeparture : '—'} />
        <Big label="Latest return" value={showNumbers ? budget.latestReturn : '—'} />
      </div>

      {ready ? <BudgetBar budget={budget} /> : null}

      {!ready ? (
        <p className="mt-2 border-l-2 border-[#b8ad9b] pl-2 text-[9px] leading-relaxed text-[#5d5549]">
          Place at least two points, or select Route A / Route B, to calculate the return-by budget.
        </p>
      ) : budget.dataInsufficient ? (
        <p className="mt-2 border-l-2 border-[#a63a24] pl-2 text-[9px] leading-relaxed text-[#a63a24]">
          INSUFFICIENT DATA — {Math.round(budget.unknownFraction * 100)}% of the route has no elevation coverage. The
          card does not issue a plan.
        </p>
      ) : budget.exceeded ? (
        <p className="mt-2 border-l-2 border-[#a63a24] pl-2 text-[9px] leading-relaxed text-[#a63a24]">
          Sample stop exceeds max stay by {budget.excessMinutes} min. The {budget.reserveMinutes} min reserve is at risk.
        </p>
      ) : !budget.targetReachable ? (
        <p className="mt-2 border-l-2 border-[#a63a24] pl-2 text-[9px] leading-relaxed text-[#a63a24]">
          The target cannot be reached and returned within the {budget.timeLimitHours} h budget.
        </p>
      ) : (
        <p className="mt-2 text-[9px] leading-relaxed text-[#5d5549]">
          Estimated return {formatDuration(budget.returnHours)} after departure from the target. Reserve{' '}
          {budget.reserveMinutes} min.
        </p>
      )}

      <div className="mt-2 flex items-center justify-between gap-2 border-t border-[#c9bfae] pt-2">
        <p className="text-[8px] leading-snug text-[#6b6153]">
          {budget.timeLimitHours} h EVA · 1.5 km/h · start 09:00 · reverse route
        </p>
        {showPrintButton ? (
          <Button
            variant="outline"
            size="sm"
            className="no-print h-7 border-[#8f8574] px-2 text-[9px] text-[#14181b]"
            style={{ color: '#14181b' }}
            onClick={onOpenBrief}
          >
            <Printer className="h-3 w-3" aria-hidden />
            Printable card
          </Button>
        ) : null}
      </div>
    </section>
  )
}
