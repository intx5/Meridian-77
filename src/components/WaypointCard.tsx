import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { formatCoord } from '@/domain/geo'
import type { Waypoint, WaypointKind } from '@/types'
import { useMissionStore } from '@/store/useMissionStore'

const KIND_LABEL: Record<WaypointKind, string> = {
  start: 'landing',
  science: 'science',
  pov: 'pov',
  end: 'end',
}

const KIND_VARIANT: Record<WaypointKind, 'science' | 'default' | 'go'> = {
  start: 'go',
  science: 'science',
  pov: 'default',
  end: 'default',
}

function Thumb({ waypoint, className }: { waypoint: Waypoint; className: string }) {
  const [failed, setFailed] = useState(false)
  if (!waypoint.imageUrl || failed) {
    return (
      <div className={`grid place-items-center border border-line bg-surface-2 ${className}`}>
        <span className="meta text-[8px]">no frame</span>
      </div>
    )
  }
  return (
    <img
      src={waypoint.imageUrl}
      alt={`${waypoint.name} surface view`}
      loading="lazy"
      onError={() => setFailed(true)}
      className={`border border-line object-cover opacity-80 transition-opacity duration-200 group-hover:opacity-100 ${className}`}
    />
  )
}

export function WaypointList({ waypoints }: { waypoints: Waypoint[] }) {
  const selectWaypoint = useMissionStore((state) => state.selectWaypoint)
  const sorted = [...waypoints].sort((a, b) => (a.sol ?? 0) - (b.sol ?? 0))

  return (
    <section aria-labelledby="stations-heading">
      <div className="flex items-baseline justify-between">
        <h2 id="stations-heading" className="heading">
          Stations
        </h2>
        <span className="meta">{waypoints.length} cards</span>
      </div>
      <p className="mt-1 text-[10px] leading-relaxed text-faint">
        Real Perseverance traverse positions. Mineral values are measured CRISM band depth at the footprint.
      </p>

      <div className="mt-2">
        {sorted.map((waypoint, index) => (
          <button
            key={waypoint.id}
            type="button"
            onClick={() => selectWaypoint(waypoint.id)}
            className="group grid w-full grid-cols-[16px_64px_minmax(0,1fr)] items-start gap-3 border-t border-line py-2.5 text-left transition-colors hover:bg-surface-2/50"
          >
            <span className="meta pt-1 tabular-nums">{String(index + 1).padStart(2, '0')}</span>
            <Thumb waypoint={waypoint} className="h-12 w-16" />
            <div className="min-w-0">
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-[11.5px] text-ink">{waypoint.name}</span>
                {waypoint.sol !== undefined ? <span className="meta shrink-0">sol {waypoint.sol}</span> : null}
              </div>
              <div className="meta mt-0.5">
                {formatCoord(waypoint.lon, 'lon')} {formatCoord(waypoint.lat, 'lat')}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1">
                <Badge variant={KIND_VARIANT[waypoint.kind]}>{KIND_LABEL[waypoint.kind]}</Badge>
                {waypoint.minerals.length ? (
                  waypoint.minerals.map((mineral) => (
                    <span key={mineral} className="inline-flex items-center gap-1 text-[9px] text-signal">
                      <span className="h-1 w-1 bg-signal" aria-hidden />
                      {mineral}
                    </span>
                  ))
                ) : (
                  <span className="text-[9px] text-faint">no 2.3 µm absorption</span>
                )}
              </div>
            </div>
          </button>
        ))}
      </div>
    </section>
  )
}

export function WaypointDialog({ waypoint }: { waypoint: Waypoint | null }) {
  const selectWaypoint = useMissionStore((state) => state.selectWaypoint)
  const addWaypoint = useMissionStore((state) => state.addWaypoint)
  const centerOn = useMissionStore((state) => state.centerOn)
  const route = useMissionStore((state) => state.route)
  const onRoute = waypoint ? route.some((point) => point.waypointId === waypoint.id) : false

  return (
    <Dialog open={Boolean(waypoint)} onOpenChange={(open) => (!open ? selectWaypoint(null) : undefined)}>
      {waypoint ? (
        <DialogContent
          title={waypoint.name}
          description={`${formatCoord(waypoint.lon, 'lon')} / ${formatCoord(waypoint.lat, 'lat')}${waypoint.sol !== undefined ? ` · sol ${waypoint.sol}` : ''}`}
        >
          <Thumb waypoint={waypoint} className="h-[260px] w-full object-cover" />

          <div className="mt-1 flex items-baseline justify-between gap-4">
            <span className="meta">{waypoint.locationBasis}</span>
            <a href={waypoint.sourceUrl} target="_blank" rel="noreferrer" className="meta shrink-0 text-signal no-underline hover:underline">
              {waypoint.imageCredit}
            </a>
          </div>

          <p className="mt-4 max-w-[68ch] text-[12px] leading-relaxed text-ink/90">{waypoint.note}</p>

          <dl className="mt-4 grid grid-cols-2 gap-y-3 border-y border-line py-3 sm:grid-cols-4">
            <div>
              <dt className="meta">CRISM BD 2.3 µm</dt>
              <dd className="num mt-0.5 font-mono text-[13px] text-ink">{waypoint.spectral?.bandDepth2300.toFixed(3) ?? '—'}</dd>
            </div>
            <div>
              <dt className="meta">Thermal inertia</dt>
              <dd className="num mt-0.5 font-mono text-[13px] text-ink">{waypoint.thermalInertia?.toFixed(0) ?? '—'} SI</dd>
            </div>
            <div>
              <dt className="meta">DEM elevation</dt>
              <dd className="num mt-0.5 font-mono text-[13px] text-ink">{waypoint.elevationM?.toFixed(0) ?? '—'} m</dd>
            </div>
            <div>
              <dt className="meta">USGS unit</dt>
              <dd className="mt-0.5 truncate text-[11.5px] text-ink">{waypoint.geologyUnit?.label ?? '—'}</dd>
            </div>
          </dl>

          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="meta">Indicators</span>
            {waypoint.minerals.length ? (
              waypoint.minerals.map((mineral) => (
                <span key={mineral} className="inline-flex items-center gap-1 text-[10px] text-signal">
                  <span className="h-1 w-1 bg-signal" aria-hidden />
                  {mineral}
                </span>
              ))
            ) : (
              <span className="text-[10px] text-muted">Below the 0.010 candidate threshold; no point detection.</span>
            )}
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-line pt-4">
            <Button size="sm" onClick={() => addWaypoint(waypoint)} disabled={onRoute}>
              {onRoute ? 'On route' : 'Add to route'}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                centerOn(waypoint.lon, waypoint.lat)
                selectWaypoint(null)
              }}
            >
              Center on map
            </Button>
          </div>
        </DialogContent>
      ) : null}
    </Dialog>
  )
}
