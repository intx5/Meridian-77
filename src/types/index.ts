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

export type LayerId =
  | 'optical'
  | 'topography'
  | 'geology'
  | 'thermal'
  | 'temperature'
  | 'mineralogy'
  | 'sand'
  | 'radiation'

export type RadiationScenarioId = 'background_gcr' | 'sep_sep2017'

export type RadiationComponentId = 'total' | 'gcr_only' | 'sep_only'

export interface RadObservationRecord {
  productId: string
  sol: number
  obsIndex: number
  startUtc: string
  startMarsLocal: string
  durationSeconds: number
  qcFlag: string
  absorbedDoseRateSiliconMicroGyPerHour: number
  absorbedDoseRateTissuePlasticMicroGyPerHour: number
  units: string
  measurementLocation: string
  dataStatus: 'MEASURED_GALE_RAD_RDR'
}

export interface StationShieldingContext {
  id: string
  name: string
  lon: number
  lat: number
  elevationM?: number
  meanHorizonObstructionDeg: number | null
  maxHorizonObstructionDeg: number | null
  skyVisibilityFraction: number | null
  experimentalShieldingProxy: number | null
}

export interface RadiationReferenceData {
  schemaVersion: number
  datasetId: string
  instrument: string
  measurementSite: {
    name: string
    lat: number
    lon: number
    elevationMolaM: number
    note: string
  }
  applicationSite: {
    name: string
    bounds: Bounds
    meanElevationMolaM: number
    elevationRangeM: [number, number]
    status: string
    spatialResolutionNote: string
  }
  summary: {
    gcrBackgroundMeanTissuePlasticMicroGyPerHour: number
    gcrBackgroundMeanSiliconMicroGyPerHour: number
    gcrSolarCycleRangeMicroGyPerHour: [number, number]
    sep2017PeakSiliconMicroGyPerHour: number
    sep2017PeakTissuePlasticMicroGyPerHour: number
    sep2017SixHourPeakWindowMeanMicroGyPerHour: number
    sep2017AdditionalEventIntegratedMicroGy: number
    publishedGcrMeanQualityFactorQ: number
    publishedGcrQualityFactorUncertainty: number
    verifiedObservationCount: number
  }
  sep2017HighCadenceSeries: RadObservationRecord[]
  solarCycleReferenceSeries: RadObservationRecord[]
  stationTopographicContext: StationShieldingContext[]
}

export interface RadiationScenario {
  id: RadiationScenarioId
  label: string
  shortLabel: string
  dataStatus: string
  radiationSource: string
  referenceOrigin: string
  referenceDateRange: string
  absorbedDoseRateMicroGyPerHour: number
  siliconAbsorbedDoseRateMicroGyPerHour: number
  peakAbsorbedDoseRateMicroGyPerHour?: number
  gcrComponentMicroGyPerHour: number
  sepComponentMicroGyPerHour: number
  uncertaintyPercent: number
  publishedMeanQualityFactorQ: number
  informationalDoseEquivalentRateMicroSvPerHour: number
  sixHourEvaReferenceDoseMicroGy: number
  sixHourEvaUncertaintyRangeMicroGy: [number, number]
  shelterAdvisory: string
  limitations: string[]
}

export interface RadiationScenariosData {
  schemaVersion: number
  defaultScenarioId: RadiationScenarioId
  scenarios: RadiationScenario[]
}

export interface RadiationProvenanceSource {
  id: string
  title: string
  datasetId?: string
  profileUrl?: string
  archiveUrl?: string
  url?: string
  localPath?: string
  variablesUsed?: string[]
  citations?: string[]
  role?: string
}

export interface RadiationProvenanceData {
  schemaVersion: number
  generatedAtUtc: string
  pipelineScript: string
  sources: RadiationProvenanceSource[]
  processingSteps: string[]
}

export interface ShieldingGrid {
  bounds: Bounds
  width: number
  height: number
  noData: number
  cellSizeM: number
  units: string
  layerLabel: string
  disclaimer: string
  summary: {
    meanSkyVisibilityFraction: number
    minSkyVisibilityFraction: number
    meanHorizonObstructionDeg: number
    maxHorizonObstructionDeg: number
    meanShieldingProxy: number
    demCoveragePercent: number
  }
  skyVisibilityValues: number[]
  meanHorizonDegValues: number[]
}

export type SandClassCode = 0 | 1 | 2 | 3

export type SandKind = 'dune_field' | 'sand_sheet' | 'uncertain_aeolian'

export interface SandFeatureProperties {
  id: string
  kind: SandKind
  label: string
  areaM2: number
  areaKm2: number
  detectionMethod: string
  confidence: number
  confidenceLabel: string
  sourceImage: string
  resolution: string
  meanSlopeDeg: number
  meanThermalInertia: number | null
  rippleCoherence: number
  usgsUnit: string
  limitations: string
}

export interface SandFeature {
  type: 'Feature'
  id: string
  properties: SandFeatureProperties
  geometry: {
    type: 'Polygon'
    coordinates: number[][][]
  }
}

export interface SandFeatureCollection {
  type: 'FeatureCollection'
  region: string
  coordinateSystem: string
  features: SandFeature[]
}

export interface SandGrid extends RasterGrid {
  classes?: Record<string, string>
  summary?: {
    duneAreaKm2: number
    sandSheetAreaKm2: number
    uncertainAreaKm2: number
    dunePercent: number
    sandSheetPercent: number
    uncertainPercent: number
    polygonCount: number
    hirise25cmCoveragePercent: number
  }
}

export interface SandHazardSegment {
  fromKm: number
  toKm: number
  kind: SandKind
  from: LonLat
  to: LonLat
}

export interface RouteSandAssessment {
  duneKm: number
  sandSheetKm: number
  uncertainKm: number
  duneFraction: number
  sandSheetFraction: number
  uncertainFraction: number
  totalSandFraction: number
  hazardSegments: SandHazardSegment[]
}

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
  scienceStopMinutes: number
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
