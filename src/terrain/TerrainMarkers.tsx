import { Line } from '@react-three/drei'
import { useMemo, type RefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import { Vector3 } from 'three'
import type { RasterGrid, WaypointKind } from '@/types'
import type { RouteDirection } from '@/domain/routeDirections'
import { useMissionStore } from '@/store/useMissionStore'
import type { TerrainFrame } from './model'
import { drapeRoute, type RouteLine } from './routes'

export interface TerrainLabel {
  key: string
  position: [number, number, number]
  text: string
  station: boolean
  kind?: WaypointKind
  waypointId?: string
  lon: number
  lat: number
}

/** Project the existing React DOM labels; avoid independent React roots inside the renderer. */
export function TerrainLabelProjection({
  container,
  labels,
}: {
  container: RefObject<HTMLDivElement | null>
  labels: TerrainLabel[]
}) {
  const vector = useMemo(() => new Vector3(), [])
  useFrame(({ camera, size }) => {
    labels.forEach((label, index) => {
      const element = container.current?.children[index] as HTMLElement | undefined
      if (!element) return
      vector.set(...label.position).project(camera)
      const visible =
        vector.z >= -1 && vector.z <= 1 && Math.abs(vector.x) < 1.05 && Math.abs(vector.y) < 1.05
      element.style.display = visible ? '' : 'none'
      element.style.visibility = visible ? 'visible' : 'hidden'
      if (visible)
        element.style.transform = `translate(${((vector.x + 1) * size.width) / 2}px,${((1 - vector.y) * size.height) / 2}px) translate(-50%,${label.station ? 'calc(-100% - 20px)' : '-50%'})`
    })
  })
  return null
}

export interface DrapedCandidate3D {
  id: 'route_a' | 'route_b' | 'route_c'
  color: string
  isActive: boolean
  draped: ReturnType<typeof drapeRoute>
}

export function TerrainDirectionProjection({
  container,
  directions,
}: {
  container: RefObject<HTMLDivElement | null>
  directions: RouteDirection<RouteLine['points'][number]>[]
}) {
  const vectors = useMemo(() => ({ start: new Vector3(), end: new Vector3(), center: new Vector3() }), [])
  useFrame(({ camera, size }) => {
    const { start, end, center } = vectors
    directions.forEach(({ from, to, fraction }, index) => {
      const arrow = container.current?.children[index] as HTMLElement | undefined
      if (!arrow) return
      start.set(...from)
      end.set(...to)
      center.lerpVectors(start, end, fraction).project(camera)
      start.project(camera)
      end.project(camera)
      const dx = (end.x - start.x) * size.width
      const dy = (start.y - end.y) * size.height
      const visible = center.z >= -1 && center.z <= 1 &&
        Math.abs(center.x) <= 1 && Math.abs(center.y) <= 1 && Math.hypot(dx, dy) > 0.001
      arrow.style.visibility = visible ? 'visible' : 'hidden'
      if (!visible) return
      const x = ((center.x + 1) * size.width) / 2
      const y = ((1 - center.y) * size.height) / 2
      arrow.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%) rotate(${Math.atan2(dy, dx)}rad)`
    })
  })
  return null
}

export function TerrainMarkers({
  dem,
  frame,
  relief,
  draped,
  candidateDraped = [],
}: {
  dem: RasterGrid
  frame: TerrainFrame
  relief: number
  draped: ReturnType<typeof drapeRoute>
  candidateDraped?: DrapedCandidate3D[]
}) {
  const highlight = useMissionStore((s) => s.highlightSegment)
  const highlightLines = useMemo(
    () => (highlight ? drapeRoute(dem, frame, [highlight.from, highlight.to], relief).lines : []),
    [dem, frame, highlight, relief],
  )
  return (
    <>
      {candidateDraped.flatMap((cand) =>
        cand.draped.lines.map((line, i) => (
          <Line
            key={`cand-${cand.id}-${i}`}
            points={line.points}
            color={cand.color}
            lineWidth={cand.isActive ? 4.5 : cand.id === 'route_b' || cand.id === 'route_c' ? 3.5 : 2.2}
            dashed={cand.id === 'route_a'}
            dashSize={18}
            gapSize={10}
            raycast={() => null}
          />
        )),
      )}
      {draped.lines.map((line, i) => (
        <Line key={i} points={line.points} color={line.color} lineWidth={2.5} raycast={() => null} />
      ))}
      {highlightLines.map((line, i) => (
        <Line key={`h${i}`} points={line.points} color="#fff5d1" lineWidth={6} raycast={() => null} />
      ))}
    </>
  )
}
