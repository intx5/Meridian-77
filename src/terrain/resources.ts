import { BufferAttribute, BufferGeometry, CanvasTexture, SRGBColorSpace } from 'three'
import type { RasterGrid, LayerId, RadiationComponentId, RadiationScenarioId } from '@/types'
import type { LayerState } from '@/store/useMissionStore'
import type { ChunkData, TerrainFrame } from './model'

export interface TileManifest {
  version: number
  count: number
  gutter: number
  bounds: number[]
  demWidth: number
  demHeight: number
  layers: Record<string, { tileSize: number; sourceSize: number[] }>
}

/** Optional lower-resolution elevation for the 3D surface. */
export async function loadMolaTerrain(signal: AbortSignal): Promise<RasterGrid | null> {
  try {
    const response = await fetch('/data/jezero/terrain/mola-dem.json', { signal })
    if (!response.ok) return null
    const grid = (await response.json()) as RasterGrid
    if (
      !grid || !Array.isArray(grid.bounds) || grid.bounds.length !== 4 || !grid.bounds.every(Number.isFinite) ||
      grid.bounds[0] >= grid.bounds[2] || grid.bounds[1] >= grid.bounds[3] ||
      !Number.isSafeInteger(grid.width) || grid.width <= 0 ||
      !Number.isSafeInteger(grid.height) || grid.height <= 0 ||
      !Number.isFinite(grid.noData) || !Array.isArray(grid.values) ||
      grid.values.length !== grid.width * grid.height || !grid.values.every(Number.isFinite)
    ) return null
    return grid
  } catch {
    return null
  }
}

export class GeometryService {
  private worker: Worker
  private serial = 0
  private pending = new Map<number, { resolve: (data: ChunkData) => void; reject: (error: Error) => void }>()
  constructor(dem: RasterGrid, frame: TerrainFrame, mola: RasterGrid | null) {
    this.worker = new Worker(new URL('./geometry.worker.ts', import.meta.url), { type: 'module' })
    this.worker.postMessage({ type: 'init', dem, frame, mola })
    this.worker.onmessage = ({ data }) => {
      const request = this.pending.get(data.id)
      this.pending.delete(data.id)
      if (data.error) request?.reject(new Error(data.error))
      else request?.resolve(data.data)
    }
    this.worker.onerror = () => this.fail(new Error('Terrain worker failed. Return to 2D and retry.'))
  }
  build(col: number, row: number, stride: number): Promise<ChunkData> {
    const id = ++this.serial
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.worker.postMessage({ id, col, row, stride })
    })
  }
  private fail(error: Error) {
    for (const p of this.pending.values()) p.reject(error)
    this.pending.clear()
  }
  dispose() {
    this.worker.terminate()
    this.fail(new Error('Terrain closed'))
  }
}

export function makeGeometry(data: ChunkData) {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(data.positions, 3))
  geometry.setAttribute('normal', new BufferAttribute(data.normals, 3))
  geometry.setAttribute('uv', new BufferAttribute(data.uvs, 2))
  geometry.setIndex(new BufferAttribute(data.indices, 1))
  geometry.computeBoundingSphere()
  return geometry
}

export interface CompositeSettings {
  layers: Record<LayerId, LayerState>
  slopeOverlay: boolean
  slopeOpacity: number
  shieldingOverlay?: boolean
  shieldingOpacity?: number
  radiationScenarioId?: RadiationScenarioId
  radiationComponent?: RadiationComponentId
}

/** One GPU sampler per chunk; images are decoded sequentially and immediately released. */
export async function compositeTile(
  manifest: TileManifest,
  col: number,
  row: number,
  settings: CompositeSettings,
  signal: AbortSignal,
  high: boolean,
  anisotropy: number,
) {
  const edge = high ? manifest.layers.optical.tileSize : 160
  const gutter = 2
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = edge + gutter * 2
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Texture compositing is not supported')
  ctx.fillStyle = '#9a9185'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  // Exactly the Leaflet z order (slope z=26 precedes topography z=30).
  const stack = [
    'optical',
    'geology',
    'slope',
    'topography',
    'thermal',
    'temperature',
    'mineralogy',
    'sand',
    'radiation',
    'shielding',
  ] as const
  for (const id of stack) {
    const state =
      id === 'slope'
        ? {
            visible: settings.slopeOverlay && settings.layers.topography.visible,
            opacity: settings.slopeOpacity,
          }
        : id === 'shielding'
          ? {
              visible: Boolean(settings.shieldingOverlay),
              opacity: settings.shieldingOpacity ?? 0.7,
            }
          : settings.layers[id]
    if (!state?.visible || state.opacity <= 0) continue
    const sourceId =
      id === 'optical' && !high
        ? 'optical-low'
        : id === 'radiation'
          ? settings.radiationComponent === 'gcr_only'
            ? 'radiation-gcr'
            : settings.radiationComponent === 'sep_only'
              ? 'radiation-sep'
              : settings.radiationScenarioId === 'sep_sep2017'
                ? 'radiation-sep-total'
                : 'radiation'
          : id
    const response = await fetch(`/data/jezero/terrain/${sourceId}/${col}-${row}.webp`, { signal })
    if (!response.ok || !response.headers.get('content-type')?.startsWith('image/'))
      throw new Error(`Terrain ${id} tile is unavailable (${col}, ${row}). Regenerate local terrain assets.`)
    const bitmap = await createImageBitmap(await response.blob())
    try {
      signal.throwIfAborted()
      ctx.globalAlpha = state.opacity
      ctx.globalCompositeOperation =
        (id === 'thermal' || id === 'temperature') && (settings.layers.optical.visible || settings.layers.topography.visible)
          ? 'multiply'
          : 'source-over'
      const sourceSize = manifest.layers[sourceId].tileSize
      // Keep geographic tile edges at precisely the same UVs for every source resolution.
      const scale = edge / sourceSize,
        sourceGutter = manifest.gutter * scale
      ctx.drawImage(
        bitmap,
        gutter - sourceGutter,
        gutter - sourceGutter,
        edge + sourceGutter * 2,
        edge + sourceGutter * 2,
      )
    } finally {
      bitmap.close()
    }
  }
  signal.throwIfAborted()
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  texture.anisotropy = Math.min(8, anisotropy)
  texture.offset.set(gutter / canvas.width, gutter / canvas.height)
  texture.repeat.set(edge / canvas.width, edge / canvas.height)
  return texture
}
