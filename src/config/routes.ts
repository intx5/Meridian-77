import type { LonLat, PresetRoute } from '@/types'

/** Shared start: Octavia E. Butler Landing (sol 14 traverse endpoint). */
export const SHARED_START: LonLat = { lon: 77.450947, lat: 18.444543 }

/** Shared science target: Skinner Ridge / delta front (sol 490 traverse endpoint). */
export const SHARED_TARGET: LonLat = { lon: 77.406171, lat: 18.458931 }

/**
 * Two pre-planned traverses between the same start and the same science
 * target. They are planning scenarios, not certified routes.
 *
 * Route A is the longer southern bench detour: it crosses the 15° caution
 * threshold and leaves only a short target-stay window.
 * Route B is the shorter valley approach: lower maximum slope and a much
 * larger target-stay budget.
 */
export const PRESET_ROUTES: PresetRoute[] = [
  {
    id: 'A',
    label: 'Route A · southern bench',
    color: '#ff6b3d',
    targetId: 'delta-front',
    waypoints: [
      SHARED_START,
      { lon: 77.442, lat: 18.436 },
      { lon: 77.43, lat: 18.432 },
      { lon: 77.418, lat: 18.443 },
      SHARED_TARGET,
    ],
  },
  {
    id: 'B',
    label: 'Route B · valley approach',
    color: '#57c7ff',
    targetId: 'delta-front',
    waypoints: [
      SHARED_START,
      { lon: 77.4455, lat: 18.446 },
      { lon: 77.435, lat: 18.449 },
      { lon: 77.422, lat: 18.453 },
      SHARED_TARGET,
    ],
  },
]

export function presetRoute(id: 'A' | 'B'): PresetRoute {
  const route = PRESET_ROUTES.find((item) => item.id === id)
  if (!route) throw new Error(`Unknown preset route: ${id}`)
  return route
}
