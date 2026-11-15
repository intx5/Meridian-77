import { Compass, Expand, Minimize2, RotateCcw, ZoomIn, ZoomOut } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
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

const CYLINDER_FACETS = 48
const CYLINDER_RADIUS_PX = 600
const CYLINDER_HEIGHT_PX = 980
const FACET_WIDTH_PX = Number((2 * CYLINDER_RADIUS_PX * Math.tan(Math.PI / CYLINDER_FACETS) + 2.5).toFixed(2))
const CARDINAL_TICKS = [
  { deg: 0, label: 'N' },
  { deg: 45, label: 'NE' },
  { deg: 90, label: 'E' },
  { deg: 135, label: 'SE' },
  { deg: 180, label: 'S' },
  { deg: 225, label: 'SW' },
  { deg: 270, label: 'W' },
  { deg: 315, label: 'NW' },
]

function normalizeHeading(yaw: number): number {
  return ((Math.round(yaw) % 360) + 360) % 360
}

function cardinalFromHeading(hdg: number): string {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
  return dirs[Math.round(hdg / 45) % 8]
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v))
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

function Panorama360Viewer({
  waypoint,
  expanded,
  onToggleExpanded,
}: {
  waypoint: Waypoint
  expanded: boolean
  onToggleExpanded: () => void
}) {
  const [failed, setFailed] = useState(false)
  const [mode, setMode] = useState<'360' | 'flat'>('360')
  const [yaw, setYaw] = useState(0)
  const [pitch, setPitch] = useState(5)
  const [zoom, setZoom] = useState(1)
  const [autoRotate, setAutoRotate] = useState(false)
  const [dragging, setDragging] = useState(false)
  const dragRef = useRef<{ startX: number; startY: number; startYaw: number; startPitch: number } | null>(null)

  useEffect(() => {
    if (!autoRotate || dragging || mode !== '360') return
    let frameId = 0
    let last = performance.now()
    const step = (now: number) => {
      const dt = (now - last) / 1000
      last = now
      setYaw((prev) => prev + dt * 10)
      frameId = requestAnimationFrame(step)
    }
    frameId = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frameId)
  }, [autoRotate, dragging, mode])

  if (!waypoint.imageUrl || failed) {
    return (
      <div className="grid h-[260px] w-full place-items-center border border-line bg-surface-2">
        <span className="meta text-[10px]">no surface frame available</span>
      </div>
    )
  }

  const heading = normalizeHeading(yaw)
  const cardinal = cardinalFromHeading(heading)
  const basePerspective = expanded ? 740 : 480
  const perspectivePx = Math.round(basePerspective * zoom)
  const maxPitch = Math.max(6, Math.round(14 / Math.sqrt(zoom)))

  const adjustZoom = (delta: number) => {
    setZoom((prev) => {
      const next = Number(clamp(prev + delta, 0.9, 2.8).toFixed(2))
      const nextMaxPitch = Math.max(6, Math.round(14 / Math.sqrt(next)))
      setPitch((p) => clamp(p, -nextMaxPitch, nextMaxPitch))
      return next
    })
  }

  const resetView = () => {
    setYaw(0)
    setPitch(5)
    setZoom(1)
    setAutoRotate(false)
  }

  return (
    <div
      role="region"
      aria-label="360° surface panorama viewer"
      tabIndex={0}
      onKeyDown={(e) => {
        if (mode !== '360') return
        if (e.key === 'ArrowLeft') {
          e.preventDefault()
          setYaw((v) => v - 12)
        } else if (e.key === 'ArrowRight') {
          e.preventDefault()
          setYaw((v) => v + 12)
        } else if (e.key === 'ArrowUp') {
          e.preventDefault()
          setPitch((v) => clamp(v + 5, -maxPitch, maxPitch))
        } else if (e.key === 'ArrowDown') {
          e.preventDefault()
          setPitch((v) => clamp(v - 5, -maxPitch, maxPitch))
        } else if (e.key === '+' || e.key === '=') {
          e.preventDefault()
          adjustZoom(0.2)
        } else if (e.key === '-') {
          e.preventDefault()
          adjustZoom(-0.2)
        }
      }}
      onWheel={(e) => {
        if (mode !== '360') return
        e.preventDefault()
        adjustZoom(e.deltaY < 0 ? 0.18 : -0.18)
      }}
      onPointerDown={(e) => {
        if (mode !== '360') return
        if ((e.target as HTMLElement).closest('button')) return
        e.currentTarget.setPointerCapture(e.pointerId)
        setDragging(true)
        dragRef.current = {
          startX: e.clientX,
          startY: e.clientY,
          startYaw: yaw,
          startPitch: pitch,
        }
      }}
      onPointerMove={(e) => {
        if (!dragRef.current || mode !== '360') return
        const dx = e.clientX - dragRef.current.startX
        const dy = e.clientY - dragRef.current.startY
        const sensitivity = 0.22 / Math.sqrt(zoom)
        setYaw(dragRef.current.startYaw - dx * sensitivity)
        setPitch(clamp(dragRef.current.startPitch + dy * sensitivity * 0.75, -maxPitch, maxPitch))
      }}
      onPointerUp={(e) => {
        if (dragRef.current) {
          dragRef.current = null
          setDragging(false)
          if (e.currentTarget.hasPointerCapture(e.pointerId)) {
            e.currentTarget.releasePointerCapture(e.pointerId)
          }
        }
      }}
      onPointerCancel={() => {
        dragRef.current = null
        setDragging(false)
      }}
      className={`relative w-full select-none overflow-hidden border border-line bg-[#120d0a] focus:outline-none focus:ring-1 focus:ring-signal ${
        expanded ? 'h-[62vh] min-h-[380px]' : 'h-[320px]'
      } ${mode === '360' ? (dragging ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-default'}`}
      style={{ touchAction: 'none' }}
    >
      {/* Accessible source image & flat-mode fallback */}
      <img
        src={waypoint.imageUrl}
        alt={`${waypoint.name} surface view`}
        onError={() => setFailed(true)}
        draggable={false}
        className={
          mode === 'flat'
            ? 'h-full w-full object-cover'
            : 'pointer-events-none absolute inset-0 h-full w-full object-cover opacity-0'
        }
      />

      {mode === '360' ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 overflow-hidden"
          style={{
            perspective: `${perspectivePx}px`,
            background:
              'linear-gradient(180deg, #b6aba0 0%, #8b7461 48%, #534033 100%)',
          }}
        >
          <div
            className="absolute inset-0"
            style={{
              transformStyle: 'preserve-3d',
              transform: `translateZ(${perspectivePx}px) rotateX(${pitch.toFixed(2)}deg) rotateY(${yaw.toFixed(2)}deg)`,
            }}
          >
            {Array.from({ length: CYLINDER_FACETS }, (_, i) => {
              // Center facet i = CYLINDER_FACETS / 2 (bgPosX = 50%) at angle = 0° (North / initial view)
              const norm = i / CYLINDER_FACETS
              const angle = -((norm - 0.5) * 360)
              // Cull back-hemisphere facets behind the camera plane so CSS 3D never projects inverted polygons
              const relRad = ((angle + yaw) * Math.PI) / 180
              if (Math.cos(relRad) < -0.15) return null
              const bgPosX = (i / (CYLINDER_FACETS - 1)) * 100
              return (
                <div
                  key={i}
                  style={{
                    position: 'absolute',
                    left: '50%',
                    top: '50%',
                    width: `${FACET_WIDTH_PX}px`,
                    height: `${CYLINDER_HEIGHT_PX}px`,
                    marginLeft: `${-FACET_WIDTH_PX / 2}px`,
                    marginTop: `${-CYLINDER_HEIGHT_PX / 2}px`,
                    backgroundImage: `url("${waypoint.imageUrl}")`,
                    backgroundSize: `${CYLINDER_FACETS * 100}% 100%`,
                    backgroundPosition: `${bgPosX.toFixed(4)}% 50%`,
                    backgroundRepeat: 'no-repeat',
                    backfaceVisibility: 'hidden',
                    transform: `rotateY(${angle.toFixed(2)}deg) translateZ(${-CYLINDER_RADIUS_PX}px)`,
                  }}
                />
              )
            })}
          </div>
        </div>
      ) : null}

      {/* Top 360° Compass & Azimuth HUD (floating pills without dark gradient bands) */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-center justify-between gap-2 px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1 border border-accent/60 bg-surface/85 px-1.5 py-0.5 font-mono text-[10px] font-semibold tracking-wider text-accent backdrop-blur-xs">
            <Compass className="h-3 w-3" aria-hidden />
            360° PANORAMA
          </span>
          <span
            data-testid="panorama-heading-readout"
            className="border border-white/15 bg-surface/80 px-2 py-0.5 font-mono text-[10px] text-ink tabular-nums backdrop-blur-xs"
          >
            HDG {String(heading).padStart(3, '0')}° {cardinal} · PITCH {pitch >= 0 ? `+${Math.round(pitch)}` : Math.round(pitch)}° · {zoom.toFixed(1)}×
          </span>
        </div>

        <div className="hidden items-center gap-2 border border-white/15 bg-surface/80 px-2.5 py-0.5 font-mono text-[10px] text-muted backdrop-blur-xs sm:flex">
          {CARDINAL_TICKS.map((tick) => {
            const diff = Math.abs((((heading - tick.deg + 540) % 360) - 180))
            const active = diff <= 22.5
            return (
              <span
                key={tick.label}
                className={active ? 'font-bold text-accent underline underline-offset-2' : 'text-faint'}
              >
                {tick.label}
              </span>
            )
          })}
        </div>
      </div>

      {/* Bottom Interactive Controls (floating pills without dark gradient bands) */}
      <div className="absolute inset-x-0 bottom-0 z-10 flex flex-wrap items-center justify-between gap-2 px-3 py-2">
        <span className="pointer-events-none border border-white/15 bg-surface/80 px-2 py-0.5 font-mono text-[10px] text-ink/90 backdrop-blur-xs">
          {mode === '360'
            ? '360° etkileşimli görünüm · Sürükleyerek etrafa bakın, tekerlekle yakınlaştırın'
            : '2B düz mozaik görünümü'}
        </span>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setMode((m) => (m === '360' ? 'flat' : '360'))}
            className="border border-white/20 bg-surface/85 px-2 py-1 font-mono text-[10px] text-ink backdrop-blur-xs transition-colors hover:border-accent hover:text-accent"
          >
            {mode === '360' ? '2D Flat' : '360° View'}
          </button>
          <button
            type="button"
            onClick={() => setAutoRotate((a) => !a)}
            aria-pressed={autoRotate}
            className={`border px-2 py-1 font-mono text-[10px] backdrop-blur-xs transition-colors ${
              autoRotate
                ? 'border-accent bg-accent/25 text-accent'
                : 'border-white/20 bg-surface/85 text-ink hover:border-accent'
            }`}
          >
            Auto 360°
          </button>
          <button
            type="button"
            aria-label="Zoom out panorama"
            onClick={() => adjustZoom(-0.25)}
            className="border border-white/20 bg-surface/85 p-1 text-ink backdrop-blur-xs transition-colors hover:border-accent"
          >
            <ZoomOut className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            aria-label="Zoom in panorama"
            onClick={() => adjustZoom(0.25)}
            className="border border-white/20 bg-surface/85 p-1 text-ink backdrop-blur-xs transition-colors hover:border-accent"
          >
            <ZoomIn className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            aria-label="Reset 360 view"
            onClick={resetView}
            className="border border-white/20 bg-surface/85 p-1 text-ink backdrop-blur-xs transition-colors hover:border-accent"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            aria-label={expanded ? 'Exit expanded 360 view' : 'Expand 360 view'}
            onClick={onToggleExpanded}
            className="border border-white/20 bg-surface/85 p-1 text-ink backdrop-blur-xs transition-colors hover:border-accent"
          >
            {expanded ? <Minimize2 className="h-3.5 w-3.5" /> : <Expand className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>
    </div>
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
        Real Perseverance traverse positions and interactive 360° surface panoramas, used as ground-truth proxies for
        future astronaut waypoints. Mineral values are measured CRISM band depth at the footprint.
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
            <div className="relative h-12 w-16">
              <Thumb waypoint={waypoint} className="h-12 w-16" />
              {waypoint.imageUrl ? (
                <span className="pointer-events-none absolute bottom-0.5 right-0.5 bg-black/80 px-1 font-mono text-[8px] font-semibold text-accent">
                  360°
                </span>
              ) : null}
            </div>
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
  const [expanded, setExpanded] = useState(false)
  const onRoute = waypoint ? route.some((point) => point.waypointId === waypoint.id) : false

  return (
    <Dialog
      open={Boolean(waypoint)}
      onOpenChange={(open) => {
        if (!open) {
          setExpanded(false)
          selectWaypoint(null)
        }
      }}
    >
      {waypoint ? (
        <DialogContent
          className={expanded ? 'w-[min(96vw,1220px)]' : undefined}
          title={waypoint.name}
          description={`${formatCoord(waypoint.lon, 'lon')} / ${formatCoord(waypoint.lat, 'lat')}${waypoint.sol !== undefined ? ` · sol ${waypoint.sol}` : ''} · 360° Surface Panorama`}
        >
          <Panorama360Viewer
            key={waypoint.id}
            waypoint={waypoint}
            expanded={expanded}
            onToggleExpanded={() => setExpanded((prev) => !prev)}
          />

          <div className="mt-2 flex items-baseline justify-between gap-4">
            <span className="meta">{waypoint.locationBasis}</span>
            <a
              href={waypoint.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="meta shrink-0 text-signal no-underline hover:underline"
            >
              {waypoint.imageCredit}
            </a>
          </div>

          <p className="mt-4 max-w-[68ch] text-[12px] leading-relaxed text-ink/90">{waypoint.note}</p>

          <dl className="mt-4 grid grid-cols-2 gap-y-3 border-y border-line py-3 sm:grid-cols-4">
            <div>
              <dt className="meta">CRISM BD 2.3 µm</dt>
              <dd className="num mt-0.5 font-mono text-[13px] text-ink">
                {waypoint.spectral?.bandDepth2300.toFixed(3) ?? '—'}
              </dd>
            </div>
            <div>
              <dt className="meta">Thermal inertia</dt>
              <dd className="num mt-0.5 font-mono text-[13px] text-ink">
                {waypoint.thermalInertia?.toFixed(0) ?? '—'} SI
              </dd>
            </div>
            <div>
              <dt className="meta">DEM elevation</dt>
              <dd className="num mt-0.5 font-mono text-[13px] text-ink">
                {waypoint.elevationM?.toFixed(0) ?? '—'} m
              </dd>
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
