import type { Verdict } from '@/types'

export interface RiskWeights {
  slope: number
  sand: number
  rock: number
  uncertainty: number
}

export const RISK_WEIGHT_BOUNDS: Record<keyof RiskWeights, { min: number; max: number }> = {
  slope: { min: 0.05, max: 0.75 },
  sand: { min: 0.05, max: 0.7 },
  rock: { min: 0.05, max: 0.7 },
  uncertainty: { min: 0.05, max: 0.7 },
}

export const DEFAULT_LOW_RISK_WEIGHTS: RiskWeights = {
  slope: 0.35,
  sand: 0.25,
  rock: 0.2,
  uncertainty: 0.2,
}

export type CandidateRouteId = 'route_a' | 'route_b' | 'route_c'

export type AiModelId = 'jezero-ml'

export const ALLOWED_AI_MODELS: readonly AiModelId[] = ['jezero-ml']

export interface CandidateRouteMetrics {
  id: CandidateRouteId
  label: string
  distanceKm: number
  roundTripKm: number
  oneWayHours: number
  roundTripHours: number
  marginHours: number
  elevationGainM: number
  elevationLossM: number
  maxSlopeDeg: number
  meanSlopeDeg: number
  steepSegmentCount15Deg: number
  unknownDemFraction: number
  sandKm: number
  duneKm: number
  sandSheetKm: number
  rockHazardCount: number
  highThermalFraction: number
  riskCost: number
  safetyScore?: number
  searchWeights?: RiskWeights
  scienceStopCount: number
  visitedStationIds: string[]
  targetReached: boolean
  verdict: Verdict
}

export interface AiStationSummary {
  id: string
  name: string
  lon: number
  lat: number
  kind: string
  minerals: string[]
}

export interface AiPlanRequest {
  model?: AiModelId
  mission: {
    start: { lon: number; lat: number; label: string }
    target: { id: string; name: string; lon: number; lat: number; summary: string }
    timeLimitHours: number
    targetStayMinutes: number
    reserveMinutes: number
    duneNoGoAssumption: boolean
  }
  candidates: CandidateRouteMetrics[]
  stations: AiStationSummary[]
}

export interface AiDecision {
  riskWeights: RiskWeights
  preferredRouteId: CandidateRouteId
  recommendedWaypointIds?: string[]
  reasoning: string[]
  warnings: string[]
}

export type AiErrorCode =
  | 'MODEL_ERROR'
  | 'INVALID_JSON'
  | 'SCHEMA_VIOLATION'
  | 'RATE_LIMITED'
  | 'BAD_REQUEST'

export interface AiTelemetry {
  requestCount: number
  cacheHits: number
  promptTokens: number
  completionTokens: number
  totalTokens: number
  latencyMs: number
}

export interface AiPlanResponse {
  ok: boolean
  aiVerified: boolean
  model: string
  cached: boolean
  decision: AiDecision | null
  telemetry: AiTelemetry
  error?: string
  errorCode?: AiErrorCode
}

export class SchemaValidationError extends Error {
  readonly code: AiErrorCode
  constructor(message: string, code: AiErrorCode = 'SCHEMA_VIOLATION') {
    super(message)
    this.name = 'SchemaValidationError'
    this.code = code
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

export function validateRiskWeights(raw: unknown): RiskWeights {
  if (!isPlainObject(raw)) {
    throw new SchemaValidationError('riskWeights must be a JSON object.')
  }
  const keys: Array<keyof RiskWeights> = ['slope', 'sand', 'rock', 'uncertainty']
  const validated: Partial<RiskWeights> = {}

  for (const key of keys) {
    const val = raw[key]
    if (!isFiniteNumber(val)) {
      throw new SchemaValidationError(`riskWeights.${key} must be a finite number.`)
    }
    const { min, max } = RISK_WEIGHT_BOUNDS[key]
    if (val < min || val > max) {
      throw new SchemaValidationError(
        `riskWeights.${key} (${val}) is outside allowed bounds [${min}, ${max}].`,
      )
    }
    validated[key] = Number(val.toFixed(4))
  }

  const sum = validated.slope! + validated.sand! + validated.rock! + validated.uncertainty!
  if (sum < 0.2 - 1e-6 || sum > 2.5) {
    throw new SchemaValidationError(
      `Sum of riskWeights (${sum.toFixed(2)}) is outside safe normalization range [0.20, 2.50].`,
    )
  }

  return validated as RiskWeights
}

export function parseAndValidateAiJson(
  rawText: string,
  allowedStationIds?: ReadonlySet<string>,
): AiDecision {
  if (typeof rawText !== 'string' || !rawText.trim()) {
    throw new SchemaValidationError('Empty response from ML model.', 'INVALID_JSON')
  }

  const cleaned = rawText
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()

  let parsed: unknown
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    throw new SchemaValidationError('ML response is not valid JSON.', 'INVALID_JSON')
  }

  return validateAiDecision(parsed, allowedStationIds)
}

export function validateAiDecision(
  raw: unknown,
  allowedStationIds?: ReadonlySet<string>,
): AiDecision {
  if (!isPlainObject(raw)) {
    throw new SchemaValidationError('ML decision payload must be a JSON object.')
  }

  const riskWeights = validateRiskWeights(raw.riskWeights)

  const preferred = raw.preferredRouteId
  if (preferred !== 'route_a' && preferred !== 'route_b' && preferred !== 'route_c') {
    throw new SchemaValidationError(
      `preferredRouteId must be 'route_a', 'route_b', or 'route_c'; received '${String(preferred)}'.`,
    )
  }

  if (!Array.isArray(raw.reasoning) || raw.reasoning.length === 0) {
    throw new SchemaValidationError('reasoning must be a non-empty array of strings.')
  }
  const reasoning = raw.reasoning
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((item) => item.trim().slice(0, 320))
    .slice(0, 8)
  if (reasoning.length === 0) {
    throw new SchemaValidationError('reasoning must contain at least one non-empty explanation string.')
  }

  if (!Array.isArray(raw.warnings)) {
    throw new SchemaValidationError('warnings must be an array of strings.')
  }
  const warnings = raw.warnings
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((item) => item.trim().slice(0, 320))
    .slice(0, 8)

  let recommendedWaypointIds: string[] | undefined
  if (raw.recommendedWaypointIds !== undefined) {
    if (!Array.isArray(raw.recommendedWaypointIds)) {
      throw new SchemaValidationError('recommendedWaypointIds must be an array of station IDs when provided.')
    }
    recommendedWaypointIds = raw.recommendedWaypointIds
      .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
      .map((id) => id.trim())
      .filter((id) => (allowedStationIds ? allowedStationIds.has(id) : /^wp-\d+$/.test(id)))
      .slice(0, 2)
  }

  return {
    riskWeights,
    preferredRouteId: preferred,
    ...(recommendedWaypointIds && recommendedWaypointIds.length > 0 ? { recommendedWaypointIds } : {}),
    reasoning,
    warnings,
  }
}

export function validateAiPlanRequest(raw: unknown): AiPlanRequest {
  if (!isPlainObject(raw)) {
    throw new SchemaValidationError('Request body must be a JSON object.', 'BAD_REQUEST')
  }

  if (raw.model !== undefined) {
    if (
      typeof raw.model !== 'string' ||
      !ALLOWED_AI_MODELS.includes(raw.model as AiModelId)
    ) {
      throw new SchemaValidationError(`Unsupported ML model '${String(raw.model)}'.`, 'BAD_REQUEST')
    }
  }

  if (!isPlainObject(raw.mission)) {
    throw new SchemaValidationError('mission summary is required.', 'BAD_REQUEST')
  }
  const { start, target, timeLimitHours, targetStayMinutes, reserveMinutes, duneNoGoAssumption } = raw.mission
  if (!isPlainObject(start) || !isFiniteNumber(start.lon) || !isFiniteNumber(start.lat)) {
    throw new SchemaValidationError('mission.start requires valid lon and lat.', 'BAD_REQUEST')
  }
  if (
    !isPlainObject(target) ||
    typeof target.id !== 'string' ||
    typeof target.name !== 'string' ||
    !isFiniteNumber(target.lon) ||
    !isFiniteNumber(target.lat)
  ) {
    throw new SchemaValidationError('mission.target requires id, name, lon and lat.', 'BAD_REQUEST')
  }
  if (!isFiniteNumber(timeLimitHours) || timeLimitHours <= 0 || timeLimitHours > 24) {
    throw new SchemaValidationError('mission.timeLimitHours must be between 0 and 24.', 'BAD_REQUEST')
  }
  if (!isFiniteNumber(targetStayMinutes) || targetStayMinutes < 0 || targetStayMinutes > 360) {
    throw new SchemaValidationError('mission.targetStayMinutes must be between 0 and 360.', 'BAD_REQUEST')
  }
  if (!isFiniteNumber(reserveMinutes) || reserveMinutes < 0 || reserveMinutes > 240) {
    throw new SchemaValidationError('mission.reserveMinutes must be between 0 and 240.', 'BAD_REQUEST')
  }
  if (typeof duneNoGoAssumption !== 'boolean') {
    throw new SchemaValidationError('mission.duneNoGoAssumption must be boolean.', 'BAD_REQUEST')
  }

  if (!Array.isArray(raw.candidates) || raw.candidates.length < 1 || raw.candidates.length > 5) {
    throw new SchemaValidationError('candidates must contain between 1 and 5 route summaries.', 'BAD_REQUEST')
  }
  for (const candidate of raw.candidates) {
    if (
      !isPlainObject(candidate) ||
      typeof candidate.id !== 'string' ||
      !isFiniteNumber(candidate.distanceKm) ||
      !isFiniteNumber(candidate.maxSlopeDeg) ||
      !isFiniteNumber(candidate.riskCost)
    ) {
      throw new SchemaValidationError('Each candidate requires id, distanceKm, maxSlopeDeg, and riskCost.', 'BAD_REQUEST')
    }
  }

  if (!Array.isArray(raw.stations) || raw.stations.length > 20) {
    throw new SchemaValidationError('stations must be an array of at most 20 stations.', 'BAD_REQUEST')
  }

  return raw as unknown as AiPlanRequest
}
