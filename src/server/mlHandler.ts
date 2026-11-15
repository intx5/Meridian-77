import { createHash } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  type AiDecision,
  type AiPlanRequest,
  type AiPlanResponse,
  type AiTelemetry,
  SchemaValidationError,
  validateAiDecision,
  validateAiPlanRequest,
} from '../domain/aiPlannerSchema.ts'
import { getJezeroMlModelInfo, predictRouteWithMl } from '../domain/routeMlModel.ts'

export interface MlServerConfig {
  defaultModel?: string
  rateLimitMax?: number
  rateLimitWindowMs?: number
  predictImpl?: (
    request: AiPlanRequest,
    allowedStationIds: ReadonlySet<string>,
  ) => AiDecision | Promise<AiDecision>
}

interface CacheEntry {
  decision: AiDecision
  model: string
  expiresAt: number
}

export function createMlService(config: MlServerConfig = {}) {
  const cache = new Map<string, CacheEntry>()
  const ipTimestamps = new Map<string, number[]>()

  let requestCount = 0
  let cacheHits = 0
  const promptTokens = 0
  const completionTokens = 0
  const totalTokens = 0

  function getResolvedConfig() {
    const defaultModel = (config.defaultModel ?? 'jezero-ml').trim()
    const rateLimitMax = config.rateLimitMax ?? 60
    const rateLimitWindowMs = config.rateLimitWindowMs ?? 60_000
    const predictFn = config.predictImpl ?? predictRouteWithMl
    return {
      defaultModel,
      rateLimitMax,
      rateLimitWindowMs,
      predictFn,
    }
  }

  function snapshotTelemetry(latencyMs = 0): AiTelemetry {
    return {
      requestCount,
      cacheHits,
      promptTokens,
      completionTokens,
      totalTokens,
      latencyMs,
    }
  }

  function checkRateLimit(clientIp: string): boolean {
    const { rateLimitMax, rateLimitWindowMs } = getResolvedConfig()
    const now = Date.now()
    const recent = (ipTimestamps.get(clientIp) ?? []).filter((ts) => now - ts < rateLimitWindowMs)
    if (recent.length >= rateLimitMax) {
      ipTimestamps.set(clientIp, recent)
      return false
    }
    recent.push(now)
    ipTimestamps.set(clientIp, recent)
    return true
  }

  function getStatus() {
    const { defaultModel } = getResolvedConfig()
    return {
      configured: true,
      defaultModel,
      availableModels: ['jezero-ml'],
      localMlModel: getJezeroMlModelInfo(),
      telemetry: snapshotTelemetry(0),
    }
  }

  async function evaluatePlan(
    rawPayload: unknown,
    clientIp = '127.0.0.1',
  ): Promise<{ status: number; body: AiPlanResponse }> {
    const startedAt = Date.now()
    const cfg = getResolvedConfig()

    if (!checkRateLimit(clientIp)) {
      return {
        status: 429,
        body: {
          ok: false,
          aiVerified: false,
          model: cfg.defaultModel,
          cached: false,
          decision: null,
          telemetry: snapshotTelemetry(Date.now() - startedAt),
          error: 'Rate limit exceeded. Please wait before requesting another ML analysis.',
          errorCode: 'RATE_LIMITED',
        },
      }
    }

    let payload: AiPlanRequest
    try {
      payload = validateAiPlanRequest(rawPayload)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Invalid request payload.'
      return {
        status: 400,
        body: {
          ok: false,
          aiVerified: false,
          model: cfg.defaultModel,
          cached: false,
          decision: null,
          telemetry: snapshotTelemetry(Date.now() - startedAt),
          error: message,
          errorCode: 'BAD_REQUEST',
        },
      }
    }

    const requestedModel = payload.model ?? cfg.defaultModel
    const cacheKey = createHash('sha256')
      .update(
        JSON.stringify({
          model: requestedModel,
          mission: payload.mission,
          candidates: payload.candidates,
          stations: payload.stations,
        }),
      )
      .digest('hex')

    const cachedEntry = cache.get(cacheKey)
    if (cachedEntry && cachedEntry.expiresAt > Date.now()) {
      cacheHits += 1
      return {
        status: 200,
        body: {
          ok: true,
          aiVerified: true,
          model: cachedEntry.model,
          cached: true,
          decision: cachedEntry.decision,
          telemetry: snapshotTelemetry(Date.now() - startedAt),
        },
      }
    }

    const allowedStationIds = new Set(payload.stations.map((s) => s.id))

    requestCount += 1
    try {
      const rawDecision = await cfg.predictFn(payload, allowedStationIds)
      const decision = validateAiDecision(rawDecision, allowedStationIds)
      if (cache.size >= 64) {
        const oldestKey = cache.keys().next().value
        if (oldestKey) cache.delete(oldestKey)
      }
      cache.set(cacheKey, {
        decision,
        model: requestedModel,
        expiresAt: Date.now() + 5 * 60_000,
      })
      return {
        status: 200,
        body: {
          ok: true,
          aiVerified: true,
          model: requestedModel,
          cached: false,
          decision,
          telemetry: snapshotTelemetry(Math.max(1, Date.now() - startedAt)),
        },
      }
    } catch (err) {
      if (err instanceof SchemaValidationError) {
        return {
          status: 422,
          body: {
            ok: false,
            aiVerified: false,
            model: requestedModel,
            cached: false,
            decision: null,
            telemetry: snapshotTelemetry(Date.now() - startedAt),
            error: `ML decision failed schema validation: ${err.message}`,
            errorCode: err.code,
          },
        }
      }
      const message = err instanceof Error ? err.message : 'ML route evaluation failed.'
      return {
        status: 500,
        body: {
          ok: false,
          aiVerified: false,
          model: requestedModel,
          cached: false,
          decision: null,
          telemetry: snapshotTelemetry(Date.now() - startedAt),
          error: message,
          errorCode: 'MODEL_ERROR',
        },
      }
    }
  }

  return {
    getStatus,
    evaluatePlan,
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  const json = JSON.stringify(body)
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(json)
}

function readRequestBody(req: IncomingMessage, maxBytes = 64 * 1024): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    const chunks: Buffer[] = []
    let total = 0
    req.on('data', (chunk: Buffer) => {
      total += chunk.length
      if (total > maxBytes) {
        rejectPromise(new Error('Request body exceeds 64 KB limit.'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      resolvePromise(Buffer.concat(chunks).toString('utf8'))
    })
    req.on('error', (err) => {
      rejectPromise(err)
    })
  })
}

export function createMlMiddleware(config: MlServerConfig = {}) {
  const service = createMlService(config)

  return async function mlMiddleware(
    req: IncomingMessage,
    res: ServerResponse,
    next: (err?: unknown) => void,
  ) {
    const url = req.url ? req.url.split('?')[0] : ''
    if (url !== '/api/ml/plan' && url !== '/api/ml/status') {
      next()
      return
    }

    if (url === '/api/ml/status' && req.method === 'GET') {
      sendJson(res, 200, service.getStatus())
      return
    }

    if (url === '/api/ml/plan' && req.method === 'POST') {
      const clientIp = req.socket?.remoteAddress ?? '127.0.0.1'
      let rawBody: string
      try {
        rawBody = await readRequestBody(req)
      } catch (err) {
        sendJson(res, 413, {
          ok: false,
          aiVerified: false,
          model: 'jezero-ml',
          cached: false,
          decision: null,
          telemetry: service.getStatus().telemetry,
          error: err instanceof Error ? err.message : 'Unable to read request body.',
          errorCode: 'BAD_REQUEST',
        })
        return
      }

      let parsedJson: unknown
      try {
        parsedJson = JSON.parse(rawBody)
      } catch {
        sendJson(res, 400, {
          ok: false,
          aiVerified: false,
          model: 'jezero-ml',
          cached: false,
          decision: null,
          telemetry: service.getStatus().telemetry,
          error: 'Request body must be valid JSON.',
          errorCode: 'BAD_REQUEST',
        })
        return
      }

      const result = await service.evaluatePlan(parsedJson, clientIp)
      sendJson(res, result.status, result.body)
      return
    }

    sendJson(res, 405, {
      ok: false,
      error: 'Method not allowed.',
    })
  }
}
