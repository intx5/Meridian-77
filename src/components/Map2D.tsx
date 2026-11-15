import { useCallback, useEffect, useMemo, useState } from 'react'
import { CRS, DomEvent, divIcon, type DivIcon, type LatLngExpression } from 'leaflet'
import {
  CircleMarker,
  ImageOverlay,
  MapContainer,
  Marker,
  Pane,
  Polygon,
  Polyline,
  Tooltip,
  ZoomControl,
  useMap,
  useMapEvents,
} from 'react-leaflet'
import { boundsCenter, formatCoord, MARS_DEGREE_M } from '@/domain/geo'
import { sampleElevation, type RouteTerrain } from '@/domain/dem'
import { EVA_CONFIG } from '@/domain/eva'
import { sampleSandClass } from '@/domain/sand'
import { sampleRouteDirections } from '@/domain/routeDirections'
import { MAP_MAX_ZOOM, MAP_MIN_ZOOM } from '@/config/region'
import { PRESET_ROUTES } from '@/config/routes'
import type {
  Bounds,
  LayersManifest,
  LonLat,
  RadiationScenarioId,
  RasterGrid,
  SandFeatureCollection,
  SandGrid,
  SandKind,
  Waypoint,
} from '@/types'
import { useMissionStore } from '@/store/useMissionStore'

export interface CandidateMapRoute {
  id: 'route_a' | 'route_b' | 'route_c'
  label: string
  color: string
  dashArray?: string
  waypoints: LonLat[]
  canApply: boolean
}

interface Map2DProps {
  manifest: LayersManifest
  dem: RasterGrid
  sand?: SandGrid
  thermal?: RasterGrid
  temperature?: RasterGrid
  waypoints: Waypoint[]
  terrain: RouteTerrain
  sandDetections?: SandFeatureCollection
  candidateRoutes?: CandidateMapRoute[]
  activeCandidateId?: 'route_a' | 'route_b' | 'route_c' | null
  showRouteDirections?: boolean
  onApplyCandidateRoute?: (id: 'route_a' | 'route_b' | 'route_c') => void
}

const SAND_STYLE: Record<SandKind, { color: string; fillColor: string; dashArray?: string }> = {
  dune_field: { color: '#f4a261', fillColor: '#f4a261' },
  sand_sheet: { color: '#e9c46a', fillColor: '#e9c46a' },
  uncertain_aeolian: { color: '#a78bfa', fillColor: '#a78bfa', dashArray: '4 4' },
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

function MapEvents({ dem, temperature }: { dem: RasterGrid; temperature?: RasterGrid }) {
  const addPoint = useMissionStore((state) => state.addPoint)
  const setCoordinate = useMissionStore((state) => state.setCoordinate)
  const [minLon, minLat, maxLon, maxLat] = dem.bounds
  useMapEvents({
    click(event) {
      const { lng, lat } = event.latlng
      if (lng >= minLon && lng <= maxLon && lat >= minLat && lat <= maxLat) addPoint(lng, lat)
    },
    mousemove(event) {
      setCoordinate({
        lon: event.latlng.lng,
        lat: event.latlng.lat,
        elevationM: sampleElevation(dem, event.latlng.lng, event.latlng.lat),
        temperatureC: temperature ? sampleElevation(temperature, event.latlng.lng, event.latlng.lat) : null,
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

function RouteDirectionMarkers({ route, zoom }: { route: readonly LonLat[]; zoom: number }) {
  const map = useMap()
  const arrows = useMemo(() => {
    const projected = route.map(({ lat, lon }) => map.project([lat, lon], zoom))
    return sampleRouteDirections([projected], (from, to) => from.distanceTo(to), 80, 18)
      .map(({ from, to, fraction }) => {
        const direction = to.subtract(from)
        const position = map.unproject(from.add(direction.multiplyBy(fraction)), zoom)
        const heading = Math.atan2(direction.y, direction.x)
        return {
          position,
          icon: divIcon({
            className: 'route-direction-marker',
            iconSize: [16, 16],
            iconAnchor: [8, 8],
            html: `<span aria-hidden="true" class="route-direction-arrow" style="transform:rotate(${heading}rad)"></span>`,
          }),
        }
      })
  }, [map, route, zoom])
  return (
    <Pane name="route-directions" style={{ zIndex: 560, pointerEvents: 'none' }}>
      {arrows.map(({ position, icon }, index) => (
        <Marker key={index} position={position} icon={icon} interactive={false} keyboard={false} />
      ))}
    </Pane>
  )
}

function buildSeverityGroups(
  samples: RouteTerrain['samples'],
  sand?: SandGrid,
  thermal?: RasterGrid,
  thermalPercentile80 = 348,
  duneNoGoAssumption = false,
  radiationScenarioId: RadiationScenarioId = 'background_gcr',
): Record<'safe' | 'caution' | 'nogo' | 'unknown', Positions> {
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
      const midLon = (prev.lon + next.lon) / 2
      const midLat = (prev.lat + next.lat) / 2
      const sandCode = sand ? sampleSandClass(sand, midLon, midLat) : 0
      const tiVal = thermal ? sampleElevation(thermal, midLon, midLat) : null
      const highThermal = tiVal !== null && tiVal > thermalPercentile80
      const sepHighElev = radiationScenarioId === 'sep_sep2017' && (prev.elevationM + next.elevationM) / 2 > -2450

      if (slope >= EVA_CONFIG.slopeNoGoDeg || (duneNoGoAssumption && sandCode === 1)) {
        level = 'nogo'
      } else if (
        slope >= EVA_CONFIG.slopeCautionDeg ||
        sandCode === 1 ||
        sandCode === 2 ||
        highThermal ||
        sepHighElev
      ) {
        level = 'caution'
      } else {
        level = 'safe'
      }
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

export function Map2D({
  manifest,
  dem,
  sand,
  thermal,
  temperature,
  waypoints,
  terrain,
  sandDetections,
  candidateRoutes,
  activeCandidateId,
  showRouteDirections,
  onApplyCandidateRoute,
}: Map2DProps) {
  const layers = useMissionStore((state) => state.layers)
  const slopeOverlay = useMissionStore((state) => state.slopeOverlay)
  const slopeOpacity = useMissionStore((state) => state.slopeOpacity)
  const shieldingOverlay = useMissionStore((state) => state.shieldingOverlay)
  const shieldingOpacity = useMissionStore((state) => state.shieldingOpacity)
  const radiationScenarioId = useMissionStore((state) => state.radiationScenarioId)
  const radiationComponent = useMissionStore((state) => state.radiationComponent)
  const duneNoGoAssumption = useMissionStore((state) => state.duneNoGoAssumption)
  const showCandidateOverlay = useMissionStore((state) => state.showCandidateOverlay)
  const route = useMissionStore((state) => state.route)
  const undo = useMissionStore((state) => state.undo)
  const clear = useMissionStore((state) => state.clear)
  const selectedWaypointId = useMissionStore((state) => state.selectedWaypointId)
  const selectedSandFeatureId = useMissionStore((state) => state.selectedSandFeatureId)
  const selectSandFeature = useMissionStore((state) => state.selectSandFeature)
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
  const thermalPercentile80 = manifest.layers.find((l) => l.id === 'thermal')?.percentile80 ?? 348
  const groups = useMemo(
    () =>
      buildSeverityGroups(
        terrain.samples,
        sand,
        thermal,
        thermalPercentile80,
        duneNoGoAssumption,
        radiationScenarioId,
      ),
    [terrain.samples, sand, thermal, thermalPercentile80, duneNoGoAssumption, radiationScenarioId],
  )
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
            <p className="text-[14px] text-ink">Map imagery failed to load</p>
            <p className="mt-1 text-[13px] leading-relaxed text-muted">
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
          {(['optical', 'geology', 'topography', 'thermal', 'temperature', 'mineralogy', 'sand', 'radiation'] as const).map(
            (id, index) => {
              const layer = layerById[id]
              const state = layers[id]
              if (!layer || !state?.visible) return null
              const overlayUrl =
                id === 'radiation'
                  ? radiationComponent === 'gcr_only'
                    ? '/data/jezero/radiation-gcr.webp'
                    : radiationComponent === 'sep_only'
                      ? '/data/jezero/radiation-sep.webp'
                      : radiationScenarioId === 'sep_sep2017'
                        ? '/data/jezero/radiation-sep-total.webp'
                        : layer.imageUrl
                  : layer.imageUrl
              const overlayKey =
                id === 'radiation' ? `radiation-${radiationScenarioId}-${radiationComponent}` : id
              return (
                <ImageOverlay
                  key={overlayKey}
                  url={overlayUrl}
                  bounds={latLngBounds}
                  opacity={id === 'sand' ? state.opacity * 0.45 : state.opacity}
                  zIndex={10 + index * 10}
                  className={
                    (id === 'thermal' || id === 'temperature') && (layers.optical.visible || layers.topography.visible)
                      ? 'thermal-overlay'
                      : undefined
                  }
                  eventHandlers={{ error: () => setMapError(true) }}
                />
              )
            },
          )}

          {layers.sand?.visible && sandDetections?.features.length ? (
            <Pane name="sand-polygons" style={{ zIndex: 420 }}>
              {sandDetections.features.map((feature) => {
                const style = SAND_STYLE[feature.properties.kind]
                const selected = feature.properties.id === selectedSandFeatureId
                const positions = feature.geometry.coordinates.map((ring) =>
                  ring.map((pt) => [pt[1], pt[0]] as [number, number]),
                )
                return (
                  <Polygon
                    key={feature.properties.id}
                    positions={positions}
                    pathOptions={{
                      color: style.color,
                      fillColor: style.fillColor,
                      weight: selected ? 2.5 : 1.25,
                      opacity: Math.min(1, layers.sand.opacity * 0.95),
                      fillOpacity: Math.min(0.85, layers.sand.opacity * (selected ? 0.52 : 0.34)),
                      dashArray: style.dashArray,
                    }}
                    eventHandlers={{
                      click: (event) => {
                        DomEvent.stopPropagation(event)
                        selectSandFeature(feature.properties.id)
                      },
                    }}
                  >
                    <Tooltip sticky direction="top">
                      {feature.properties.label} · {feature.properties.areaKm2.toFixed(2)} km² ·{' '}
                      {Math.round(feature.properties.confidence * 100)}% conf.
                    </Tooltip>
                  </Polygon>
                )
              })}
            </Pane>
          ) : null}

          {layers.topography.visible && layerById.topography?.overlay && slopeOverlay ? (
            <ImageOverlay
              url={layerById.topography.overlay.imageUrl}
              bounds={latLngBounds}
              opacity={slopeOpacity}
              zIndex={26}
              eventHandlers={{ error: () => setMapError(true) }}
            />
          ) : null}

          {layerById.radiation?.overlay && shieldingOverlay ? (
            <ImageOverlay
              url={layerById.radiation.overlay.imageUrl}
              bounds={latLngBounds}
              opacity={shieldingOpacity}
              zIndex={76}
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

          {showCandidateOverlay && candidateRoutes?.length ? (
            <Pane name="ai-candidate-routes" style={{ zIndex: 430 }}>
              {candidateRoutes.map((cand) => {
                const isActive = activeCandidateId === cand.id
                return (
                  <Polyline
                    key={`cand-${cand.id}`}
                    interactive={cand.canApply}
                    positions={cand.waypoints.map((pt) => [pt.lat, pt.lon] as [number, number])}
                    pathOptions={{
                      color: cand.color,
                      weight: isActive ? 4.5 : cand.id === 'route_c' ? 3.5 : 3,
                      opacity: isActive ? 0.98 : cand.id === 'route_c' ? 0.92 : 0.82,
                      lineCap: 'round',
                      dashArray: cand.dashArray,
                    }}
                    eventHandlers={{
                      click: (event) => {
                        DomEvent.stopPropagation(event)
                        onApplyCandidateRoute?.(cand.id)
                      },
                    }}
                  >
                    {cand.canApply ? (
                      <Tooltip sticky direction="top">
                        {cand.label} · Click to set as main route
                      </Tooltip>
                    ) : null}
                  </Polyline>
                )
              })}
            </Pane>
          ) : null}

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

          {showRouteDirections ? <RouteDirectionMarkers route={route} zoom={telemetry.zoom} /> : null}

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

          <MapEvents dem={dem} temperature={temperature} />
          <MapFocus />
          <MapResize bounds={latLngBounds} />
          <MapTelemetry onChange={handleTelemetry} />
          <ZoomControl position="bottomright" />
        </MapContainer>
      )}

      <div className="absolute left-4 top-4 z-[500] flex flex-wrap items-center gap-1.5 text-[13px]">
        <div className="flex items-center border border-line bg-bg/90">
          <button
            type="button"
            onClick={undo}
            disabled={!route.length}
            className="h-9 border-r border-line px-2.5 text-muted transition-colors hover:text-ink disabled:opacity-30"
          >
            Undo
          </button>
          <button
            type="button"
            onClick={clear}
            disabled={!route.length}
            className="h-9 border-r border-line px-2.5 text-muted transition-colors hover:text-ink disabled:opacity-30"
          >
            Clear
          </button>
          <button
            type="button"
            onClick={() => centerOn(centerPoint.lon, centerPoint.lat)}
            className="h-9 px-2.5 text-muted transition-colors hover:text-ink"
          >
            Frame
          </button>
        </div>

        {onApplyCandidateRoute && candidateRoutes?.some((c) => c.id === 'route_c' && c.canApply) ? (
          <button
            type="button"
            onClick={() => onApplyCandidateRoute('route_c')}
            className={`flex h-9 items-center gap-1.5 border px-2.5 font-mono transition-colors ${
              activeCandidateId === 'route_c'
                ? 'border-[#3b82f6] bg-[#3b82f6]/20 text-ink'
                : 'border-[#3b82f6]/70 bg-bg/95 text-[#60a5fa] hover:bg-[#3b82f6]/15 hover:text-ink'
            }`}
          >
            <span className="h-2 w-2 shrink-0 rounded-full bg-[#3b82f6]" aria-hidden />
            <span>{activeCandidateId === 'route_c' ? 'AI Blue Path Active' : 'Use AI Blue Path'}</span>
          </button>
        ) : null}
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

      <div className="pointer-events-none absolute right-4 top-28 z-[500] max-w-[calc(100%-2rem)] border border-line bg-bg/95 px-3 py-2 text-right">
        {coordinate ? (
          <>
            <p className="meta text-[13px] text-ink">
              {formatCoord(coordinate.lon, 'lon')} / {formatCoord(coordinate.lat, 'lat')}
            </p>
            <p className="meta mt-0.5">
              {coordinate.elevationM === null ? 'elevation unknown' : `${coordinate.elevationM.toFixed(0)} m`}
              {coordinate.temperatureC !== null && coordinate.temperatureC !== undefined
                ? ` · ${coordinate.temperatureC.toFixed(1)} °C`
                : ''}
            </p>
          </>
        ) : (
          <p className="meta">readout</p>
        )}
      </div>

      {!route.length ? (
        <div className="pointer-events-none absolute left-1/2 top-1/2 z-[500] w-[min(84%,320px)] -translate-x-1/2 -translate-y-1/2 border-l-2 border-accent pl-4">
          <p className="text-[13px] text-accent">No traverse</p>
          <p className="mt-1 text-[22px] font-medium leading-[1.1] tracking-[-0.02em] text-ink">
            Place the first point
          </p>
          <p className="mt-2 max-w-[280px] text-[13px] leading-relaxed text-muted">
            Click the terrain to begin. Every segment is checked against elevation, slope and data gaps.
          </p>
        </div>
      ) : null}

      <div className="pointer-events-none absolute bottom-4 left-4 z-[500] border border-line bg-bg/95 px-3 py-2">
        <div className="flex items-end gap-2">
          <div
            className="relative h-2 border-x border-b border-muted/70"
            style={{ width: Math.round(scalePx) }}
            aria-hidden
          >
            <span className="absolute inset-x-0 top-0 h-px bg-muted/40" />
          </div>
          <span className="meta text-[13px] text-ink">{scaleKm} km</span>
        </div>
        <p className="meta mt-0.5">{metersPerPixel.toFixed(1)} m/px</p>
      </div>

      {layers.radiation?.visible || shieldingOverlay ? (
        <div
          role="status"
          aria-label="Radiation overlay status"
          className="pointer-events-none absolute bottom-20 right-4 z-[500] max-w-[min(360px,calc(100%-2rem))] border border-line bg-bg/95 px-3 py-3 leading-relaxed text-left text-[13px]"
        >
          {layers.radiation?.visible ? (
            <p className="text-ink">
              <span className="text-caution">REGIONAL MODEL</span> ·{' '}
              {radiationComponent === 'gcr_only'
                ? 'GCR Baseline Only (~10.6 µGy/h · Yellow-Gold = Highest)'
                : radiationComponent === 'sep_only'
                  ? 'SEP Surge Only (+11.1 µGy/h · Pink-Rose = Highest)'
                  : radiationScenarioId === 'sep_sep2017'
                    ? 'Sep 2017 SEP Total (~21.6 µGy/h · Bright Yellow/Red = Highest)'
                    : 'GCR Total (~10.6 µGy/h · Bright Amber/Yellow = Highest)'}
            </p>
          ) : null}
          {shieldingOverlay ? (
            <p className="text-[#38bdf8]">
              Terrain Shielding Potential — Experimental (16-az DEM Sky-View; not % dose reduction)
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
