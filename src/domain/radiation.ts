import { rasterCellCount, sameRasterBounds, type RouteTerrain } from './dem'
import { MIN_TRAVERSE_KM } from '@/config/eva'
import type {
  Bounds,
  LonLat,
  RadiationComponentId,
  RadiationProvenanceData,
  RadiationReferenceData,
  RadiationScenario,
  RadiationScenarioId,
  RadiationScenariosData,
  RadObservationRecord,
  ReturnBudget,
  ShieldingGrid,
} from '@/types'

export type AbsorbedDoseUnit = 'uGy' | 'mGy' | 'Gy'
export type AbsorbedDoseRateUnit = 'uGy/h' | 'mGy/h' | 'Gy/h' | 'uGy/day'

export interface RawPdsObservationInput {
  productId: string
  sol: number
  obsIndex: number
  startObsUtc: string
  startObsMars?: string
  obsDurationSeconds: number
  qcFlag: string
  doseBMicroGyPerHour: number | null | undefined
  doseEMicroGyPerHour: number | null | undefined
}

export interface PointShieldingSample {
  skyVisibilityFraction: number | null
  meanHorizonObstructionDeg: number | null
  experimentalShieldingProxy: number | null
}

export interface RouteShieldingAssessment {
  meanSkyVisibilityFraction: number | null
  minSkyVisibilityFraction: number | null
  meanHorizonObstructionDeg: number | null
  maxHorizonObstructionDeg: number | null
  meanExperimentalShieldingProxy: number | null
  knownSampleFraction: number
  bestShelterCandidate: {
    lon: number
    lat: number
    distanceKm: number
    skyVisibilityFraction: number
    horizonObstructionDeg: number
  } | null
  /** Sky visibility is NEVER equated directly to a percentage dose reduction. */
  claimedDoseReductionPercent: null
  statusLabel: 'Terrain Shielding Potential — Experimental'
  caveats: string[]
}

export interface EvaRadiationAssessment {
  status: 'OK' | 'INSUFFICIENT_DATA'
  estimateLabel: 'Environmental Radiation Exposure Estimate (Unshielded Surface Reference)'
  measurementVsModelLabel:
    | 'Gale Crater RAD Reference -> Jezero Environmental Estimate'
    | 'Historical SEP Event Reference -> Jezero Environmental Estimate'
  verdictImpact: 'ADVISORY_ONLY_NO_AUTOMATIC_GO_NOGO'
  scenarioId: RadiationScenarioId
  scenarioLabel: string
  component: RadiationComponentId
  componentLabel: string
  radiationSource: string
  referenceOrigin: string
  referenceDateRange: string
  /** Physical absorbed dose rate in microGray/hour (never conflated with Sievert). */
  referenceDoseRateMicroGyPerHour: number
  siliconDoseRateMicroGyPerHour: number
  gcrDoseRateMicroGyPerHour: number
  sepDoseRateMicroGyPerHour: number
  outboundWalkHours: number
  scienceStopHours: number
  targetStayHours: number
  returnWalkHours: number
  totalExposureHours: number
  /** Outbound walk + science/target stop absorbed dose (uGy). */
  estimatedRouteExposureMicroGy: number
  outboundWalkExposureMicroGy: number
  scienceStopExposureMicroGy: number
  returnExposureMicroGy: number
  /** Total round-trip integrated absorbed dose (uGy). */
  totalModeledExposureMicroGy: number
  uncertaintyPercent: number
  uncertaintyRangeMicroGy: [number, number]
  /** Optional informational dose-equivalent using published MSL-RAD quality factor <Q>. */
  publishedQualityFactorQ: number
  informationalDoseEquivalentMicroSv: number
  topographicShielding: RouteShieldingAssessment
  shelterAdvisory: string
  limitations: string[]
}

export interface RouteRadiationComparisonItem {
  routeId: string
  routeLabel: string
  totalHours: number
  totalExposureMicroGy: number
  uncertaintyRangeMicroGy: [number, number]
  differenceFromShortestHours: number
  differenceFromLowestExposureMicroGy: number
  comparisonBasisNote: string
}

/**
 * Convert PDS YYYY-DOY HH:MM:SS timestamps to ISO-8601 UTC.
 */
export function pdsDoyToIsoUtc(rawUtc: string): string | null {
  const clean = rawUtc.trim().replace(/^"|"$/g, '')
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(clean)) return clean
  const match = /^(\d{4})-(\d{3})[T\s](\d{2}:\d{2}:\d{2})$/.exec(clean)
  if (!match) return null
  const year = Number(match[1])
  const doy = Number(match[2])
  const timePart = match[3]
  if (!Number.isInteger(year) || !Number.isInteger(doy) || doy < 1 || doy > 366) return null
  const jan1 = Date.UTC(year, 0, 1)
  const targetDate = new Date(jan1 + (doy - 1) * 86_400_000)
  if (targetDate.getUTCFullYear() !== year) return null
  const yyyy = targetDate.getUTCFullYear()
  const mm = String(targetDate.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(targetDate.getUTCDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}T${timePart}Z`
}

/**
 * Validate and normalize a single NASA PDS MSL-M-RAD-3-RDR-V1.0 observation record.
 * Rejects records with non-zero quality flags, missing/non-positive dosimetry values,
 * invalid timestamps, or truncated observation durations (< 120 s).
 */
export function parseRadRdrObservationRecord(
  input: RawPdsObservationInput,
): { ok: true; record: RadObservationRecord } | { ok: false; reason: string } {
  if (!input.productId || !input.productId.startsWith('RAD_RDR_')) {
    return { ok: false, reason: 'Invalid or missing RAD_RDR product identifier.' }
  }
  if (!Number.isInteger(input.sol) || input.sol < 0) {
    return { ok: false, reason: 'Invalid mission sol number.' }
  }
  if (input.qcFlag !== '00000000') {
    return { ok: false, reason: `Observation rejected due to non-nominal QC flag (${input.qcFlag}).` }
  }
  if (!Number.isFinite(input.obsDurationSeconds) || input.obsDurationSeconds < 120) {
    return { ok: false, reason: 'Observation duration is missing or shorter than minimum 120 s window.' }
  }
  const isoUtc = pdsDoyToIsoUtc(input.startObsUtc)
  if (!isoUtc) {
    return { ok: false, reason: `Unparseable START_OBS_UTC timestamp: ${input.startObsUtc}` }
  }
  const doseB = input.doseBMicroGyPerHour
  const doseE = input.doseEMicroGyPerHour
  if (
    doseB === null ||
    doseB === undefined ||
    doseE === null ||
    doseE === undefined ||
    !Number.isFinite(doseB) ||
    !Number.isFinite(doseE) ||
    doseB <= 0 ||
    doseE <= 0
  ) {
    return { ok: false, reason: 'Missing or non-positive detector B/E absorbed dose rate.' }
  }

  return {
    ok: true,
    record: {
      productId: input.productId,
      sol: input.sol,
      obsIndex: input.obsIndex,
      startUtc: isoUtc,
      startMarsLocal: input.startObsMars?.trim() || `${input.sol}`,
      durationSeconds: input.obsDurationSeconds,
      qcFlag: input.qcFlag,
      absorbedDoseRateSiliconMicroGyPerHour: Number(doseB.toFixed(4)),
      absorbedDoseRateTissuePlasticMicroGyPerHour: Number(doseE.toFixed(4)),
      units: 'microGray/hour (uGy/h)',
      measurementLocation: 'Gale Crater, Mars (4.59°S, 137.44°E, ~-4500 m MOLA)',
      dataStatus: 'MEASURED_GALE_RAD_RDR',
    },
  }
}

/**
 * Convert absorbed dose rates strictly within physical absorbed-dose units (Gray family).
 * Rejects any attempt to convert Gray (Gy) directly into Sievert (Sv) without a radiation
 * transport/quality factor model.
 */
export function convertAbsorbedDoseRate(
  value: number,
  fromUnit: string,
  toUnit: string,
): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error('Absorbed dose rate must be a non-negative finite number.')
  }
  if (/sv/i.test(fromUnit) || /sv/i.test(toUnit)) {
    throw new Error(
      'Direct unit conversion between Gray (Gy) and Sievert (Sv) is physically invalid. ' +
        'Absorbed dose (Gy) measures physical energy deposition; dose equivalent (Sv) requires ' +
        'an explicit LET-dependent radiation quality factor <Q>.',
    )
  }

  const toMicroGyPerHour: Record<AbsorbedDoseRateUnit, number> = {
    'uGy/h': 1,
    'mGy/h': 1_000,
    'Gy/h': 1_000_000,
    'uGy/day': 1 / 24,
  }

  const fromFactor = toMicroGyPerHour[fromUnit as AbsorbedDoseRateUnit]
  const toFactor = toMicroGyPerHour[toUnit as AbsorbedDoseRateUnit]
  if (fromFactor === undefined || toFactor === undefined) {
    throw new Error(`Unsupported absorbed dose rate unit conversion: ${fromUnit} -> ${toUnit}`)
  }

  const inMicroGyPerHour = value * fromFactor
  return inMicroGyPerHour / toFactor
}

/**
 * Compute informational dose equivalent (uSv) from physical absorbed dose (uGy)
 * ONLY when an explicit, peer-reviewed mean quality factor <Q> is supplied.
 */
export function computeInformationalDoseEquivalentMicroSv(
  absorbedDoseMicroGy: number,
  meanQualityFactorQ: number,
): number {
  if (!Number.isFinite(absorbedDoseMicroGy) || absorbedDoseMicroGy < 0) {
    throw new Error('Absorbed dose (uGy) must be a non-negative finite number.')
  }
  if (!Number.isFinite(meanQualityFactorQ) || meanQualityFactorQ < 1 || meanQualityFactorQ > 20) {
    throw new Error('Mean radiation quality factor <Q> must be within [1.0, 20.0].')
  }
  return Number((absorbedDoseMicroGy * meanQualityFactorQ).toFixed(2))
}

export function validateRadiationData(
  reference: RadiationReferenceData,
  scenarios: RadiationScenariosData,
  provenance: RadiationProvenanceData,
  shieldingGrid: ShieldingGrid,
  regionBounds: Bounds,
): void {
  if (reference.datasetId !== 'MSL-M-RAD-3-RDR-V1.0') {
    throw new Error(`radiation-reference.json: unexpected datasetId ${reference.datasetId}`)
  }
  if (!sameRasterBounds(reference.applicationSite.bounds, regionBounds, 1e-6)) {
    throw new Error('radiation-reference.json: applicationSite bounds do not match region bounds')
  }
  if (!reference.sep2017HighCadenceSeries.length || !reference.solarCycleReferenceSeries.length) {
    throw new Error('radiation-reference.json: historical RAD observation series are empty')
  }
  for (const rec of [...reference.sep2017HighCadenceSeries, ...reference.solarCycleReferenceSeries]) {
    if (rec.qcFlag !== '00000000') {
      throw new Error(`radiation-reference.json: invalid QC flag ${rec.qcFlag} in ${rec.productId}`)
    }
    if (
      rec.absorbedDoseRateSiliconMicroGyPerHour <= 0 ||
      rec.absorbedDoseRateTissuePlasticMicroGyPerHour <= 0
    ) {
      throw new Error(`radiation-reference.json: non-positive dose rate in ${rec.productId}`)
    }
  }
  if (!scenarios.scenarios || scenarios.scenarios.length < 2) {
    throw new Error('radiation-scenarios.json: expected at least 2 radiation scenarios')
  }
  if (!provenance.sources || provenance.sources.length === 0) {
    throw new Error('radiation-provenance.json: missing provenance sources')
  }
  const expectedLen = rasterCellCount('shielding-grid.json', shieldingGrid, regionBounds, 1e-6)
  if (
    !Array.isArray(shieldingGrid.skyVisibilityValues) ||
    !Array.isArray(shieldingGrid.meanHorizonDegValues) ||
    shieldingGrid.skyVisibilityValues.length !== expectedLen ||
    shieldingGrid.meanHorizonDegValues.length !== expectedLen
  ) {
    throw new Error('shielding-grid.json: value array length does not match width * height')
  }
}

export function sampleShieldingAt(
  grid: ShieldingGrid | null | undefined,
  lon: number,
  lat: number,
): PointShieldingSample {
  if (!grid) {
    return {
      skyVisibilityFraction: null,
      meanHorizonObstructionDeg: null,
      experimentalShieldingProxy: null,
    }
  }
  const [minLon, minLat, maxLon, maxLat] = grid.bounds
  if (lon < minLon || lon > maxLon || lat < minLat || lat > maxLat) {
    return {
      skyVisibilityFraction: null,
      meanHorizonObstructionDeg: null,
      experimentalShieldingProxy: null,
    }
  }
  const col = Math.min(
    grid.width - 1,
    Math.max(0, Math.floor(((lon - minLon) / (maxLon - minLon)) * grid.width)),
  )
  const row = Math.min(
    grid.height - 1,
    Math.max(0, Math.floor(((maxLat - lat) / (maxLat - minLat)) * grid.height)),
  )
  const idx = row * grid.width + col
  const sky = grid.skyVisibilityValues[idx]
  const hor = grid.meanHorizonDegValues[idx]
  if (sky === undefined || sky === grid.noData || sky < 0 || hor === undefined || hor === grid.noData) {
    return {
      skyVisibilityFraction: null,
      meanHorizonObstructionDeg: null,
      experimentalShieldingProxy: null,
    }
  }
  const proxy = Math.min(1, Math.max(0, (1 - sky) / 0.35))
  return {
    skyVisibilityFraction: Number(sky.toFixed(4)),
    meanHorizonObstructionDeg: Number(hor.toFixed(2)),
    experimentalShieldingProxy: Number(proxy.toFixed(3)),
  }
}

export function assessRouteTopographicShielding(
  grid: ShieldingGrid | null | undefined,
  samples: Array<LonLat & { distanceKm?: number }>,
): RouteShieldingAssessment {
  const caveats = [
    'Sky visibility fraction (Omega_sky / 2pi) is a geometric horizon metric and does NOT equal percentage radiation dose reduction.',
    'Optical/solar shadowing is distinct from cosmic-ray shielding; high-energy GCR ions penetrate rock scarps and generate secondary neutrons in regolith.',
    'Computed within the local 10 km x 10 km Mars 2020 DEM footprint; distant crater rim topography outside the DEM bounds is excluded.',
  ]

  if (!grid || samples.length === 0) {
    return {
      meanSkyVisibilityFraction: null,
      minSkyVisibilityFraction: null,
      meanHorizonObstructionDeg: null,
      maxHorizonObstructionDeg: null,
      meanExperimentalShieldingProxy: null,
      knownSampleFraction: 0,
      bestShelterCandidate: null,
      claimedDoseReductionPercent: null,
      statusLabel: 'Terrain Shielding Potential — Experimental',
      caveats,
    }
  }

  let sumSky = 0
  let minSky = Infinity
  let sumHor = 0
  let maxHor = -Infinity
  let sumProxy = 0
  let validCount = 0
  let bestCandidate: RouteShieldingAssessment['bestShelterCandidate'] = null

  for (const pt of samples) {
    const s = sampleShieldingAt(grid, pt.lon, pt.lat)
    if (
      s.skyVisibilityFraction === null ||
      s.meanHorizonObstructionDeg === null ||
      s.experimentalShieldingProxy === null
    ) {
      continue
    }
    validCount += 1
    sumSky += s.skyVisibilityFraction
    sumHor += s.meanHorizonObstructionDeg
    sumProxy += s.experimentalShieldingProxy
    if (s.skyVisibilityFraction < minSky) minSky = s.skyVisibilityFraction
    if (s.meanHorizonObstructionDeg > maxHor) {
      maxHor = s.meanHorizonObstructionDeg
      bestCandidate = {
        lon: pt.lon,
        lat: pt.lat,
        distanceKm: Number((pt.distanceKm ?? 0).toFixed(2)),
        skyVisibilityFraction: s.skyVisibilityFraction,
        horizonObstructionDeg: s.meanHorizonObstructionDeg,
      }
    }
  }

  if (validCount === 0) {
    return {
      meanSkyVisibilityFraction: null,
      minSkyVisibilityFraction: null,
      meanHorizonObstructionDeg: null,
      maxHorizonObstructionDeg: null,
      meanExperimentalShieldingProxy: null,
      knownSampleFraction: 0,
      bestShelterCandidate: null,
      claimedDoseReductionPercent: null,
      statusLabel: 'Terrain Shielding Potential — Experimental',
      caveats,
    }
  }

  return {
    meanSkyVisibilityFraction: Number((sumSky / validCount).toFixed(4)),
    minSkyVisibilityFraction: Number(minSky.toFixed(4)),
    meanHorizonObstructionDeg: Number((sumHor / validCount).toFixed(2)),
    maxHorizonObstructionDeg: Number(maxHor.toFixed(2)),
    meanExperimentalShieldingProxy: Number((sumProxy / validCount).toFixed(3)),
    knownSampleFraction: Number((validCount / samples.length).toFixed(3)),
    bestShelterCandidate: bestCandidate,
    claimedDoseReductionPercent: null,
    statusLabel: 'Terrain Shielding Potential — Experimental',
    caveats,
  }
}

export function resolveComponentDoseRate(
  scenario: RadiationScenario,
  component: RadiationComponentId,
): { doseRateMicroGyPerHour: number; componentLabel: string; effectiveQ: number } {
  if (component === 'gcr_only') {
    return {
      doseRateMicroGyPerHour: scenario.gcrComponentMicroGyPerHour,
      componentLabel: 'Galactic Cosmic Rays (GCR Baseline Only)',
      effectiveQ: 3.05,
    }
  }
  if (component === 'sep_only') {
    return {
      doseRateMicroGyPerHour: scenario.sepComponentMicroGyPerHour,
      componentLabel: 'Solar Energetic Particle Surge (SEP Excess Only)',
      effectiveQ: 1.45,
    }
  }
  return {
    doseRateMicroGyPerHour: scenario.absorbedDoseRateMicroGyPerHour,
    componentLabel: 'Total Ionizing Field (GCR + SEP)',
    effectiveQ: scenario.publishedMeanQualityFactorQ,
  }
}

export function radiationExposureTiming(budget: ReturnBudget) {
  const outboundWalkHours = Math.max(0, budget.outboundHours)
  const returnWalkHours = Math.max(0, budget.returnHours)
  const targetStayHours = Math.max(0, budget.targetStayMinutes / 60)
  const scienceStopHours = Math.max(0, budget.scienceStopMinutes / 60) + targetStayHours
  const totalExposureHours = outboundWalkHours + scienceStopHours + returnWalkHours
  return { outboundWalkHours, returnWalkHours, targetStayHours, scienceStopHours, totalExposureHours }
}

export function computeEvaRadiationExposure({
  terrain,
  budget,
  scenario,
  component = 'total',
  shieldingGrid = null,
}: {
  terrain: RouteTerrain
  budget: ReturnBudget
  scenario: RadiationScenario | null | undefined
  component?: RadiationComponentId
  shieldingGrid?: ShieldingGrid | null
}): EvaRadiationAssessment {
  const shielding = assessRouteTopographicShielding(shieldingGrid, terrain.samples)
  const {
    doseRateMicroGyPerHour,
    componentLabel,
    effectiveQ,
  } = scenario
    ? resolveComponentDoseRate(scenario, component)
    : {
        doseRateMicroGyPerHour: 0,
        componentLabel: 'Unknown radiation component',
        effectiveQ: 3.05,
      }

  const hasValidRoute = terrain.samples.length >= 2 && terrain.totalKm >= MIN_TRAVERSE_KM
  const hasValidScenario = Boolean(
    scenario &&
      Number.isFinite(scenario.absorbedDoseRateMicroGyPerHour) &&
      scenario.absorbedDoseRateMicroGyPerHour > 0,
  )

  if (!hasValidRoute || !hasValidScenario || !scenario) {
    return {
      status: 'INSUFFICIENT_DATA',
      estimateLabel: 'Environmental Radiation Exposure Estimate (Unshielded Surface Reference)',
      measurementVsModelLabel: 'Gale Crater RAD Reference -> Jezero Environmental Estimate',
      verdictImpact: 'ADVISORY_ONLY_NO_AUTOMATIC_GO_NOGO',
      scenarioId: scenario?.id ?? 'background_gcr',
      scenarioLabel: scenario?.label ?? 'Unavailable Radiation Scenario',
      component,
      componentLabel,
      radiationSource: scenario?.radiationSource ?? 'Unknown',
      referenceOrigin: scenario?.referenceOrigin ?? 'NASA PDS MSL-M-RAD-3-RDR-V1.0',
      referenceDateRange: scenario?.referenceDateRange ?? 'N/A',
      referenceDoseRateMicroGyPerHour: hasValidScenario && scenario ? doseRateMicroGyPerHour : 0,
      siliconDoseRateMicroGyPerHour: scenario?.siliconAbsorbedDoseRateMicroGyPerHour ?? 0,
      gcrDoseRateMicroGyPerHour: scenario?.gcrComponentMicroGyPerHour ?? 0,
      sepDoseRateMicroGyPerHour: scenario?.sepComponentMicroGyPerHour ?? 0,
      outboundWalkHours: 0,
      scienceStopHours: 0,
      targetStayHours: 0,
      returnWalkHours: 0,
      totalExposureHours: 0,
      estimatedRouteExposureMicroGy: 0,
      outboundWalkExposureMicroGy: 0,
      scienceStopExposureMicroGy: 0,
      returnExposureMicroGy: 0,
      totalModeledExposureMicroGy: 0,
      uncertaintyPercent: scenario?.uncertaintyPercent ?? 22,
      uncertaintyRangeMicroGy: [0, 0],
      publishedQualityFactorQ: effectiveQ,
      informationalDoseEquivalentMicroSv: 0,
      topographicShielding: shielding,
      shelterAdvisory:
        'Place at least two route points on the map with valid radiation reference data to compute mission exposure.',
      limitations: scenario?.limitations ?? [
        'Radiation reference data or route geometry is incomplete.',
      ],
    }
  }

  const { outboundWalkHours, scienceStopHours, returnWalkHours, targetStayHours, totalExposureHours } =
    radiationExposureTiming(budget)

  // Absorbed Dose = Absorbed Dose Rate * Exposure Time (in microGray)
  const outboundWalkExposureMicroGy = Number((doseRateMicroGyPerHour * outboundWalkHours).toFixed(2))
  const scienceStopExposureMicroGy = Number((doseRateMicroGyPerHour * scienceStopHours).toFixed(2))
  const estimatedRouteExposureMicroGy = Number(
    (outboundWalkExposureMicroGy + scienceStopExposureMicroGy).toFixed(2),
  )
  const returnExposureMicroGy = Number((doseRateMicroGyPerHour * returnWalkHours).toFixed(2))
  const totalModeledExposureMicroGy = Number((doseRateMicroGyPerHour * totalExposureHours).toFixed(2))

  const uncFrac = scenario.uncertaintyPercent / 100
  const minDose = Number((totalModeledExposureMicroGy * Math.max(0, 1 - uncFrac)).toFixed(2))
  const maxDose = Number((totalModeledExposureMicroGy * (1 + uncFrac)).toFixed(2))

  const informationalDoseEquivalentMicroSv = computeInformationalDoseEquivalentMicroSv(
    totalModeledExposureMicroGy,
    effectiveQ,
  )

  return {
    status: 'OK',
    estimateLabel: 'Environmental Radiation Exposure Estimate (Unshielded Surface Reference)',
    measurementVsModelLabel:
      scenario.id === 'sep_sep2017'
        ? 'Historical SEP Event Reference -> Jezero Environmental Estimate'
        : 'Gale Crater RAD Reference -> Jezero Environmental Estimate',
    verdictImpact: 'ADVISORY_ONLY_NO_AUTOMATIC_GO_NOGO',
    scenarioId: scenario.id,
    scenarioLabel: scenario.label,
    component,
    componentLabel,
    radiationSource: scenario.radiationSource,
    referenceOrigin: scenario.referenceOrigin,
    referenceDateRange: scenario.referenceDateRange,
    referenceDoseRateMicroGyPerHour: Number(doseRateMicroGyPerHour.toFixed(3)),
    siliconDoseRateMicroGyPerHour: scenario.siliconAbsorbedDoseRateMicroGyPerHour,
    gcrDoseRateMicroGyPerHour: scenario.gcrComponentMicroGyPerHour,
    sepDoseRateMicroGyPerHour: scenario.sepComponentMicroGyPerHour,
    outboundWalkHours: Number(outboundWalkHours.toFixed(2)),
    scienceStopHours: Number(scienceStopHours.toFixed(2)),
    targetStayHours: Number(targetStayHours.toFixed(2)),
    returnWalkHours: Number(returnWalkHours.toFixed(2)),
    totalExposureHours: Number(totalExposureHours.toFixed(2)),
    estimatedRouteExposureMicroGy,
    outboundWalkExposureMicroGy,
    scienceStopExposureMicroGy,
    returnExposureMicroGy,
    totalModeledExposureMicroGy,
    uncertaintyPercent: scenario.uncertaintyPercent,
    uncertaintyRangeMicroGy: [minDose, maxDose],
    publishedQualityFactorQ: effectiveQ,
    informationalDoseEquivalentMicroSv,
    topographicShielding: shielding,
    shelterAdvisory: scenario.shelterAdvisory,
    limitations: scenario.limitations,
  }
}

/**
 * Compare candidate routes under the same regional radiation scenario.
 * Explicitly attributes lower total exposure to shorter EVA duration rather than
 * claiming unverified spatial radiation differences across Jezero.
 */
export function compareRoutesRadiation(
  routes: Array<{
    routeId: string
    routeLabel: string
    assessment: EvaRadiationAssessment
  }>,
): RouteRadiationComparisonItem[] {
  if (routes.length === 0) return []
  const minHours = Math.min(...routes.map((r) => r.assessment.totalExposureHours))
  const minDose = Math.min(...routes.map((r) => r.assessment.totalModeledExposureMicroGy))

  return routes.map(({ routeId, routeLabel, assessment }) => {
    const diffHours = Number((assessment.totalExposureHours - minHours).toFixed(2))
    const diffDose = Number((assessment.totalModeledExposureMicroGy - minDose).toFixed(2))
    const basisNote =
      diffHours <= 0.01
        ? 'Lowest cumulative exposure is driven by shorter total EVA duration under the shared regional dose rate (not by spatial dose rate differences).'
        : `+${diffDose.toFixed(1)} uGy (+${diffHours.toFixed(2)} h) relative to fastest traverse due to longer exposure duration in the same regional radiation environment.`

    return {
      routeId,
      routeLabel,
      totalHours: assessment.totalExposureHours,
      totalExposureMicroGy: assessment.totalModeledExposureMicroGy,
      uncertaintyRangeMicroGy: assessment.uncertaintyRangeMicroGy,
      differenceFromShortestHours: diffHours,
      differenceFromLowestExposureMicroGy: diffDose,
      comparisonBasisNote: basisNote,
    }
  })
}
