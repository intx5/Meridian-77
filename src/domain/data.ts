import type {
  Bounds,
  LayersManifest,
  MapLayer,
  RadiationProvenanceData,
  RadiationReferenceData,
  RadiationScenariosData,
  RasterGrid,
  SandFeatureCollection,
  SandGrid,
  ShieldingGrid,
  Waypoint,
} from '@/types'
import { MANIFEST_URL } from '@/config/region'
import { validateRadiationData } from './radiation'
import { validateSandData } from './sand'
import { rasterCellCount, sameRasterBounds } from './dem'

const REQUIRED_LAYERS = ['optical', 'topography', 'geology', 'thermal', 'mineralogy'] as const

function validateRaster(name: string, raster: RasterGrid, bounds: Bounds): void {
  const expectedCells = rasterCellCount(name, raster, bounds)
  if (!Array.isArray(raster.values) || raster.values.length !== expectedCells) {
    throw new Error(`${name}: expected ${expectedCells} values, got ${raster.values?.length ?? 0}`)
  }
}

export function validateMissionData(
  manifest: LayersManifest,
  dem: RasterGrid,
  waypoints: Waypoint[],
  thermal?: RasterGrid,
): void {
  const bounds = manifest.region?.bounds
  if (!Array.isArray(bounds) || bounds.length !== 4 || !bounds.every(Number.isFinite) ||
    bounds[0] >= bounds[2] || bounds[1] >= bounds[3]) {
    throw new Error('layers.json: invalid region bounds')
  }
  const [minLon, minLat, maxLon, maxLat] = bounds

  const ids = new Set(manifest.layers.map((layer) => layer.id))
  for (const id of REQUIRED_LAYERS) {
    if (!ids.has(id)) throw new Error(`layers.json: missing layer: ${id}`)
  }

  for (const layer of manifest.layers) {
    const layerBounds = (layer as MapLayer & { bounds?: number[] }).bounds
    if (layerBounds && !sameRasterBounds(layerBounds, bounds)) {
      throw new Error(`layers.json: ${layer.id} bounds do not match the region`)
    }
  }

  validateRaster('dem.json', dem, bounds)
  if (thermal !== undefined) validateRaster('thermal.json', thermal, bounds)

  for (const waypoint of waypoints) {
    if (!Number.isFinite(waypoint.lon) || !Number.isFinite(waypoint.lat) ||
      waypoint.lon < minLon || waypoint.lon > maxLon || waypoint.lat < minLat || waypoint.lat > maxLat) {
      throw new Error(`waypoints.json: ${waypoint.id} is outside the region`)
    }
  }
}

export interface MissionData {
  manifest: LayersManifest
  dem: RasterGrid
  waypoints: Waypoint[]
  sand: SandGrid
  sandDetections: SandFeatureCollection
  thermal: RasterGrid
  temperature: RasterGrid
  mineralogy: RasterGrid
  radiationReference: RadiationReferenceData
  radiationScenarios: RadiationScenariosData
  radiationProvenance: RadiationProvenanceData
  shieldingGrid: ShieldingGrid
}

async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal })
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`)
  return (await response.json()) as T
}

export async function loadMissionData(signal?: AbortSignal): Promise<MissionData> {
  const manifest = await fetchJson<LayersManifest>(MANIFEST_URL, signal)
  const [
    dem,
    waypoints,
    sand,
    sandDetections,
    thermal,
    temperature,
    mineralogy,
    radiationReference,
    radiationScenarios,
    radiationProvenance,
    shieldingGrid,
  ] = await Promise.all([
    fetchJson<RasterGrid>(manifest.elevation.url, signal),
    fetchJson<Waypoint[]>('/data/jezero/waypoints.json', signal),
    fetchJson<SandGrid>('/data/jezero/sand.json', signal),
    fetchJson<SandFeatureCollection>('/data/jezero/sand-detections.geojson', signal),
    fetchJson<RasterGrid>('/data/jezero/thermal.json', signal),
    fetchJson<RasterGrid>('/data/jezero/temperature.json', signal),
    fetchJson<RasterGrid>('/data/jezero/mineralogy.json', signal),
    fetchJson<RadiationReferenceData>('/data/jezero/radiation/radiation-reference.json', signal),
    fetchJson<RadiationScenariosData>('/data/jezero/radiation/radiation-scenarios.json', signal),
    fetchJson<RadiationProvenanceData>('/data/jezero/radiation/radiation-provenance.json', signal),
    fetchJson<ShieldingGrid>('/data/jezero/radiation/shielding-grid.json', signal),
  ])
  validateMissionData(manifest, dem, waypoints, thermal)
  validateRaster('temperature.json', temperature, manifest.region.bounds)
  validateRaster('mineralogy.json', mineralogy, manifest.region.bounds)
  validateSandData(sand, sandDetections, manifest.region.bounds)
  validateRadiationData(
    radiationReference,
    radiationScenarios,
    radiationProvenance,
    shieldingGrid,
    manifest.region.bounds,
  )
  return {
    manifest,
    dem,
    waypoints,
    sand,
    sandDetections,
    thermal,
    temperature,
    mineralogy,
    radiationReference,
    radiationScenarios,
    radiationProvenance,
    shieldingGrid,
  }
}
