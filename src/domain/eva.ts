import type { EvaFactor, EvaResult, LonLat, MissionTarget, Waypoint } from '@/types'
import type { RouteTerrain } from './dem'
import { haversineKm } from './geo'

export const EVA_CONFIG = {
  timeLimitHours: 6,
  walkSpeedKmH: 1.5,
  sampleStopMinutes: 20,
  slopeCautionDeg: 15,
  slopeNoGoDeg: 25,
  thermalInertiaHighPercentile: 80,
  weights: { safety: 0.6, science: 0.4 },
}

export interface EvaInput {
  terrain: RouteTerrain
  routeWaypoints: Waypoint[]
  target?: MissionTarget | LonLat | null
  thermalPercentile80: number
  config?: typeof EVA_CONFIG
}

export function computeEva({
  terrain,
  routeWaypoints,
  target,
  thermalPercentile80,
  config = EVA_CONFIG,
}: EvaInput): EvaResult {
  const stops = routeWaypoints.filter((w) => w.kind === 'science' || w.kind === 'pov')
  const durationHours =
    terrain.totalKm / config.walkSpeedKmH + (stops.length * config.sampleStopMinutes) / 60
  const maxSlope = terrain.maxSlopeDeg
  const highThermal = routeWaypoints.filter(
    (w) => w.thermalInertia !== undefined && w.thermalInertia > thermalPercentile80,
  ).length
  const hazardCount = terrain.hazardSegments.length + highThermal

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
  const thermalPenalty = Math.min(16, highThermal * 8)
  const safetyScore = Math.round(
    Math.min(100, Math.max(0, 100 - slopePenalty - durationPenalty - coveragePenalty - thermalPenalty)),
  )

  const uniqueMinerals = new Set(routeWaypoints.flatMap((w) => w.minerals))
  const mineralPoints = Math.min(36, uniqueMinerals.size * 12)
  const stopPoints = Math.min(30, stops.length * 10)
  const targetDistance = target && routeWaypoints.length ? haversineKm(routeWaypoints[0], target) : null
  const proximityPoints =
    targetDistance === null ? 0 : Math.max(0, Math.min(30, 30 * (1 - targetDistance / 5)))
  const scienceScore = Math.round(Math.min(100, mineralPoints + stopPoints + proximityPoints))
  const compositeScore = Math.round(
    config.weights.safety * safetyScore + config.weights.science * scienceScore,
  )

  const zeroLength = terrain.totalKm < 0.01
  const unknownFailure = terrain.unknownFraction > 0.05
  const hardNoGo =
    zeroLength ||
    maxSlope >= config.slopeNoGoDeg ||
    unknownFailure ||
    durationHours > config.timeLimitHours * 1.2
  const canBeGo =
    !hardNoGo && safetyScore >= 70 && durationHours <= config.timeLimitHours && maxSlope <= config.slopeCautionDeg

  const verdict = unknownFailure
    ? 'INSUFFICIENT DATA'
    : canBeGo
      ? 'GO'
      : hardNoGo || safetyScore < 40
        ? 'NO-GO'
        : 'CAUTION'
  const verdictReason = canBeGo
    ? 'Route stays inside the walk, slope and terrain-confidence gates.'
    : hardNoGo
      ? zeroLength
        ? 'Route has no measurable length; place two distinct points.'
        : maxSlope >= config.slopeNoGoDeg
        ? `Maximum slope ${maxSlope.toFixed(1)}° reaches the ${config.slopeNoGoDeg}° no-go gate.`
        : unknownFailure
          ? `${Math.round(terrain.unknownFraction * 100)}% of the route crosses terrain with no DEM coverage.`
          : `Duration ${durationHours.toFixed(1)} h exceeds 1.2× the ${config.timeLimitHours} h budget.`
      : safetyScore < 40
        ? 'Safety penalties push the route below the 40 point floor.'
        : maxSlope > config.slopeCautionDeg
          ? `Maximum slope ${maxSlope.toFixed(1)}° is above the ${config.slopeCautionDeg}° caution threshold.`
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
      value: `${highThermal} high-${config.thermalInertiaHighPercentile}th site${highThermal === 1 ? '' : 's'}`,
      penalty: Math.round(thermalPenalty),
      reason: `Waypoints above ${Math.round(thermalPercentile80)} SI trigger the rocky-terrain assumption.`,
    },
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
