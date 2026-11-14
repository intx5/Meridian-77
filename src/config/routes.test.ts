import { describe, expect, it } from 'vitest'
import { PRESET_ROUTES, SHARED_START, SHARED_TARGET } from './routes'

const BOUNDS = [77.29436321794068, 18.39402047680302, 77.46306926652184, 18.562726525384175]

describe('preset routes', () => {
  it('provides two routes with the same start and the same science target', () => {
    expect(PRESET_ROUTES).toHaveLength(2)
    for (const route of PRESET_ROUTES) {
      expect(route.waypoints[0]).toEqual(SHARED_START)
      expect(route.waypoints.at(-1)).toEqual(SHARED_TARGET)
      expect(route.targetId).toBe('delta-front')
    }
  })

  it('keeps every preset waypoint inside the mapped region', () => {
    for (const route of PRESET_ROUTES) {
      for (const point of route.waypoints) {
        expect(point.lon).toBeGreaterThanOrEqual(BOUNDS[0])
        expect(point.lon).toBeLessThanOrEqual(BOUNDS[2])
        expect(point.lat).toBeGreaterThanOrEqual(BOUNDS[1])
        expect(point.lat).toBeLessThanOrEqual(BOUNDS[3])
      }
    }
  })
})
