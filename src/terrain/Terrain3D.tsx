import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useThree, type ThreeEvent } from '@react-three/fiber'
import { NoToneMapping } from 'three'
import type { TerrainViewProps } from '@/components/TerrainView'
import type { RasterGrid } from '@/types'
import { useMissionStore } from '@/store/useMissionStore'
import { sampleElevation } from '@/domain/dem'
import { formatCoord } from '@/domain/geo'
import { sampleRouteDirections } from '@/domain/routeDirections'
import { createFrame, fromLocal, sampleSurface, toLocal, releaseTerrainCache } from './model'
import { GeometryService, loadMolaTerrain, type TileManifest } from './resources'
import { TerrainTile } from './TerrainTile'
import { TerrainStations } from './TerrainStations'
import { TerrainCamera, type CameraCommand } from './TerrainCamera'
import {
  TerrainDirectionProjection, TerrainMarkers, TerrainLabelProjection, type DrapedCandidate3D, type TerrainLabel,
} from './TerrainMarkers'
import { drapeRoute } from './routes'

function Diagnostics({ onError }: { onError: (error: Error) => void }) {
  const { gl, scene, camera } = useThree()
  useEffect(() => {
    const canvas = gl.domElement
    const lost = (event: Event) => {
      event.preventDefault()
      onError(new Error('WebGL context lost. Return to 2D; reopen 3D to retry.'))
    }
    canvas.addEventListener('webglcontextlost', lost)
    const timer = setInterval(() => {
      let geometryBytes = 0,
        textureBytes = 0,
        tiles = 0,
        stationModels = 0
      scene.traverse((object) => {
        if (object.userData.stationModel) stationModels++
        const mesh = object as import('three').Mesh
        if (!mesh.userData.terrain) return
        tiles++
        for (const attr of Object.values(mesh.geometry.attributes)) geometryBytes += attr.array.byteLength
        geometryBytes += mesh.geometry.index?.array.byteLength ?? 0
        const material = mesh.material as import('three').MeshStandardMaterial
        const image = material.map?.image as { width: number; height: number } | undefined
        if (image) textureBytes += (image.width * image.height * 4 * 4) / 3
      })
      canvas.dataset.terrainStats = JSON.stringify({
        tiles,
        stationModels,
        geometries: gl.info.memory.geometries,
        textures: gl.info.memory.textures,
        triangles: gl.info.render.triangles,
        drawCalls: gl.info.render.calls,
        renderedFrames: gl.info.render.frame,
        camera: camera.position.toArray(),
        geometryMiB: +(geometryBytes / 1048576).toFixed(1),
        textureMiBEstimate: +(textureBytes / 1048576).toFixed(1),
      })
    }, 1500)
    return () => {
      clearInterval(timer)
      canvas.removeEventListener('webglcontextlost', lost)
    }
  }, [gl, scene, camera, onError])
  return null
}

export default function Terrain3D({
  manifest,
  dem,
  temperature,
  waypoints,
  terrain,
  candidateRoutes,
  activeCandidateId,
  showRouteDirections,
  onApplyCandidateRoute,
}: TerrainViewProps) {
  const frame = useMemo(() => createFrame(dem), [dem])
  const [assets, setAssets] = useState<TileManifest | null>(null),
    [service, setService] = useState<GeometryService | null>(null)
  const [mola, setMola] = useState<RasterGrid | null>(null)
  const [error, setError] = useState<string | null>(null),
    [edit, setEdit] = useState(false)
  const [command, setCommand] = useState<CameraCommand>({ kind: 'overview', nonce: 0 })
  const relief = useMissionStore((s) => s.relief),
    setRelief = useMissionStore((s) => s.setRelief)
  const layers = useMissionStore((s) => s.layers),
    slopeOverlay = useMissionStore((s) => s.slopeOverlay),
    slopeOpacity = useMissionStore((s) => s.slopeOpacity),
    shieldingOverlay = useMissionStore((s) => s.shieldingOverlay),
    shieldingOpacity = useMissionStore((s) => s.shieldingOpacity),
    radiationScenarioId = useMissionStore((s) => s.radiationScenarioId),
    radiationComponent = useMissionStore((s) => s.radiationComponent),
    showCandidateOverlay = useMissionStore((s) => s.showCandidateOverlay)
  const route = useMissionStore((s) => s.route),
    coordinate = useMissionStore((s) => s.coordinate)
  const selected = useMissionStore((s) => s.selectedWaypointId),
    focus = useMissionStore((s) => s.centerOn)
  const select = useMissionStore((s) => s.selectWaypoint)
  const add = useMissionStore((s) => s.addPoint),
    undo = useMissionStore((s) => s.undo),
    clear = useMissionStore((s) => s.clear)
  const setCoordinate = useMissionStore((s) => s.setCoordinate)
  const settings = useMemo(
    () => ({
      layers,
      slopeOverlay,
      slopeOpacity,
      shieldingOverlay,
      shieldingOpacity,
      radiationScenarioId,
      radiationComponent,
    }),
    [
      layers,
      slopeOverlay,
      slopeOpacity,
      shieldingOverlay,
      shieldingOpacity,
      radiationScenarioId,
      radiationComponent,
    ],
  )
  const draped = useMemo(() => drapeRoute(dem, frame, route, relief), [dem, frame, route, relief])
  const directions = useMemo(() => showRouteDirections ? sampleRouteDirections(
    draped.lines.map(({ points }) => points),
    (from, to) => Math.hypot(to[0] - from[0], to[2] - from[2]),
    500,
    10,
  ) : [], [draped, showRouteDirections])
  const directionContainer = useRef<HTMLDivElement>(null)
  const candidateDraped = useMemo<DrapedCandidate3D[]>(() => {
    if (!showCandidateOverlay || !candidateRoutes?.length) return []
    return candidateRoutes.map((cand) => {
      const heightOffset = cand.id === 'route_c' ? 1.5 : cand.id === 'route_b' ? 1.3 : 1.05
      return {
        id: cand.id,
        color: cand.color,
        isActive: activeCandidateId === cand.id,
        draped: drapeRoute(dem, frame, cand.waypoints, relief, cand.color, heightOffset),
      }
    })
  }, [showCandidateOverlay, candidateRoutes, activeCandidateId, dem, frame, relief])
  const labelContainer = useRef<HTMLDivElement>(null)
  const labels = useMemo(() => {
    const result: TerrainLabel[] = []
    for (const point of [
      ...waypoints.map((w) => ({ ...w, key: w.id, text: w.name, station: true, waypointId: w.id })),
      ...route.map((p, i) => ({ ...p, key: p.id, text: `${i + 1}`, station: false })),
    ]) {
      const height = sampleSurface(dem, frame, point)
      if (height === null) continue
      const p = toLocal(frame, point)
      result.push({ ...point, position: [p.x, (height - frame.referenceM) * relief + (point.station ? 0 : 2), p.z] })
    }
    return result
  }, [waypoints, route, dem, frame, relief])
  const fineTiles = useMemo(() => {
    const tiles = new Set(draped.tiles)
    for (const cand of candidateDraped) {
      for (const tile of cand.draped.tiles) tiles.add(tile)
    }
    for (const point of [...waypoints, ...route]) {
      const b = dem.bounds
      const col = Math.floor(((point.lon - b[0]) / (b[2] - b[0])) * 8),
        row = Math.floor(((b[3] - point.lat) / (b[3] - b[1])) * 8)
      // All touching tiles retain fine geometry for a marker exactly on a boundary.
      if (col >= 0 && col < 8 && row >= 0 && row < 8) tiles.add(`${col}-${row}`)
    }
    return tiles
  }, [draped, candidateDraped, waypoints, route, dem])
  const onError = useCallback((reason: Error) => setError(reason.message), [])
  const lastReadout = useRef(0)
  useEffect(() => {
    const abort = new AbortController()
    let worker: GeometryService | undefined
    Promise.all([
      fetch('/data/jezero/terrain/manifest.json', { signal: abort.signal }),
      loadMolaTerrain(abort.signal),
    ])
      .then(async ([response, fallback]) => {
        if (!response.ok)
          throw new Error('Local terrain tiles are missing. Run python scripts/prepare_terrain.py.')
        const value = (await response.json()) as TileManifest
        if (
          value.version !== 1 ||
          value.count !== 8 ||
          value.demWidth !== dem.width ||
          value.demHeight !== dem.height ||
          !value.bounds.every((v, i) => Math.abs(v - dem.bounds[i]) < 1e-9)
        )
          throw new Error('Terrain tiles do not match this DEM region.')
        if (!abort.signal.aborted) {
          worker = new GeometryService(dem, frame, fallback)
          setService(worker)
          setAssets(value)
          setMola(fallback)
        }
      })
      .catch((reason) => {
        if (!abort.signal.aborted) onError(reason)
      })
    return () => {
      abort.abort()
      worker?.dispose()
      releaseTerrainCache(dem)
    }
  }, [dem, frame, onError])
  const click = useCallback(
    (event: ThreeEvent<MouseEvent>) => {
      event.stopPropagation()
      if (!edit || event.button !== 0 || event.delta > 4) return
      const point = fromLocal(frame, event.point.x, event.point.z)
      if (sampleSurface(dem, frame, point) !== null) add(point.lon, point.lat)
    },
    [edit, frame, dem, add],
  )
  const move = useCallback(
    (event: ThreeEvent<PointerEvent>) => {
      event.stopPropagation()
      if (performance.now() - lastReadout.current < 75) return
      lastReadout.current = performance.now()
      const p = fromLocal(frame, event.point.x, event.point.z)
      setCoordinate({
        ...p,
        elevationM: sampleElevation(dem, p.lon, p.lat),
        temperatureC: temperature ? sampleElevation(temperature, p.lon, p.lat) : null,
      })
    },
    [dem, temperature, frame, setCoordinate],
  )
  if (error) throw new Error(error)
  const selectedStation = waypoints.find((w) => w.id === selected) ?? waypoints[0]
  const isMolaReadout = coordinate && coordinate.elevationM === null && mola &&
    sampleElevation(mola, coordinate.lon, coordinate.lat) !== null
  return (
    <div className="terrain-3d" onPointerLeave={() => setCoordinate(null)}>
      {assets && service ? (
        <Canvas
          frameloop="demand"
          dpr={[1, 1.5]}
          camera={{ position: [0, 10000, 10000], near: 1, far: 100000, fov: 45 }}
          gl={{ antialias: true, powerPreference: 'high-performance', toneMapping: NoToneMapping }}
          fallback={
            <div className="terrain-message" role="alert">
              WebGL is unavailable. Select 2D Map View above.
            </div>
          }
        >
          <color attach="background" args={['#11191e']} />
          <ambientLight intensity={1.3} />
          <directionalLight position={[-5000, 8000, -3000]} intensity={1.8} />
          {/* Pointer-down and click can hit different tiles at a seam as the camera settles. */}
          <group onClick={click} onPointerMove={move}>
            {Array.from({ length: 64 }, (_, i) => (
              <TerrainTile
                key={i}
                col={i % 8}
                row={Math.floor(i / 8)}
                frame={frame}
                service={service}
                manifest={assets}
                settings={settings}
                relief={relief}
                forceFine={fineTiles.has(`${i % 8}-${Math.floor(i / 8)}`)}
                onError={onError}
              />
            ))}
          </group>
          <TerrainMarkers
            dem={dem}
            frame={frame}
            relief={relief}
            draped={draped}
            candidateDraped={candidateDraped}
          />
          <TerrainCamera dem={dem} frame={frame} relief={relief} command={command} />
          <TerrainStations anchors={labels} onSelect={select} />
          <TerrainLabelProjection container={labelContainer} labels={labels} />
          {directions.length ? <TerrainDirectionProjection container={directionContainer} directions={directions} /> : null}
          <Diagnostics onError={onError} />
        </Canvas>
      ) : (
        <div className="terrain-message" role="status">
          Preparing measured terrain…
        </div>
      )}
      {directions.length ? (
        <div className="terrain-route-directions" ref={directionContainer} aria-hidden="true">
          {directions.map((_, index) => <span className="route-direction-arrow" key={index} />)}
        </div>
      ) : null}
      <div className="terrain-labels" ref={labelContainer}>
        {labels.map((label) => (
          <button
            key={label.key}
            className={`${label.station ? 'terrain-station' : 'terrain-route-pin'} ${label.waypointId === selected ? 'is-selected' : ''}`}
            aria-label={label.station ? `${label.text} · open science card` : `Route point ${label.text}`}
            onClick={() => {
              if (label.waypointId) select(label.waypointId)
              else focus(label.lon, label.lat)
            }}
          >
            {label.station ? label.text.split(' · ')[0] : label.text}
          </button>
        ))}
      </div>
      <div className="terrain-toolbar">
        <div className="terrain-controls" role="group" aria-label="3D camera">
          <button onClick={() => setCommand({ kind: 'overview', nonce: Date.now() })}>Default 3D</button>
          <button onClick={() => setCommand({ kind: 'overhead', nonce: Date.now() })}>Top view</button>
          <button
            disabled={!selectedStation}
            onClick={() => selectedStation && focus(selectedStation.lon, selectedStation.lat)}
          >
            Focus station
          </button>
        </div>
        <div className="terrain-controls" role="group" aria-label="Vertical scale">
          {([1, 2, 3] as const).map((value) => (
            <button key={value} aria-pressed={relief === value} onClick={() => setRelief(value)}>
              {value === 1 ? 'Real scale · 1×' : `${value}× relief`}
            </button>
          ))}
        </div>
      </div>
      <div className="terrain-edit terrain-controls">
        <button aria-pressed={edit} onClick={() => setEdit(!edit)}>
          {edit ? 'Place points · ON' : 'Place route points'}
        </button>
        <button onClick={undo} disabled={!route.length}>
          Undo
        </button>
        <button onClick={clear} disabled={!route.length}>
          Clear
        </button>
        {onApplyCandidateRoute && candidateRoutes?.some((c) => c.id === 'route_c' && c.canApply) ? (
          <button
            aria-pressed={activeCandidateId === 'route_c'}
            onClick={() => onApplyCandidateRoute('route_c')}
            style={{ color: '#60a5fa' }}
          >
            {activeCandidateId === 'route_c' ? '● AI Blue Path Active' : '● Use AI Blue Path'}
          </button>
        ) : null}
      </div>
      <div className="terrain-caption" aria-live="polite">
        <strong>{relief === 1 ? 'REAL SCALE · 1×' : `ENHANCED RELIEF · ${relief}× — visual only`}</strong>
        <span>
          DEM grid 9.77 projected m · optical source 2 m/px; distant tiles reduced · N away in default view
        </span>
        <span>
          {mola
            ? 'MOLA gap fill · 463 m resolution · visual only'
            : `Dark gaps: no measured elevation (${(100 - manifest.elevation.coveragePercent).toFixed(1)}%).`}
        </span>
        {(terrain.unknownFraction > 0 || draped.unknown > 0) && (
          <span className="terrain-warning">
            Unknown route portions are omitted in 3D. See 2D for their horizontal path.
          </span>
        )}
        <span>Drag to orbit · right-drag to pan · scroll to zoom · station models and shading are illustrative</span>
        <span>
          Optical detail does not increase DEM resolution. All EVA calculations retain original elevations.
        </span>
      </div>
      {coordinate && (
        <div className="terrain-readout">
          {formatCoord(coordinate.lon, 'lon')} / {formatCoord(coordinate.lat, 'lat')}
          <br />
          {coordinate.elevationM === null
            ? (isMolaReadout ? 'MOLA terrain · visual only' : 'Elevation unknown')
            : `${coordinate.elevationM.toFixed(1)} m · original DEM`}
          {coordinate.temperatureC !== null && coordinate.temperatureC !== undefined
            ? ` · ${coordinate.temperatureC.toFixed(1)} °C`
            : ''}
        </div>
      )}
      {labels.length < route.length + waypoints.length && (
        <span className="terrain-warning">
          {route.length + waypoints.length - labels.length} marker(s) lack measured terrain height and are
          omitted. Inspect their coordinates in 2D.
        </span>
      )}
    </div>
  )
}
