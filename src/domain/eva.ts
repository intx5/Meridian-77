import type {
  EvaFactor,
  EvaResult,
  LonLat,
  MissionTarget,
  RadiationScenarioId,
  RasterGrid,
  ReturnBudget,
  RouteSandAssessment,
  Waypoint,
} from '@/types'
import { type RouteTerrain, sampleElevation } from './dem'
import { haversineKm } from './geo'
import { radiationExposureTiming } from './radiation'
import { MIN_TRAVERSE_KM, SCIENCE_STOP_MINUTES } from '@/config/eva'

export const EVA_CONFIG = {
  timeLimitHours: 6,
  walkSpeedKmH: 1.5,
  sampleStopMinutes: SCIENCE_STOP_MINUTES,
  slopeCautionDeg: 15,
  slopeNoGoDeg: 25,
  thermalInertiaHighPercentile: 80,
  weights: { safety: 0.6, science: 0.4 },
}

export interface EvaRadiationInput {
  scenarioId: RadiationScenarioId
  doseRateMicroGyPerHour: number
  totalExposureMicroGy?: number
  budget?: ReturnBudget
  meanSkyVisibilityFraction?: number | null
}

export interface EvaInput {
  terrain: RouteTerrain
  routeWaypoints: Waypoint[]
  target?: MissionTarget | LonLat | null
  thermalPercentile80: number
  thermalGrid?: RasterGrid | null
  mineralogyGrid?: RasterGrid | null
  sand?: RouteSandAssessment | null
  duneNoGoAssumption?: boolean
  radiation?: EvaRadiationInput | null
  requireTargetArrival?: boolean
  config?: typeof EVA_CONFIG
}

function visitedRouteWaypoints(terrain: RouteTerrain, waypoints: Waypoint[]): Waypoint[] {
  return waypoints.filter((waypoint) => terrain.samples.some((sample) => haversineKm(sample, waypoint) <= 0.25))
}

function isScienceStop(waypoint: Waypoint): boolean {
  return waypoint.kind === 'science' || waypoint.kind === 'pov'
}

export function intermediateScienceStopMinutes(terrain: RouteTerrain, waypoints: Waypoint[]): number {
  const endpoint = terrain.samples.at(-1)
  if (!endpoint || terrain.totalKm < MIN_TRAVERSE_KM) return 0
  const stops = visitedRouteWaypoints(terrain, waypoints).filter(
    (waypoint) => isScienceStop(waypoint) && haversineKm(endpoint, waypoint) > 0.001,
  )
  return stops.length * SCIENCE_STOP_MINUTES
}

export function computeEva({
  terrain,
  routeWaypoints,
  target,
  thermalPercentile80,
  thermalGrid = null,
  mineralogyGrid = null,
  sand = null,
  duneNoGoAssumption = false,
  radiation = null,
  requireTargetArrival = false,
  config = EVA_CONFIG,
}: EvaInput): EvaResult {
  const visitedWaypoints =
    terrain.samples.length >= 2
      ? visitedRouteWaypoints(terrain, routeWaypoints)
      : routeWaypoints

  const stops = visitedWaypoints.filter(isScienceStop)
  const durationHours =
    terrain.totalKm / config.walkSpeedKmH + (stops.length * config.sampleStopMinutes) / 60
  const maxSlope = terrain.maxSlopeDeg
  const highThermalWaypoints = visitedWaypoints.filter(
    (w) => w.thermalInertia !== undefined && w.thermalInertia > thermalPercentile80,
  ).length

  // Sample continuous THEMIS thermal inertia along the route when thermalGrid is provided
  let sampledThermalCount = 0
  let highThermalSamples = 0
  let lowDustThermalSamples = 0
  let sumThermal = 0
  let maxSampledThermal = 0
  if (thermalGrid && terrain.samples.length > 0) {
    for (const s of terrain.samples) {
      const val = sampleElevation(thermalGrid, s.lon, s.lat)
      if (val !== null && val > 0) {
        sampledThermalCount += 1
        sumThermal += val
        if (val > maxSampledThermal) maxSampledThermal = val
        if (val > thermalPercentile80) highThermalSamples += 1
        if (val < 185) lowDustThermalSamples += 1
      }
    }
  }
  const highThermalFraction = sampledThermalCount > 0 ? highThermalSamples / sampledThermalCount : 0
  const lowDustThermalFraction = sampledThermalCount > 0 ? lowDustThermalSamples / sampledThermalCount : 0
  const meanThermal = sampledThermalCount > 0 ? sumThermal / sampledThermalCount : null
  const thermalHazardSegments =
    sampledThermalCount > 0 ? Math.ceil(highThermalFraction * 4) : 0

  const sandHazards = sand ? sand.hazardSegments.filter((s) => s.kind === 'dune_field').length : 0
  const hazardCount =
    terrain.hazardSegments.length + highThermalWaypoints + thermalHazardSegments + sandHazards

  const slopePenalty =
    maxSlope > config.slopeCautionDeg
      ? Math.min(
          45,
          ((maxSlope - config.slopeCautionDeg) /
            (config.slopeNoGoDeg - config.slopeCautionDeg)) *
            45,
        )
      : 0
  const durationPenalty =
    durationHours > config.timeLimitHours
      ? Math.min(30, ((durationHours - config.timeLimitHours) / config.timeLimitHours) * 30)
      : 0
  const coveragePenalty = Math.min(35, terrain.unknownFraction * 100 * 0.8)

  const thermalPenalty =
    sampledThermalCount > 0
      ? Math.min(
          20,
          highThermalWaypoints * 6 +
            highThermalFraction * 24 +
            lowDustThermalFraction * 16 +
            (meanThermal !== null && meanThermal > 310 ? (meanThermal - 310) / 10 : 0),
        )
      : Math.min(16, highThermalWaypoints * 8)

  const sandPenalty = sand
    ? Math.min(
        26,
        sand.duneFraction * 75 +
          sand.sandSheetFraction * 32 +
          sand.uncertainFraction * 18 +
          (sand.duneKm > 0 ? 4 : 0),
      )
    : 0

  // Regional exposure and geometric sky visibility are advisory model outputs.
  const estimatedRoundTripDoseMicroGy = radiation
    ? radiation.totalExposureMicroGy ?? radiation.doseRateMicroGyPerHour * (
      radiation.budget
        ? radiationExposureTiming(radiation.budget).totalExposureHours
        : Math.max(durationHours * 2, 0.5)
    )
    : 0
  const skyVis = radiation?.meanSkyVisibilityFraction ?? 0.94

  const safetyScore = Math.round(
    Math.min(
      100,
      Math.max(
        0,
        100 -
          slopePenalty -
          durationPenalty -
          coveragePenalty -
          thermalPenalty -
          sandPenalty,
      ),
    ),
  )

  const endSample = terrain.samples.length >= 2 ? terrain.samples.at(-1)! : null
  const targetReached =
    !target
      ? true
      : endSample
        ? haversineKm(endSample, target) <= 0.25
        : visitedWaypoints.some((w) => haversineKm(w, target) <= 0.25)

  const uniqueMinerals = new Set(visitedWaypoints.flatMap((w) => w.minerals))
  if (mineralogyGrid && terrain.samples.length > 0 && (!requireTargetArrival || targetReached)) {
    let weakCrismCount = 0
    let strongCrismCount = 0
    for (const s of terrain.samples) {
      const bd = sampleElevation(mineralogyGrid, s.lon, s.lat)
      if (bd !== null && bd >= 0.01) {
        weakCrismCount += 1
        if (bd >= 0.02) strongCrismCount += 1
      }
    }
    if (weakCrismCount > 0) uniqueMinerals.add('Fe/Mg phyllosilicates (CRISM 2.30 µm)')
    if (strongCrismCount > 0) uniqueMinerals.add('Al/Mg smectite clay (strong CRISM ≥0.020)')
  }

  const mineralPoints = Math.min(36, uniqueMinerals.size * 12)
  const stopPoints = Math.min(30, stops.length * 10)

  const targetDistance =
    target && visitedWaypoints.length
      ? Math.min(...visitedWaypoints.map((w) => haversineKm(w, target)))
      : null
  const proximityPoints =
    targetDistance === null || (requireTargetArrival && !targetReached)
      ? 0
      : Math.max(0, Math.min(30, 30 * (1 - targetDistance / 5)))
  const scienceScore = Math.round(Math.min(100, mineralPoints + stopPoints + proximityPoints))
  const compositeScore = Math.round(
    config.weights.safety * safetyScore + config.weights.science * scienceScore,
  )

  const zeroLength = terrain.totalKm < MIN_TRAVERSE_KM
  const unknownFailure = terrain.unknownFraction > 0.05
  const duneNoGoFailure = Boolean(
    (duneNoGoAssumption && sand && sand.duneFraction > 0.005) ||
      (sand && sand.duneFraction >= 0.35),
  )
  const thermalNoGoFailure = Boolean(sampledThermalCount > 0 && highThermalFraction >= 0.72 && maxSampledThermal >= 415)
  const targetUnreachedFailure = Boolean(requireTargetArrival && target && !targetReached)

  const sandCaution = Boolean(sand && (sand.duneKm > 0 || sand.duneFraction > 0.01 || sand.totalSandFraction >= 0.05))
  const thermalCaution = Boolean(
    (sampledThermalCount > 0 && (highThermalFraction >= 0.22 || lowDustThermalFraction >= 0.28 || maxSampledThermal >= 385)) ||
      highThermalWaypoints >= 2,
  )

  const hardNoGo =
    zeroLength ||
    maxSlope >= config.slopeNoGoDeg ||
    unknownFailure ||
    duneNoGoFailure ||
    thermalNoGoFailure ||
    targetUnreachedFailure ||
    durationHours > config.timeLimitHours * 1.2
  const canBeGo =
    !hardNoGo &&
    !sandCaution &&
    !thermalCaution &&
    safetyScore >= 70 &&
    durationHours <= config.timeLimitHours &&
    maxSlope <= config.slopeCautionDeg

  const verdict = unknownFailure
    ? 'INSUFFICIENT DATA'
    : canBeGo
      ? 'GO'
      : hardNoGo || safetyScore < 40
        ? 'NO-GO'
        : 'CAUTION'
  const verdictReason = canBeGo
    ? 'Route stays inside slope, sand/dune, thermal inertia, and walk-time safety gates.'
    : hardNoGo
      ? zeroLength
        ? 'Route has no measurable length; place two distinct points.'
        : maxSlope >= config.slopeNoGoDeg
          ? `Maximum slope ${maxSlope.toFixed(1)}° reaches the ${config.slopeNoGoDeg}° no-go gate.`
          : unknownFailure
            ? `${Math.round(terrain.unknownFraction * 100)}% of the route crosses terrain with no DEM coverage.`
            : duneNoGoFailure
              ? `Route crosses ${sand!.duneKm.toFixed(2)} km of active dune fields (${Math.round(sand!.duneFraction * 100)}% of traverse).`
              : thermalNoGoFailure
                ? `Extreme rocky thermal inertia (${Math.round(maxSampledThermal)} SI across ${Math.round(highThermalFraction * 100)}% of route) exceeds safe traverse limits.`
                : targetUnreachedFailure
                  ? 'Route does not reach the selected mission target.'
                  : `Duration ${durationHours.toFixed(1)} h exceeds 1.2× the ${config.timeLimitHours} h budget.`
      : safetyScore < 40
        ? 'Combined terrain and duration penalties push the safety score below the 40 point floor.'
        : maxSlope > config.slopeCautionDeg
          ? `Maximum slope ${maxSlope.toFixed(1)}° is above the ${config.slopeCautionDeg}° caution threshold.`
          : sandCaution
            ? `Route crosses ${(sand!.totalSandFraction * 100).toFixed(0)}% detected sand/dune terrain (${sand!.duneKm.toFixed(2)} km dunes); traction caution.`
            : thermalCaution
              ? `Thermal inertia hazard along traverse (${meanThermal !== null ? `mean ${Math.round(meanThermal)} SI, ` : ''}${Math.round(highThermalFraction * 100)}% rocky >${Math.round(thermalPercentile80)} SI).`
              : 'Route is feasible only with reduced objectives or additional review.'

  const breakdown: EvaFactor[] = [
    {
      factor: 'slope',
      value: `${maxSlope.toFixed(1)}° max`,
      penalty: Math.round(slopePenalty),
      reason: slopePenalty
        ? `Above the ${config.slopeCautionDeg}° assumption; ${config.slopeNoGoDeg}° is the no-go gate.`
        : `Within the ${config.slopeCautionDeg}° assumption.`,
    },
    {
      factor: 'duration',
      value: `${durationHours.toFixed(1)} h`,
      penalty: Math.round(durationPenalty),
      reason: `${terrain.totalKm.toFixed(2)} km walk at ${config.walkSpeedKmH} km/h plus ${stops.length} science stops.`,
    },
    {
      factor: 'terrain coverage',
      value: `${Math.round((1 - terrain.unknownFraction) * 100)}% known`,
      penalty: Math.round(coveragePenalty),
      reason: terrain.unknownFraction
        ? 'No-data DEM cells are treated as unknown, never as flat ground.'
        : 'Every sampled point has elevation coverage.',
    },
    {
      factor: 'thermal inertia',
      value:
        sampledThermalCount > 0 && meanThermal !== null
          ? `${Math.round(meanThermal)} SI (${Math.round(highThermalFraction * 100)}% >${Math.round(thermalPercentile80)})`
          : `${highThermalWaypoints} high-${config.thermalInertiaHighPercentile}th site${highThermalWaypoints === 1 ? '' : 's'}`,
      penalty: Math.round(thermalPenalty),
      reason:
        sampledThermalCount > 0
          ? `Sampled THEMIS thermal inertia along route (max ${Math.round(maxSampledThermal)} SI); >${Math.round(thermalPercentile80)} SI marks rocky block fields and <185 SI marks loose dust.`
          : `Waypoints above ${Math.round(thermalPercentile80)} SI trigger the rocky-terrain assumption.`,
    },
    ...(sand
      ? [
          {
            factor: 'sand & dune exposure',
            value: `${Math.round(sand.totalSandFraction * 100)}% (${(sand.duneKm + sand.sandSheetKm).toFixed(2)} km)`,
            penalty: Math.round(sandPenalty),
            reason: duneNoGoFailure
              ? 'Active dune no-go rule or dense dune trap prohibits crossing mapped dune fields.'
              : sand.totalSandFraction > 0
                ? `${sand.duneKm.toFixed(2)} km dunes, ${sand.sandSheetKm.toFixed(2)} km sand sheets penalise traction safety.`
                : 'Route avoids mapped aeolian dune fields and ripple sheets.',
          },
        ]
      : []),
    ...(radiation
      ? [
          {
            factor: 'radiation exposure',
            value: `${estimatedRoundTripDoseMicroGy.toFixed(1)} µGy (${radiation.doseRateMicroGyPerHour.toFixed(1)} µGy/h)`,
            penalty: 0,
            reason:
              radiation.scenarioId === 'sep_sep2017'
                ? `Advisory estimate for the Sep 2017 SEP scenario (mean sky visibility ${(skyVis * 100).toFixed(1)}%).`
                : `Advisory GCR estimate for the traverse (mean sky visibility ${(skyVis * 100).toFixed(1)}%).`,
          },
        ]
      : []),
    {
      factor: 'mineral diversity',
      value: `${uniqueMinerals.size} class${uniqueMinerals.size === 1 ? '' : 'es'}`,
      penalty: -Math.round(mineralPoints),
      reason: [...uniqueMinerals].join(', ') || 'No mineral indicator is associated with this route.',
    },
    {
      factor: 'science stops',
      value: `${stops.length}`,
      penalty: -Math.round(stopPoints),
      reason: 'Science and POV waypoints on the route add sampling value and time cost.',
    },
    {
      factor: 'target proximity',
      value: targetDistance === null ? 'no target' : `${targetDistance.toFixed(2)} km`,
      penalty: -Math.round(proximityPoints),
      reason: target ? 'Closer first waypoints earn more of the 30 proximity points.' : 'No science target selected.',
    },
  ]

  return {
    distanceKm: terrain.totalKm,
    durationHours,
    stopCount: stops.length,
    maxSlopeDeg: maxSlope,
    meanSlopeDeg: terrain.meanSlopeDeg,
    elevationGainM: terrain.elevationGainM,
    elevationLossM: terrain.elevationLossM,
    hazardCount,
    unknownFraction: terrain.unknownFraction,
    safetyScore,
    scienceScore,
    compositeScore,
    verdict,
    verdictReason,
    breakdown,
  }
}
