export type Bounds = [number, number, number, number]

export interface LonLat {
  lon: number
  lat: number
}

export interface Region {
  name: string
  bounds: Bounds
  projectedBoundsM: Bounds
  coordinateSystem: string
}

export type LayerId = 'optical' | 'topography' | 'geology' | 'thermal' | 'mineralogy'

export interface LegendItem {
  label: string
  color: string
}

export interface LayerOverlay {
  id: string
  label: string
  imageUrl: string
  defaultOpacity: number
  legend: LegendItem[]
}

export interface MapLayer {
  id: LayerId
  label: string
  imageUrl: string
  sourceUrl: string
  resolution: string
  units?: string
  note?: string
  legend: LegendItem[]
  overlay?: LayerOverlay
  coveragePercent?: number
  percentile80?: number
  thresholdPositive?: number
}

export interface LayersManifest {
  region: Region
  layers: MapLayer[]
  elevation: {
    url: string
    sourceUrl: string
    coveragePercent: number
    verticalReference: string
  }
  pov?: { imageUrl: string; imageCredit: string; sourceUrl: string }
}

export interface RasterGrid {
  bounds: Bounds
  width: number
  height: number
  noData: number
  values: number[]
  units?: string
  sourceUrl?: string
  percentile80?: number
}

export type WaypointKind = 'start' | 'science' | 'pov' | 'end'

export interface GeologicUnit {
  unit: string | null
  label: string
  color: string
}

export interface Waypoint {
  id: string
  name: string
  lon: number
  lat: number
  kind: WaypointKind
  imageUrl: string | null
  imageCredit: string
  sourceUrl: string
  minerals: string[]
  note: string
  sol?: number
  geologyUnit?: GeologicUnit
  spectral?: { bandDepth2300: number; threshold: number }
  thermalInertia?: number
  elevationM?: number
  locationBasis?: string
}

export interface RoutePoint extends LonLat {
  id: string
  waypointId?: string
}

export type Verdict = 'GO' | 'CAUTION' | 'NO-GO' | 'INSUFFICIENT DATA'

export interface EvaFactor {
  factor: string
  value: string
  penalty: number
  reason: string
}

export interface EvaResult {
  distanceKm: number
  durationHours: number
  stopCount: number
  maxSlopeDeg: number
  meanSlopeDeg: number
  elevationGainM: number
  elevationLossM: number
  hazardCount: number
  unknownFraction: number
  safetyScore: number
  scienceScore: number
  compositeScore: number
  verdict: Verdict
  verdictReason: string
  breakdown: EvaFactor[]
}

export interface MissionTarget {
  id: string
  name: string
  lon: number
  lat: number
  description: string
}

export type PresetRouteId = 'A' | 'B'

export interface PresetRoute {
  id: PresetRouteId
  label: string
  color: string
  targetId: string
  waypoints: LonLat[]
}

export interface ReturnBudget {
  outboundHours: number
  returnHours: number
  targetStayMinutes: number
  reserveMinutes: number
  timeLimitHours: number
  totalHours: number
  marginHours: number
  maxTargetStayMinutes: number
  latestDeparture: string
  latestReturn: string
  targetReachable: boolean
  exceeded: boolean
  excessMinutes: number
  unknownFraction: number
  dataInsufficient: boolean
}
