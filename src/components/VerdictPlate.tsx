import type { EvaResult, Verdict } from '@/types'

const TONE: Record<Verdict, { color: string; note: string }> = {
  GO: { color: 'var(--go)', note: 'Within planning gates' },
  CAUTION: { color: 'var(--caution)', note: 'Reduce scope or review' },
  'NO-GO': { color: 'var(--danger)', note: 'Do not execute as planned' },
  'INSUFFICIENT DATA': { color: 'var(--caution)', note: 'Terrain coverage is incomplete' },
}

function ScoreRow({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-[13px] text-muted">{label}</span>
        <span className="num font-mono text-[14px] text-ink">{value}</span>
      </div>
      <div className="score-track mt-1.5">
        <span style={{ width: `${Math.min(100, Math.max(0, value))}%`, backgroundColor: color }} />
      </div>
      <div className="score-ticks mt-0.5" aria-hidden />
    </div>
  )
}

export function VerdictPlate({
  eva,
  ready,
  onShowSteepest,
}: {
  eva: EvaResult
  ready: boolean
  onShowSteepest?: () => void
}) {
  if (!ready) {
    return (
      <section aria-labelledby="verdict-heading" className="rail-pad border-b border-line py-5">
        <div className="flex items-baseline justify-between">
          <h2 id="verdict-heading" className="label">
            Assessment
          </h2>
          <span className="meta">awaiting traverse</span>
        </div>
        <p className="mt-3 text-[24px] font-medium leading-none tracking-[-0.03em] text-faint">—</p>
        <p className="mt-2 text-[13px] leading-relaxed text-muted">
          Place at least two points to calculate distance, exposure and a verdict.
        </p>
      </section>
    )
  }

  const tone = TONE[eva.verdict]

  return (
    <section aria-labelledby="verdict-heading" className="rail-pad border-b border-line py-5">
      <div className="flex items-baseline justify-between">
        <h2 id="verdict-heading" className="label">
          Assessment
        </h2>
        <span className="meta tabular-nums">{eva.hazardCount} hazards · {eva.compositeScore} composite</span>
      </div>

      <p className="verdict-word mt-2" style={{ color: tone.color }}>
        {eva.verdict}
      </p>
      <p className="mt-1 text-[13px] text-muted">{tone.note}</p>
      <p className="mt-3 text-[15px] leading-relaxed text-ink">{eva.verdictReason}</p>
      {ready && onShowSteepest && (eva.verdict === 'CAUTION' || eva.verdict === 'NO-GO') ? (
        <button
          type="button"
          onClick={onShowSteepest}
          className="mt-2 text-[13px] text-signal hover:underline"
        >
          Show steepest segment on map
        </button>
      ) : null}

      <div className="mt-4 grid grid-cols-2 gap-5">
        <ScoreRow label="Safety" value={eva.safetyScore} color="var(--signal)" />
        <ScoreRow label="Science" value={eva.scienceScore} color="var(--accent)" />
      </div>
    </section>
  )
}
