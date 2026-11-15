import { EVA_ASSUMPTIONS } from '@/config/eva'
import { steepestSegment, type RouteTerrain } from '@/domain/dem'
import type { EvaResult } from '@/types'
import { useMissionStore } from '@/store/useMissionStore'

export function EvaScoreCard({
  eva,
  terrain,
  ready,
}: {
  eva: EvaResult
  terrain: RouteTerrain
  ready: boolean
}) {
  const setHighlightSegment = useMissionStore((state) => state.setHighlightSegment)
  const centerOn = useMissionStore((state) => state.centerOn)

  function showSteepest() {
    const segment = steepestSegment(terrain)
    if (!segment) return
    setHighlightSegment({ from: segment.from, to: segment.to })
    centerOn((segment.from.lon + segment.to.lon) / 2, (segment.from.lat + segment.to.lat) / 2)
  }

  return (
    <section aria-labelledby="ledger-heading" className="mt-4 border-t border-line pt-3">
      <div className="flex items-baseline justify-between">
        <h2 id="ledger-heading" className="heading">
          Score ledger
        </h2>
        <span className="meta">safety 60 / science 40</span>
      </div>

      {ready ? (
        <ul className="mt-1">
          {eva.breakdown.map((item) => (
            <li key={item.factor} className="border-b border-line py-2">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[13px] text-ink">{item.factor}</span>
                <span className="flex items-baseline gap-2">
                  <span className="meta tabular-nums text-muted">{item.value}</span>
                  <span
                    className="w-8 text-right font-mono text-[13px] tabular-nums"
                    style={{
                      color:
                        item.penalty > 0 ? 'var(--danger)' : item.penalty < 0 ? 'var(--go)' : 'var(--faint)',
                    }}
                  >
                    {item.penalty > 0 ? `−${item.penalty}` : item.penalty < 0 ? `+${Math.abs(item.penalty)}` : '0'}
                  </span>
                </span>
              </div>
              <p className="mt-0.5 pr-10 text-[13px] leading-relaxed text-faint">{item.reason}</p>
              {item.factor === 'slope' && terrain.samples.length ? (
                <button
                  type="button"
                  onClick={showSteepest}
                  className="mt-1 text-[13px] text-signal hover:underline"
                >
                  Show steepest segment on map
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-[13px] text-faint">The ledger fills once the route has two points.</p>
      )}

      <details className="mt-3">
        <summary className="cursor-pointer list-none text-[13px] text-muted hover:text-ink">
          Assumptions behind the score
        </summary>
        <ul className="mt-2 space-y-1.5">
          {EVA_ASSUMPTIONS.map((assumption) => (
            <li key={assumption} className="border-l border-line pl-2.5 text-[13px] leading-relaxed text-faint">
              {assumption}
            </li>
          ))}
        </ul>
      </details>
    </section>
  )
}
