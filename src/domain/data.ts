import type { LayersManifest, MapLayer, RasterGrid, Waypoint } from '@/types'
import { MANIFEST_URL } from '@/config/region'

const REQUIRED_LAYERS = ['optical', 'topography', 'geology', 'thermal', 'mineralogy'] as const

const sameBounds = (a: number[], b: number[]) =>
  a.length === 4 && b.length === 4 && a.every((value, index) => Math.abs(value - b[index]) < 1e-9)

export function validateMissionData(
  manifest: LayersManifest,
  dem: RasterGrid,
  waypoints: Waypoint[],
): void {
  const region = manifest.region
  if (!region?.bounds || region.bounds.length !== 4) throw new Error('layers.json: region bounds are missing')

  const ids = new Set(manifest.layers.map((layer) => layer.id))
  for (const id of REQUIRED_LAYERS) {
    if (!ids.has(id)) throw new Error(`layers.json: missing layer: ${id}`)
  }

  for (const layer of manifest.layers) {
    const bounds = (layer as MapLayer & { bounds?: number[] }).bounds
    if (bounds && !sameBounds(bounds, region.bounds)) {
      throw new Error(`layers.json: ${layer.id} bounds do not match the region`)
    }
  }

  if (!sameBounds(dem.bounds, region.bounds)) throw new Error('dem.json: bounds do not match the region')
  if (dem.values.length !== dem.width * dem.height) {
    throw new Error(`dem.json: expected ${dem.width * dem.height} values, got ${dem.values.length}`)
  }

  for (const waypoint of waypoints) {
    const [minLon, minLat, maxLon, maxLat] = region.bounds
    if (waypoint.lon < minLon || waypoint.lon > maxLon || waypoint.lat < minLat || waypoint.lat > maxLat) {
      throw new Error(`waypoints.json: ${waypoint.id} is outside the region`)
    }
  }
}

export interface MissionData {
  manifest: LayersManifest
  dem: RasterGrid
  waypoints: Waypoint[]
}

async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal })
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`)
  return (await response.json()) as T
}

export async function loadMissionData(signal?: AbortSignal): Promise<MissionData> {
  const manifest = await fetchJson<LayersManifest>(MANIFEST_URL, signal)
  const [dem, waypoints] = await Promise.all([
    fetchJson<RasterGrid>(manifest.elevation.url, signal),
    fetchJson<Waypoint[]>('/data/jezero/waypoints.json', signal),
  ])
  validateMissionData(manifest, dem, waypoints)
  return { manifest, dem, waypoints }
}
