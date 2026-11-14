import { useCallback, useEffect, useMemo, useState } from 'react'
import { CRS, DomEvent, divIcon, type DivIcon, type LatLngExpression } from 'leaflet'
import {
  CircleMarker,
  ImageOverlay,
  MapContainer,
  Marker,
  Pane,
  Polyline,
  Tooltip,
  ZoomControl,
  useMap,
  useMapEvents,
} from 'react-leaflet'
import { boundsCenter, formatCoord, MARS_DEGREE_M } from '@/domain/geo'
import { sampleElevation, type RouteTerrain } from '@/domain/dem'
import { EVA_CONFIG } from '@/domain/eva'
import { MAP_MAX_ZOOM, MAP_MIN_ZOOM } from '@/config/region'
import { PRESET_ROUTES } from '@/config/routes'
import type { Bounds, LayersManifest, RasterGrid, Waypoint } from '@/types'
import { useMissionStore } from '@/store/useMissionStore'

interface Map2DProps {
  manifest: LayersManifest
  dem: RasterGrid
  waypoints: Waypoint[]
  terrain: RouteTerrain
}

type Positions = LatLngExpression[][]

function Graticule({ bounds }: { bounds: Bounds }) {
  const lines = useMemo(() => {
    const result: { key: string; positions: LatLngExpression[] }[] = []
    const step = 0.02
    for (let lon = Math.ceil(bounds[0] / step) * step; lon < bounds[2]; lon += step) {
      result.push({ key: `lon-${lon.toFixed(3)}`, positions: [[bounds[1], lon], [bounds[3], lon]] })
    }
    for (let lat = Math.ceil(bounds[1] / step) * step; lat < bounds[3]; lat += step) {
      result.push({ key: `lat-${lat.toFixed(3)}`, positions: [[lat, bounds[0]], [lat, bounds[2]]] })
    }
    return result
  }, [bounds])

  return (
    <>
      {lines.map((line) => (
        <Polyline
          key={line.key}
          positions={line.positions}
          interactive={false}
          pathOptions={{ color: '#c9d8e3', weight: 0.5, opacity: 0.13 }}
        />
      ))}
    </>
  )
}

function MapEvents({ dem }: { dem: RasterGrid }) {
  const addPoint = useMissionStore((state) => state.addPoint)
  const setCoordinate = useMissionStore((state) => state.setCoordinate)
  useMapEvents({
    click(event) {
      addPoint(event.latlng.lng, event.latlng.lat)
    },
    mousemove(event) {
      setCoordinate({
        lon: event.latlng.lng,
        lat: event.latlng.lat,
        elevationM: sampleElevation(dem, event.latlng.lng, event.latlng.lat),
      })
    },
    mouseout() {
      setCoordinate(null)
    },
  })
  return null
}

function MapFocus() {
  const map = useMap()
  const focus = useMissionStore((state) => state.focus)
  useEffect(() => {
    if (focus) map.flyTo([focus.lat, focus.lon], 14, { duration: 0.8 })
  }, [focus, map])
  return null
}

/** Fit the region after the grid/panel has its final size, and on resize. */
function MapResize({ bounds }: { bounds: [[number, number], [number, number]] }) {
  const map = useMap()
  useEffect(() => {
    const container = map.getContainer()
    let width = container.clientWidth
    let height = container.clientHeight

    const frame = requestAnimationFrame(() => {
      map.invalidateSize()
      map.fitBounds(bounds)
    })

    const observer = new ResizeObserver(() => {
      if (container.clientWidth === width && container.clientHeight === height) return
      width = container.clientWidth
      height = container.clientHeight
      map.invalidateSize()
    })
    observer.observe(container)

    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [map, bounds])
  return null
}

function MapTelemetry({ onChange }: { onChange: (zoom: number, lat: number) => void }) {
  const map = useMap()
  useEffect(() => {
    const update = () => onChange(map.getZoom(), map.getCenter().lat)
    update()
    map.on('zoomend moveend', update)
    return () => {
      map.off('zoomend moveend', update)
    }
  }, [map, onChange])
  return null
}

function buildSeverityGroups(samples: RouteTerrain['samples']): Record<'safe' | 'caution' | 'nogo' | 'unknown', Positions> {
  const groups: Record<'safe' | 'caution' | 'nogo' | 'unknown', Positions> = {
    safe: [],
    caution: [],
    nogo: [],
    unknown: [],
  }
  let current: { level: keyof typeof groups; positions: LatLngExpression[] } | null = null
  for (let i = 1; i < samples.length; i += 1) {
    const prev = samples[i - 1]
    const next = samples[i]
    let level: keyof typeof groups = 'unknown'
    if (prev.elevationM !== null && next.elevationM !== null) {
      const horizontalM = (next.distanceKm - prev.distanceKm) * 1000
      const slope =
        horizontalM > 0.01
          ? (Math.atan(Math.abs(next.elevationM - prev.elevationM) / horizontalM) * 180) / Math.PI
          : 0
      level = slope >= EVA_CONFIG.slopeNoGoDeg ? 'nogo' : slope >= EVA_CONFIG.slopeCautionDeg ? 'caution' : 'safe'
    }
    const a: LatLngExpression = [prev.lat, prev.lon]
    const b: LatLngExpression = [next.lat, next.lon]
    if (!current || current.level !== level) {
      if (current) groups[current.level].push(current.positions)
      current = { level, positions: [a] }
    }
    current.positions.push(b)
  }
  if (current) groups[current.level].push(current.positions)
  return groups
}

const routeIcon = (index: number) =>
  divIcon({
    className: '',
    html: `<div class="pin-hit"><div class="route-pin">${index + 1}</div></div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  })

const stationIcon = (selected: boolean) =>
  divIcon({
    className: '',
    html: `<div class="pin-hit"><div class="station-pin${selected ? ' is-selected' : ''}"></div></div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  })

export function Map2D({ manifest, dem, waypoints, terrain }: Map2DProps) {
  const layers = useMissionStore((state) => state.layers)
  const slopeOverlay = useMissionStore((state) => state.slopeOverlay)
  const slopeOpacity = useMissionStore((state) => state.slopeOpacity)
  const route = useMissionStore((state) => state.route)
  const undo = useMissionStore((state) => state.undo)
  const clear = useMissionStore((state) => state.clear)
  const selectedWaypointId = useMissionStore((state) => state.selectedWaypointId)
  const presetRouteId = useMissionStore((state) => state.presetRouteId)
  const highlightSegment = useMissionStore((state) => state.highlightSegment)
  const selectWaypoint = useMissionStore((state) => state.selectWaypoint)
  const centerOn = useMissionStore((state) => state.centerOn)
  const coordinate = useMissionStore((state) => state.coordinate)
  const [telemetry, setTelemetry] = useState({ zoom: 12.5, lat: 18.48 })
  const [mapError, setMapError] = useState(false)
  const handleTelemetry = useCallback((zoom: number, lat: number) => setTelemetry({ zoom, lat }), [])

  const bounds = manifest.region.bounds
  const latLngBounds = useMemo<[[number, number], [number, number]]>(
    () => [
      [bounds[1], bounds[0]],
      [bounds[3], bounds[2]],
    ],
    [bounds],
  )
  const groups = useMemo(() => buildSeverityGroups(terrain.samples), [terrain.samples])
  const centerPoint = useMemo(() => boundsCenter(bounds), [bounds])
  const layerById = useMemo(
    () => Object.fromEntries(manifest.layers.map((layer) => [layer.id, layer])),
    [manifest.layers],
  )
  const icons = useMemo(() => {
    const map = new Map<string, DivIcon>()
    for (const waypoint of waypoints) map.set(waypoint.id, stationIcon(waypoint.id === selectedWaypointId))
    return map
  }, [waypoints, selectedWaypointId])

  const metersPerPixel = (MARS_DEGREE_M * Math.cos((telemetry.lat * Math.PI) / 180)) / 2 ** telemetry.zoom
  const scaleKm =
    [0.1, 0.2, 0.5, 1, 2, 5, 10].find((km) => {
      const px = (km * 1000) / metersPerPixel
      return px >= 55 && px <= 150
    }) ?? 1
  const scalePx = (scaleKm * 1000) / metersPerPixel

  return (
    <div className="relative h-full min-h-[360px] w-full overflow-hidden bg-[#050709]">
      {mapError ? (
        <div className="grid h-full place-items-center p-6 text-center">
          <div className="max-w-sm border-l-2 border-danger pl-4 text-left">
            <p className="text-[12px] text-ink">Map imagery failed to load</p>
            <p className="mt-1 text-[11px] leading-relaxed text-muted">
              Confirm the local files in public/data/jezero are present, then reload.
            </p>
          </div>
        </div>
      ) : (
        <MapContainer
          crs={CRS.Simple}
          bounds={latLngBounds}
          maxBounds={latLngBounds}
          maxBoundsViscosity={1}
          minZoom={MAP_MIN_ZOOM}
          maxZoom={MAP_MAX_ZOOM}
          zoomSnap={0.25}
          zoomControl={false}
          attributionControl={false}
          className="h-full w-full"
          aria-label="Jezero delta terrain map"
        >
          {(['optical', 'geology', 'topography', 'thermal', 'mineralogy'] as const).map((id, index) => {
            const layer = layerById[id]
            const state = layers[id]
            if (!layer || !state.visible) return null
            return (
              <ImageOverlay
                key={id}
                url={layer.imageUrl}
                bounds={latLngBounds}
                opacity={state.opacity}
                zIndex={10 + index * 10}
                className={
                  id === 'thermal' && (layers.optical.visible || layers.topography.visible)
                    ? 'thermal-overlay'
                    : undefined
                }
                eventHandlers={{ error: () => setMapError(true) }}
              />
            )
          })}

          {layers.topography.visible && layerById.topography?.overlay && slopeOverlay ? (
            <ImageOverlay
              url={layerById.topography.overlay.imageUrl}
              bounds={latLngBounds}
              opacity={slopeOpacity}
              zIndex={26}
              eventHandlers={{ error: () => setMapError(true) }}
            />
          ) : null}

          <Graticule bounds={bounds} />

          {PRESET_ROUTES.map((preset) => {
            const selected = presetRouteId === preset.id
            return (
              <Polyline
                key={`preset-${preset.id}`}
                positions={preset.waypoints.map((point) => [point.lat, point.lon] as [number, number])}
                interactive={false}
                pathOptions={{
                  color: preset.color,
                  weight: selected ? 7 : 2.5,
                  opacity: selected ? 0.3 : 0.3,
                  lineCap: 'round',
                  dashArray: selected ? undefined : '4 6',
                }}
              />
            )
          })}

          {highlightSegment ? (
            <Pane name="highlight" style={{ zIndex: 650 }}>
              <Polyline
                positions={[
                  [highlightSegment.from.lat, highlightSegment.from.lon],
                  [highlightSegment.to.lat, highlightSegment.to.lon],
                ]}
                interactive={false}
                pathOptions={{ color: '#ff8172', weight: 6, opacity: 0.95 }}
              />
              <CircleMarker
                center={[
                  (highlightSegment.from.lat + highlightSegment.to.lat) / 2,
                  (highlightSegment.from.lon + highlightSegment.to.lon) / 2,
                ]}
                radius={12}
                interactive={false}
                pathOptions={{
                  color: '#ff8172',
                  weight: 3,
                  fillColor: '#ff8172',
                  fillOpacity: 0.08,
                }}
              />
            </Pane>
          ) : null}

          {groups.safe.length ? (
            <Polyline positions={groups.safe} interactive={false} pathOptions={{ color: '#ff6b3d', weight: 2 }} />
          ) : null}
          {groups.caution.length ? (
            <Polyline positions={groups.caution} interactive={false} pathOptions={{ color: '#efc46b', weight: 2.5 }} />
          ) : null}
          {groups.nogo.length ? (
            <Polyline positions={groups.nogo} interactive={false} pathOptions={{ color: '#ff8172', weight: 3 }} />
          ) : null}
          {groups.unknown.length ? (
            <Polyline
              positions={groups.unknown}
              interactive={false}
              pathOptions={{ color: '#5e6c77', weight: 1.5, dashArray: '3 5' }}
            />
          ) : null}

          {waypoints.map((waypoint) => (
            <Marker
              key={waypoint.id}
              position={[waypoint.lat, waypoint.lon]}
              icon={icons.get(waypoint.id)}
              alt={waypoint.name}
              title={waypoint.name}
              eventHandlers={{
                click: (event) => {
                  DomEvent.stopPropagation(event)
                  selectWaypoint(waypoint.id)
                },
              }}
            >
              <Tooltip direction="top" offset={[0, -7]}>
                {waypoint.name}
              </Tooltip>
            </Marker>
          ))}

          {route.map((point, index) => (
            <Marker
              key={point.id}
              position={[point.lat, point.lon]}
              icon={routeIcon(index)}
              alt={`Route point ${index + 1}`}
              title={`Route point ${index + 1}`}
              eventHandlers={{
                click: (event) => {
                  DomEvent.stopPropagation(event)
                  if (point.waypointId) selectWaypoint(point.waypointId)
                },
              }}
            >
              <Tooltip direction="right" offset={[6, 0]}>
                {point.waypointId
                  ? waypoints.find((waypoint) => waypoint.id === point.waypointId)?.name
                  : `Point ${index + 1}`}
              </Tooltip>
            </Marker>
          ))}

          <MapEvents dem={dem} />
          <MapFocus />
          <MapResize bounds={latLngBounds} />
          <MapTelemetry onChange={handleTelemetry} />
          <ZoomControl position="bottomright" />
        </MapContainer>
      )}

      <div className="absolute left-4 top-4 z-[500] flex items-center border border-line bg-bg/90 text-[10px]">
        <button
          type="button"
          onClick={undo}
          disabled={!route.length}
          className="h-7 border-r border-line px-2.5 text-muted transition-colors hover:text-ink disabled:opacity-30"
        >
          Undo
        </button>
        <button
          type="button"
          onClick={clear}
          disabled={!route.length}
          className="h-7 border-r border-line px-2.5 text-muted transition-colors hover:text-ink disabled:opacity-30"
        >
          Clear
        </button>
        <button
          type="button"
          onClick={() => centerOn(centerPoint.lon, centerPoint.lat)}
          className="h-7 px-2.5 text-muted transition-colors hover:text-ink"
        >
          Frame
        </button>
      </div>

      <span className="pointer-events-none absolute left-1.5 top-1.5 z-[500] h-2.5 w-2.5 border-l border-t border-muted/30" aria-hidden />
      <span className="pointer-events-none absolute right-1.5 top-1.5 z-[500] h-2.5 w-2.5 border-r border-t border-muted/30" aria-hidden />
      <span className="pointer-events-none absolute bottom-1.5 left-1.5 z-[500] h-2.5 w-2.5 border-b border-l border-muted/30" aria-hidden />
      <span className="pointer-events-none absolute bottom-1.5 right-1.5 z-[500] h-2.5 w-2.5 border-b border-r border-muted/30" aria-hidden />

      <div className="pointer-events-none absolute right-4 top-4 z-[500] flex flex-col items-end gap-1">
        <svg width="12" height="24" viewBox="0 0 12 24" aria-hidden className="text-muted">
          <line x1="6" y1="24" x2="6" y2="4" stroke="currentColor" strokeWidth="1" />
          <path d="M6 0 10 8 6 6 2 8Z" fill="currentColor" />
        </svg>
        <span className="meta">N</span>
      </div>

      <div className="pointer-events-none absolute right-4 top-16 z-[500] text-right">
        {coordinate ? (
          <>
            <p className="meta text-[10px] text-ink">
              {formatCoord(coordinate.lon, 'lon')} / {formatCoord(coordinate.lat, 'lat')}
            </p>
            <p className="meta mt-0.5">
              {coordinate.elevationM === null ? 'elevation unknown' : `${coordinate.elevationM.toFixed(0)} m`}
            </p>
          </>
        ) : (
          <p className="meta">readout</p>
        )}
      </div>

      {!route.length ? (
        <div className="pointer-events-none absolute left-1/2 top-1/2 z-[500] w-[min(84%,320px)] -translate-x-1/2 -translate-y-1/2 border-l-2 border-accent pl-4">
          <p className="text-[10px] text-accent">No traverse</p>
          <p className="mt-1 text-[22px] font-medium leading-[1.1] tracking-[-0.02em] text-ink">
            Place the first point
          </p>
          <p className="mt-2 max-w-[280px] text-[11px] leading-relaxed text-muted">
            Click the terrain to begin. Every segment is checked against elevation, slope and data gaps.
          </p>
        </div>
      ) : null}

      <div className="pointer-events-none absolute bottom-4 left-4 z-[500]">
        <div className="flex items-end gap-2">
          <div
            className="relative h-2 border-x border-b border-muted/70"
            style={{ width: Math.round(scalePx) }}
            aria-hidden
          >
            <span className="absolute inset-x-0 top-0 h-px bg-muted/40" />
          </div>
          <span className="meta text-[10px] text-ink">{scaleKm} km</span>
        </div>
        <p className="meta mt-0.5">{metersPerPixel.toFixed(1)} m/px</p>
      </div>
    </div>
  )
}
