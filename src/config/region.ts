import type { MissionTarget } from '@/types'

export const DATA_BASE = '/data/jezero'
export const MANIFEST_URL = `${DATA_BASE}/layers.json`

/** Science targets are real Perseverance traverse positions inside the mapped region. */
export const MISSION_TARGETS: MissionTarget[] = [
  {
    id: 'delta-front',
    name: 'Delta front · Skinner Ridge',
    lon: 77.406171,
    lat: 18.458931,
    description: 'Sedimentary fan front sampled on sol 490. Closest target to the rover science stations.',
  },
  {
    id: 'upper-delta',
    name: 'Upper delta margin',
    lon: 77.346647,
    lat: 18.495396,
    description: 'Upper fan traverse position. A long walk that stresses the six hour EVA budget.',
  },
  {
    id: 'crater-floor',
    name: 'Crater floor · landing site',
    lon: 77.450947,
    lat: 18.444543,
    description: 'Octavia E. Butler Landing and the sol 14 traverse start on the crater floor.',
  },
]

export const DEFAULT_TARGET_ID = 'delta-front'

/** Science target → Perseverance station card used by the return-by card. */
export const TARGET_WAYPOINT_ID: Record<string, string> = {
  'delta-front': 'wp-02',
  'upper-delta': 'wp-05',
  'crater-floor': 'wp-01',
}
export const MAP_MIN_ZOOM = 10
export const MAP_MAX_ZOOM = 17
