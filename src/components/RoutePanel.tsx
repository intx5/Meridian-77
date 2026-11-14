import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { formatCoord, formatKm } from '@/domain/geo'
import type { RouteTerrain } from '@/domain/dem'
import type { EvaResult } from '@/types'
import { useMissionStore } from '@/store/useMissionStore'

function Metric({ label, value, unit, tone }: { label: string; value: string; unit?: string; tone?: 'warn' | 'danger' }) {
  return (
    <div>
      <div className="text-[10px] text-faint">{label}</div>
      <div
        className="num mt-0.5 font-medium leading-none text-ink"
        style={tone ? { color: tone === 'danger' ? 'var(--danger)' : 'var(--caution)' } : undefined}
      >
        <span className="text-[22px]">{value}</span>
        {unit ? <span className="ml-1 font-sans text-[9px] font-normal tracking-normal text-faint">{unit}</span> : null}
      </div>
    </div>
  )
}

function Mini({ label, value, tone }: { label: string; value: string; tone?: 'warn' | 'danger' }) {
  return (
    <div className="flex items-baseline justify-between border-t border-line py-1.5">
      <span className="text-[10px] text-faint">{label}</span>
      <span
        className="num font-mono text-[10.5px] text-muted"
        style={tone ? { color: tone === 'danger' ? 'var(--danger)' : 'var(--caution)' } : undefined}
      >
        {value}
      </span>
    </div>
  )
}

export function RoutePanel({
  terrain,
  eva,
  bounds,
}: {
  terrain: RouteTerrain
  eva: EvaResult
  bounds: [number, number, number, number]
}) {
  const route = useMissionStore((state) => state.route)
  const undo = useMissionStore((state) => state.undo)
  const clear = useMissionStore((state) => state.clear)
  const addPoint = useMissionStore((state) => state.addPoint)
  const [lon, setLon] = useState('77.4062')
  const [lat, setLat] = useState('18.4589')
  const [error, setError] = useState<string | null>(null)

  function submit(event: FormEvent) {
    event.preventDefault()
    const nextLon = Number(lon)
    const nextLat = Number(lat)
    if (
      !Number.isFinite(nextLon) ||
      !Number.isFinite(nextLat) ||
      nextLon < bounds[0] ||
      nextLon > bounds[2] ||
      nextLat < bounds[1] ||
      nextLat > bounds[3]
    ) {
      setError('Outside the Jezero delta bounds.')
      return
    }
    setError(null)
    addPoint(nextLon, nextLat)
  }

  const slopeTone = eva.maxSlopeDeg >= 25 ? 'danger' : eva.maxSlopeDeg >= 15 ? 'warn' : undefined
  const totalMinutes = Math.round(eva.durationHours * 60)
  const clock = totalMinutes >= 60
    ? `${Math.floor(totalMinutes / 60)}h ${String(totalMinutes % 60).padStart(2, '0')}m`
    : `${totalMinutes}m`

  return (
    <section aria-labelledby="route-heading">
      <div className="flex items-baseline justify-between">
        <h2 id="route-heading" className="heading">
          Traverse
        </h2>
        <div className="flex items-center gap-3 text-[10px]">
          <button type="button" onClick={undo} disabled={!route.length} className="text-muted hover:text-ink disabled:opacity-30">
            Undo
          </button>
          <button type="button" onClick={clear} disabled={!route.length} className="text-muted hover:text-ink disabled:opacity-30">
            Clear
          </button>
        </div>
      </div>

      {route.length < 2 ? (
        <p className="mt-2 border-l border-line pl-3 text-[10.5px] leading-relaxed text-muted">
          Two distinct points are required. Each segment is sampled every nine metres for elevation, slope and gaps.
        </p>
      ) : (
        <>
          <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3">
            <Metric label="Distance" value={formatKm(terrain.totalKm).replace(' km', '')} unit="km" />
            <Metric label="Planned time" value={clock} />
            <Metric
              label="Max slope"
              value={terrain.maxSlopeDeg.toFixed(1)}
              unit="°"
              tone={slopeTone}
            />
            <Metric label="Hazards" value={String(eva.hazardCount)} tone={eva.hazardCount ? 'warn' : undefined} />
          </div>

          <div className="mt-3">
            <Mini label="Ascent / descent" value={`+${terrain.elevationGainM} / −${terrain.elevationLossM} m`} />
            <Mini label="Mean slope" value={`${terrain.meanSlopeDeg.toFixed(1)}°`} />
            <Mini label="Science stops" value={`${eva.stopCount}`} />
            <Mini label="DEM coverage" value={`${Math.round((1 - terrain.unknownFraction) * 100)}%`} />
          </div>
        </>
      )}

      <div className="mt-4 border-t border-line pt-3">
        <div className="flex items-baseline justify-between">
          <span className="text-[10px] text-faint">Add coordinate</span>
          <span className="meta">
            {formatCoord(bounds[0], 'lon')} – {formatCoord(bounds[2], 'lon')}
          </span>
        </div>
        <form onSubmit={submit} className="mt-1.5 grid grid-cols-[1fr_1fr_auto] items-end gap-1.5">
          <label className="block">
            <span className="meta mb-1 block">lon °E</span>
            <input
              id="route-lon"
              name="route-lon"
              value={lon}
              onChange={(event) => setLon(event.target.value)}
              inputMode="decimal"
              className="input"
            />
          </label>
          <label className="block">
            <span className="meta mb-1 block">lat °N</span>
            <input
              id="route-lat"
              name="route-lat"
              value={lat}
              onChange={(event) => setLat(event.target.value)}
              inputMode="decimal"
              className="input"
            />
          </label>
          <Button type="submit" variant="outline" size="icon" aria-label="Add coordinate point">
            +
          </Button>
        </form>
        {error ? (
          <p role="alert" className="mt-1.5 text-[10px] text-danger">
            {error}
          </p>
        ) : null}
      </div>

      {terrain.unknownFraction > 0 ? (
        <p className="mt-3 border-l-2 border-caution pl-3 text-[10px] leading-relaxed text-caution">
          {Math.round(terrain.unknownFraction * 100)}% of the route has no DEM coverage. Unknown ground is never treated
          as flat.
        </p>
      ) : null}
    </section>
  )
}
