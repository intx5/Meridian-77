import type { Bounds, LonLat } from '@/types'

/** Volumetric mean radius used for surface distance, not the raster projection sphere. */
export const MARS_RADIUS_KM = 3389.5
/** Surface metres per degree of latitude on the mean-radius sphere. */
export const MARS_DEGREE_M = (2 * Math.PI * MARS_RADIUS_KM * 1000) / 360
const DEG = Math.PI / 180

export function haversineKm(a: LonLat, b: LonLat): number {
  const dLat = (b.lat - a.lat) * DEG
  const dLon = (b.lon - a.lon) * DEG
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * DEG) * Math.cos(b.lat * DEG) * Math.sin(dLon / 2) ** 2
  return 2 * MARS_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)))
}

export function pathDistanceKm(points: LonLat[]): number {
  let total = 0
  for (let i = 1; i < points.length; i += 1) total += haversineKm(points[i - 1], points[i])
  return total
}

/**
 * Linear lon/lat interpolation at a fixed spacing, including the start and
 * excluding the end. Over a few kilometres the great-circle deviation from
 * linear interpolation is far below DEM resolution.
 */
export function interpolateSegment(a: LonLat, b: LonLat, spacingKm: number): LonLat[] {
  const distance = haversineKm(a, b)
  const steps = Math.max(1, Math.ceil(distance / Math.max(spacingKm, 0.001)))
  return Array.from({ length: steps }, (_, i) => {
    const t = i / steps
    return { lon: a.lon + (b.lon - a.lon) * t, lat: a.lat + (b.lat - a.lat) * t }
  })
}

export function boundsCenter(bounds: Bounds): LonLat {
  return { lon: (bounds[0] + bounds[2]) / 2, lat: (bounds[1] + bounds[3]) / 2 }
}

export function formatKm(km: number): string {
  if (!Number.isFinite(km)) return '—'
  return km < 10 ? `${km.toFixed(2)} km` : `${km.toFixed(1)} km`
}

export function formatDuration(hours: number): string {
  if (!Number.isFinite(hours)) return '—'
  const totalMinutes = Math.round(hours * 60)
  const sign = totalMinutes < 0 ? '−' : ''
  const absolute = Math.abs(totalMinutes)
  const h = Math.floor(absolute / 60)
  const m = absolute % 60
  return h > 0 ? `${sign}${h} h ${String(m).padStart(2, '0')} min` : `${sign}${m} min`
}

export function formatCoord(value: number, axis: 'lon' | 'lat'): string {
  const suffix = value >= 0 ? (axis === 'lon' ? 'E' : 'N') : axis === 'lon' ? 'W' : 'S'
  return `${Math.abs(value).toFixed(4)}° ${suffix}`
}

/** Minutes after midnight → HH:mm, wrapped to a 24-hour clock. */
export function formatClock(totalMinutes: number): string {
  if (!Number.isFinite(totalMinutes)) return '—'
  const minutes = ((Math.round(totalMinutes) % 1440) + 1440) % 1440
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}
