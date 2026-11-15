import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { useRef } from 'react'
import { MathUtils, PerspectiveCamera, type Group } from 'three'
import type { TerrainLabel } from './TerrainMarkers'

function StationModel({ anchor, onClick }: {
  anchor: TerrainLabel
  onClick: (event: ThreeEvent<MouseEvent>) => void
}) {
  const model = useRef<Group>(null)
  const accent = anchor.kind === 'start' ? '#ff9a61' : '#76d1ed'
  useFrame(({ camera, size }) => {
    if (!model.current || !(camera instanceof PerspectiveCamera) || !size.height) return
    // Scale the map symbol with viewing distance so that its features are readable at overview.
    const distance = camera.position.distanceTo(model.current.position)
    const metresPerPixel = 2 * distance * Math.tan(MathUtils.degToRad(camera.getEffectiveFOV() / 2)) / size.height
    model.current.scale.setScalar(Math.max(2, metresPerPixel * 12))
  })

  return (
    <group ref={model} name={anchor.text} position={anchor.position} userData={{ stationModel: true }} onClick={onClick}>
      <mesh position={[0, 0.08, 0]}>
        <cylinderGeometry args={[0.63, 0.7, 0.19, 6]} />
        <meshStandardMaterial color="#343e42" roughness={0.92} />
      </mesh>
      <mesh position={[0, 0.2, 0]}>
        <cylinderGeometry args={[0.57, 0.57, 0.05, 6]} />
        <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={0.25} />
      </mesh>
      <mesh position={[0, 0.43, 0]}>
        <cylinderGeometry args={[0.46, 0.48, 0.44, 6]} />
        <meshStandardMaterial color="#aeb7b6" roughness={0.6} metalness={0.25} />
      </mesh>
      <mesh position={[0, 0.7, 0]}>
        <cylinderGeometry args={[0.28, 0.46, 0.14, 6]} />
        <meshStandardMaterial color="#e1d9c9" roughness={0.72} />
      </mesh>
      {[-1, 1].map((side) => (
        <group key={side} position={[side * 0.73, 0.46, 0]} rotation={[0.19, 0, 0]}>
          <mesh>
            <boxGeometry args={[0.65, 0.07, 0.55]} />
            <meshStandardMaterial color="#cad5d4" roughness={0.62} />
          </mesh>
          <mesh position={[0, 0.043, 0]}>
            <boxGeometry args={[0.56, 0.02, 0.46]} />
            <meshStandardMaterial color="#174659" emissive="#155f89" emissiveIntensity={0.28} />
          </mesh>
        </group>
      ))}
      <mesh position={[0.1, 0.92, 0]}>
        <cylinderGeometry args={[0.026, 0.035, 0.33, 6]} />
        <meshStandardMaterial color="#d6dedb" roughness={0.58} />
      </mesh>
      <mesh position={[0.1, 1.1, 0]} rotation={[0.36, 0, -0.32]}>
        <cylinderGeometry args={[0.18, 0.07, 0.1, 8]} />
        <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={0.3} />
      </mesh>
    </group>
  )
}

export function TerrainStations({ anchors, onSelect }: {
  anchors: TerrainLabel[]
  onSelect: (id: string) => void
}) {
  return anchors.map((anchor) => {
    const id = anchor.waypointId
    if (!anchor.station || !id) return null
    return <StationModel key={id} anchor={anchor} onClick={(event) => {
      if (event.button !== 0 || event.delta > 4) return
      event.stopPropagation()
      onSelect(id)
    }} />
  })
}
