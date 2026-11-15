import { MISSION_TARGETS } from '@/config/region'
import { formatCoord } from '@/domain/geo'
import { useMissionStore } from '@/store/useMissionStore'

export function MissionSetup() {
  const targetId = useMissionStore((state) => state.targetId)
  const setTarget = useMissionStore((state) => state.setTarget)
  const selected = MISSION_TARGETS.find((target) => target.id === targetId)

  return (
    <section aria-labelledby="target-heading">
      <div className="flex items-baseline justify-between">
        <h2 id="target-heading" className="heading">
          Default objective
        </h2>
        <span className="meta">without an endpoint</span>
      </div>

      <div role="radiogroup" aria-labelledby="target-heading" className="mt-2">
        {MISSION_TARGETS.map((target) => {
          const active = target.id === targetId
          return (
            <button
              key={target.id}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setTarget(target.id)}
              className={`flex w-full items-baseline justify-between gap-3 border-l-2 border-t border-t-line py-2.5 pr-1 text-left transition-colors ${
                active
                  ? 'border-l-accent bg-surface-2/60 pl-3'
                  : 'border-l-transparent pl-3 hover:border-l-line-2 hover:bg-surface-2/40'
              }`}
            >
              <span className="min-w-0">
                <span className={`block truncate text-[12px] ${active ? 'text-ink' : 'text-muted'}`}>
                  {target.name}
                </span>
                <span className="meta mt-0.5 block">
                  {formatCoord(target.lon, 'lon')} {formatCoord(target.lat, 'lat')}
                </span>
              </span>
              <span className={`mt-0.5 h-1.5 w-1.5 shrink-0 ${active ? 'bg-accent' : 'bg-line-2'}`} aria-hidden />
            </button>
          )
        })}
      </div>

      {selected ? (
        <p className="mt-3 border-l border-line pl-3 text-[10.5px] leading-relaxed text-faint">{selected.description}</p>
      ) : null}
    </section>
  )
}
