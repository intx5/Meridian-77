import { useEffect, useRef, type ComponentRef } from 'react'
import { OrbitControls } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { MathUtils, PerspectiveCamera, Vector3 } from 'three'
import type { RasterGrid } from '@/types'
import { useMissionStore } from '@/store/useMissionStore'
import { cameraFloor, sampleSurface, toLocal, type TerrainFrame } from './model'

export interface CameraCommand {
  kind: 'overview' | 'overhead' | 'focus'
  nonce: number
}
export function TerrainCamera({
  dem,
  frame,
  relief,
  command,
}: {
  dem: RasterGrid
  frame: TerrainFrame
  relief: number
  command: CameraCommand
}) {
  const ref = useRef<ComponentRef<typeof OrbitControls>>(null)
  const { camera, invalidate, size } = useThree()
  const focus = useMissionStore((s) => s.focus)
  const targetMove = useRef<{ position: Vector3; target: Vector3 } | null>(null)
  const initialized = useRef(false)
  useEffect(() => {
    const controls = ref.current
    if (!controls || !(camera instanceof PerspectiveCamera)) return
    const distance = Math.max(frame.depth, frame.width / Math.max(size.width / size.height, 0.3)) * 1.35
    const target = new Vector3(0, 0, 0)
    let position = new Vector3(0, distance * 0.75, distance * 0.72)
    if (command.kind === 'overhead') position = new Vector3(0, distance, 0.1)
    if (!initialized.current) {
      camera.position.copy(position)
      controls.target.copy(target)
      controls.update()
      initialized.current = true
    } else targetMove.current = { position, target }
    invalidate()
  }, [camera, frame, command, size.width, size.height, invalidate])
  useEffect(() => {
    if (!focus) return
    const p = toLocal(frame, focus),
      height = sampleSurface(dem, frame, focus)
    if (height === null) return
    const target = new Vector3(p.x, (height - frame.referenceM) * relief, p.z)
    targetMove.current = { target, position: target.clone().add(new Vector3(0, 1200, 1550)) }
    invalidate()
  }, [focus, frame, dem, relief, invalidate])
  useFrame(({ camera }, delta) => {
    const controls = ref.current
    if (!controls) return
    const move = targetMove.current
    if (move) {
      // Constrain the destination too: otherwise collision clamping can prevent convergence forever.
      move.position.y = Math.max(
        move.position.y,
        cameraFloor(dem, frame, move.position.x, move.position.z, relief),
      )
      const t = 1 - Math.exp(-Math.min(delta, 0.05) * 6)
      camera.position.lerp(move.position, t)
      controls.target.lerp(move.target, t)
      if (camera.position.distanceTo(move.position) < 1 && controls.target.distanceTo(move.target) < 1)
        targetMove.current = null
      controls.update()
      invalidate()
    }
    // Bound panning without clipping the user's orbit. No Earth elevation assumptions.
    const x = MathUtils.clamp(controls.target.x, -frame.width / 2, frame.width / 2)
    const z = MathUtils.clamp(controls.target.z, -frame.depth / 2, frame.depth / 2)
    if (x !== controls.target.x || z !== controls.target.z) {
      camera.position.x += x - controls.target.x
      camera.position.z += z - controls.target.z
      controls.target.x = x
      controls.target.z = z
      invalidate()
    }
    const floor = cameraFloor(dem, frame, camera.position.x, camera.position.z, relief)
    if (camera.position.y < floor - 0.001) {
      // Leave a centimetre to avoid numerical jitter repeatedly invalidating an idle scene.
      camera.position.y = floor + 0.01
      controls.update()
      invalidate()
    }
  })
  return (
    <OrbitControls
      ref={ref}
      makeDefault
      enableDamping
      dampingFactor={0.09}
      minDistance={100}
      maxDistance={45000}
      minPolarAngle={0}
      maxPolarAngle={Math.PI / 2 - 0.06}
      screenSpacePanning={false}
      onStart={() => {
        targetMove.current = null
      }}
    />
  )
}
