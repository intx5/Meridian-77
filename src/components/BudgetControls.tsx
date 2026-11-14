import { BUDGET_CONFIG } from '@/config/eva'
import type { ReturnBudget } from '@/types'

function Slider({
  id,
  label,
  value,
  min,
  max,
  step,
  suffix,
  onChange,
}: {
  id: string
  label: string
  value: number
  min: number
  max: number
  step: number
  suffix: string
  onChange: (value: number) => void
}) {
  return (
    <label htmlFor={id} className="block">
      <span className="flex items-baseline justify-between gap-2">
        <span className="text-[10px] text-muted">{label}</span>
        <span className="num font-mono text-[10px] text-ink">
          {value} {suffix}
        </span>
      </span>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="mt-1 h-1 w-full accent-[var(--accent)]"
      />
    </label>
  )
}

export function BudgetControls({
  budget,
  targetStayMinutes,
  reserveMinutes,
  onTargetStayChange,
  onReserveChange,
}: {
  budget: ReturnBudget
  targetStayMinutes: number
  reserveMinutes: number
  onTargetStayChange: (minutes: number) => void
  onReserveChange: (minutes: number) => void
}) {
  const [stayMin, stayMax] = BUDGET_CONFIG.maxStayRangeMinutes
  const [reserveMin, reserveMax] = BUDGET_CONFIG.reserveRangeMinutes
  const over = budget.exceeded && !budget.dataInsufficient

  return (
    <section aria-labelledby="budget-controls-heading" className="border-t border-line pt-3">
      <div className="flex items-baseline justify-between">
        <h2 id="budget-controls-heading" className="heading">
          Return budget
        </h2>
        <span className="meta">{budget.timeLimitHours} h EVA</span>
      </div>
      <p className="mt-1 text-[10px] leading-relaxed text-faint">
        The jury control. Increase the sample stop until the return margin disappears.
      </p>

      <div className="mt-3 space-y-3">
        <Slider
          id="target-stay"
          label="Target stay"
          value={targetStayMinutes}
          min={stayMin}
          max={stayMax}
          step={5}
          suffix="min"
          onChange={onTargetStayChange}
        />
        <Slider
          id="reserve"
          label="Return reserve"
          value={reserveMinutes}
          min={reserveMin}
          max={reserveMax}
          step={5}
          suffix="min"
          onChange={onReserveChange}
        />
      </div>

      <div className="mt-2 flex items-baseline justify-between border-t border-line pt-2">
        <span className="meta">max target stay</span>
        <span className={`num font-mono text-[11px] ${over ? 'text-danger' : 'text-ink'}`}>
          {budget.maxTargetStayMinutes} min
        </span>
      </div>

      {over ? (
        <p role="status" className="mt-1.5 text-[10px] leading-relaxed text-danger">
          Sample stop exceeds max stay by {budget.excessMinutes} min. The return reserve is at risk.
        </p>
      ) : null}
      {!budget.targetReachable && !budget.dataInsufficient ? (
        <p role="status" className="mt-1.5 text-[10px] leading-relaxed text-danger">
          The target cannot be reached and returned from within the {budget.timeLimitHours} h budget.
        </p>
      ) : null}
    </section>
  )
}
