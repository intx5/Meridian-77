import { Component, lazy, Suspense, type ReactNode } from 'react'
import { Map2D, type CandidateMapRoute } from './Map2D'
import type { LayersManifest, RasterGrid, SandFeatureCollection, SandGrid, Waypoint } from '@/types'
import type { RouteTerrain } from '@/domain/dem'
import { useMissionStore } from '@/store/useMissionStore'

const Terrain3D = lazy(() => import('@/terrain/Terrain3D'))
export interface TerrainViewProps {
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

class TerrainBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state: { error: string | null } = { error: null }
  static getDerivedStateFromError(error: Error) {
    return { error: error.message }
  }
  render() {
    return this.state.error ? (
      <div role="alert" className="terrain-message">
        <strong>3D terrain unavailable</strong>
        <p>{this.state.error}</p>
        <button onClick={() => useMissionStore.getState().setViewMode('2d')}>Return to 2D Map View</button>
      </div>
    ) : (
      this.props.children
    )
  }
}
export function TerrainView(props: TerrainViewProps) {
  const mode = useMissionStore((s) => s.viewMode),
    setMode = useMissionStore((s) => s.setViewMode)
  return (
    <div className="terrain-view">
      <div className="terrain-view-switch" role="group" aria-label="Map view">
        <button aria-pressed={mode === '2d'} onClick={() => setMode('2d')}>
          2D Map View
        </button>
        <button aria-pressed={mode === '3d'} onClick={() => setMode('3d')}>
          3D Terrain View
        </button>
      </div>
      <div className="terrain-viewport">
        {mode === '2d' ? (
          <Map2D {...props} />
        ) : (
          <TerrainBoundary>
            <Suspense
              fallback={
                <div className="terrain-message" role="status">
                  Loading 3D renderer…
                </div>
              }
            >
              <Terrain3D {...props} />
            </Suspense>
          </TerrainBoundary>
        )}
      </div>
    </div>
  )
}
