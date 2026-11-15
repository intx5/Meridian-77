import { useEffect, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import type { BufferGeometry, Texture } from 'three'
import {
  compositeTile,
  makeGeometry,
  type CompositeSettings,
  type GeometryService,
  type TileManifest,
} from './resources'
import type { TerrainFrame } from './model'

interface Props {
  col: number
  row: number
  frame: TerrainFrame
  service: GeometryService
  manifest: TileManifest
  settings: CompositeSettings
  relief: number
  forceFine: boolean
  onError: (error: Error) => void
}
export function TerrainTile({
  col,
  row,
  frame,
  service,
  manifest,
  settings,
  relief,
  forceFine,
  onError,
}: Props) {
  const [stride, setStride] = useState(4)
  const [geometry, setGeometry] = useState<BufferGeometry | null>(null)
  const [texture, setTexture] = useState<Texture | null>(null)
  const { invalidate, gl } = useThree()
  const lastCheck = useRef(0)
  const actualStride = forceFine ? 1 : stride
  useFrame(({ camera, clock }) => {
    if (clock.elapsedTime - lastCheck.current < 0.2) return
    lastCheck.current = clock.elapsedTime
    const x = ((col + 0.5) / 8 - 0.5) * frame.width,
      z = ((row + 0.5) / 8 - 0.5) * frame.depth
    const distance = Math.hypot(camera.position.x - x, camera.position.z - z, camera.position.y)
    const next = distance < 2300 ? 1 : distance < 5200 ? 2 : 4
    if (next !== stride) setStride(next)
  })
  useEffect(() => {
    let cancelled = false
    service
      .build(col, row, actualStride)
      .then((data) => {
        if (cancelled) return
        setGeometry(makeGeometry(data))
        invalidate()
      })
      .catch((error) => {
        if (!cancelled) onError(error)
      })
    return () => {
      cancelled = true
    }
  }, [service, col, row, actualStride, invalidate, onError])
  useEffect(
    () => () => {
      geometry?.dispose()
    },
    [geometry],
  )
  const high = actualStride <= 2
  useEffect(() => {
    const controller = new AbortController()
    // Debounce sliders and spread decode/upload work across frames.
    const timer = setTimeout(
      () => {
        compositeTile(
          manifest,
          col,
          row,
          settings,
          controller.signal,
          high,
          gl.capabilities.getMaxAnisotropy(),
        )
          .then((result) => {
            if (controller.signal.aborted) {
              result.dispose()
              return
            }
            setTexture(result)
            invalidate()
          })
          .catch((error) => {
            if (!controller.signal.aborted) onError(error)
          })
      },
      100 + ((row * 8 + col) % 8) * 15,
    )
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [manifest, col, row, settings, high, gl, invalidate, onError])
  useEffect(
    () => () => {
      texture?.dispose()
    },
    [texture],
  )
  if (!geometry) return null
  return (
    <mesh
      geometry={geometry}
      scale={[1, relief, 1]}
      userData={{ terrain: true, stride: actualStride }}
    >
      <meshStandardMaterial
        key={texture ? 'textured' : 'loading'}
        map={texture}
        color={texture ? '#ffffff' : '#93897c'}
        roughness={1}
        metalness={0}
        polygonOffset
        polygonOffsetFactor={1}
        polygonOffsetUnits={1}
      />
    </mesh>
  )
}
