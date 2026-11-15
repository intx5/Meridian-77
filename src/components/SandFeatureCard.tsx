import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { formatCoord } from '@/domain/geo'
import type { SandFeature, SandKind } from '@/types'
import { useMissionStore } from '@/store/useMissionStore'

const KIND_BADGE: Record<SandKind, 'caution' | 'science' | 'default'> = {
  dune_field: 'caution',
  sand_sheet: 'science',
  uncertain_aeolian: 'default',
}

function polygonCentroid(coordinates: number[][][]): { lon: number; lat: number } {
  const ring = coordinates[0] ?? []
  if (!ring.length) return { lon: 77.4, lat: 18.45 }
  let sumLon = 0
  let sumLat = 0
  for (const pt of ring) {
    sumLon += pt[0]
    sumLat += pt[1]
  }
  return { lon: sumLon / ring.length, lat: sumLat / ring.length }
}

export function SandFeatureDialog({ feature }: { feature: SandFeature | null }) {
  const selectSandFeature = useMissionStore((state) => state.selectSandFeature)
  const centerOn = useMissionStore((state) => state.centerOn)

  const props = feature?.properties
  const center = feature ? polygonCentroid(feature.geometry.coordinates) : null

  return (
    <Dialog open={Boolean(feature)} onOpenChange={(open) => (!open ? selectSandFeature(null) : undefined)}>
      {feature && props && center ? (
        <DialogContent
          title={props.label}
          description={`${props.id} · ${formatCoord(center.lon, 'lon')} / ${formatCoord(center.lat, 'lat')}`}
        >
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-3">
            <div className="flex items-center gap-2">
              <Badge variant={KIND_BADGE[props.kind]}>{props.kind.replace('_', ' ')}</Badge>
              <span className="meta">{props.confidenceLabel}</span>
            </div>
            <span className="num font-mono text-[12px] text-ink">
              {Math.round(props.confidence * 100)}% agreement score
            </span>
          </div>

          <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-b border-line pb-4 sm:grid-cols-3">
            <div>
              <dt className="meta">Formation type</dt>
              <dd className="mt-0.5 text-[12px] text-ink">{props.label}</dd>
            </div>
            <div>
              <dt className="meta">Surface area</dt>
              <dd className="num mt-0.5 font-mono text-[12px] text-ink">
                {props.areaKm2.toFixed(3)} km² ({props.areaM2.toLocaleString('en-US')} m²)
              </dd>
            </div>
            <div>
              <dt className="meta">Confidence score</dt>
              <dd className="num mt-0.5 font-mono text-[12px] text-ink">
                {props.confidence.toFixed(2)} ({Math.round(props.confidence * 100)}%)
              </dd>
            </div>
            <div>
              <dt className="meta">NASA image source</dt>
              <dd className="mt-0.5 text-[11px] text-ink">{props.sourceImage}</dd>
            </div>
            <div>
              <dt className="meta">Image resolution</dt>
              <dd className="mt-0.5 text-[11px] text-ink">{props.resolution}</dd>
            </div>
            <div>
              <dt className="meta">USGS SIM 3464 unit</dt>
              <dd className="mt-0.5 text-[11px] text-ink">{props.usgsUnit}</dd>
            </div>
          </dl>

          <dl className="mt-3 grid grid-cols-3 gap-3 border-b border-line pb-3">
            <div>
              <dt className="meta">Ripple coherence</dt>
              <dd className="num mt-0.5 font-mono text-[12px] text-ink">{props.rippleCoherence.toFixed(2)}</dd>
            </div>
            <div>
              <dt className="meta">Mean DEM slope</dt>
              <dd className="num mt-0.5 font-mono text-[12px] text-ink">{props.meanSlopeDeg.toFixed(1)}°</dd>
            </div>
            <div>
              <dt className="meta">THEMIS inertia</dt>
              <dd className="num mt-0.5 font-mono text-[12px] text-ink">
                {props.meanThermalInertia !== null ? `${props.meanThermalInertia.toFixed(0)} SI` : 'outside strip'}
              </dd>
            </div>
          </dl>

          <div className="mt-3 space-y-2">
            <div>
              <p className="meta">Detection method</p>
              <p className="mt-0.5 text-[11px] leading-relaxed text-muted">{props.detectionMethod}</p>
            </div>
            <div className="border-l-2 border-caution pl-3">
              <p className="meta text-caution">Risk interpretation limitations</p>
              <p className="mt-0.5 text-[11px] leading-relaxed text-ink/90">{props.limitations}</p>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-line pt-4">
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                centerOn(center.lon, center.lat)
                selectSandFeature(null)
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
