import { buildChunk, type TerrainFrame } from './model'
import { fillTerrainGaps } from './terrainFallback'
import type { RasterGrid } from '@/types'

let dem: RasterGrid
let frame: TerrainFrame
self.onmessage = (event: MessageEvent) => {
  const message = event.data
  if (message.type === 'init') {
    dem = message.mola ? fillTerrainGaps(message.dem, message.mola) : message.dem
    frame = message.frame
    return
  }
  try {
    const data = buildChunk(dem, frame, message.col, message.row, 8, message.stride)
    self.postMessage(
      { id: message.id, data },
      { transfer: [data.positions.buffer, data.normals.buffer, data.uvs.buffer, data.indices.buffer] },
    )
  } catch (error) {
    self.postMessage({ id: message.id, error: String(error) })
  }
}
