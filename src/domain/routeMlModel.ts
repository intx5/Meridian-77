import rawModel from './jezeroRouteMlModel.json' with { type: 'json' }
import {
  type AiDecision,
  type AiPlanRequest,
  type CandidateRouteId,
  RISK_WEIGHT_BOUNDS,
  type RiskWeights,
  validateAiDecision,
  validateRiskWeights,
} from './aiPlannerSchema.ts'

interface MlTreeNode {
  leaf: boolean
  value?: number[]
  feature?: number
  threshold?: number
  left?: MlTreeNode
  right?: MlTreeNode
}

interface JezeroMlModelArtifact {
  modelId: string
  modelType: string
  version: string
  trainedOn: {
    dataset: string
    samples: number
    trainSamples: number
    validationSamples: number
    trainMae: number
    trainR2: number
    validationMae: number
    validationR2: number
    oobR2: number
    nTrees: number
    maxDepth: number
    leakageAudit: {
      passed: boolean
      sharedCorridorCount: number
      duplicateFeatureRows: number
      minTrainValL2Distance: number
      scalerFitOnTrainOnly: boolean
      trainMeanMaxAbsDeviation: number
      permutationNullR2: number
    }
    overfittingAudit: {
      passed: boolean
      trainR2: number
      validationR2: number
      oobR2: number
      r2GeneralizationGap: number
      trainMae: number
      validationMae: number
      maeGap: number
    }
    crossValidation: {
      folds: number
      foldR2Scores: number[]
      foldMaeScores: number[]
      meanR2: number
      stdR2: number
      meanMae: number
    }
  }
  featureNames: string[]
  targetNames: string[]
  featureMean: number[]
  featureStd: number[]
  featureImportances: Record<string, number>
  ensembleWeights: { randomForest: number; ridge: number }
  ridge: {
    intercept: number[]
    weights: number[][]
  }
  trees: MlTreeNode[]
}

const MODEL = rawModel as unknown as JezeroMlModelArtifact

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v))
}

function evalTree(node: MlTreeNode, x: readonly number[]): number[] {
  let curr = node
  while (!curr.leaf) {
    const f = curr.feature ?? 0
    const thresh = curr.threshold ?? 0
    curr = (x[f] ?? 0) <= thresh ? curr.left! : curr.right!
  }
  return curr.value ?? [0.35, 0.25, 0.2, 0.2]
}

export function extractMlFeatures(request: AiPlanRequest): number[] {
  const routeA = request.candidates[0]
  const routeB = request.candidates[1] ?? routeA
  const distA = Math.max(0.1, routeA.distanceKm)
  const distB = Math.max(0.1, routeB.distanceKm)
  const safetyA = routeA.safetyScore ?? 72
  const safetyB = routeB.safetyScore ?? safetyA

  return [
    distA,
    routeA.marginHours,
    routeA.maxSlopeDeg,
    routeA.meanSlopeDeg,
    routeA.steepSegmentCount15Deg / Math.max(1, distA),
    routeA.duneKm / distA,
    routeA.sandSheetKm / distA,
    routeA.highThermalFraction,
    routeA.unknownDemFraction,
    request.mission.duneNoGoAssumption ? 1.0 : 0.0,
    routeB.maxSlopeDeg,
    (routeB.duneKm + routeB.sandSheetKm) / distB,
    safetyB - safetyA,
    distB / distA,
  ]
}

export function predictRiskWeightsFromFeatures(features: readonly number[]): {
  weights: RiskWeights
  treeSpread: number
} {
  const z = features.map((val, i) => {
    const mean = MODEL.featureMean[i] ?? 0
    const std = MODEL.featureStd[i] || 1
    return (val - mean) / std
  })

  // 1. Evaluate all Random Forest trees
  const treePreds = MODEL.trees.map((tree) => evalTree(tree, features))
  const rfMean = [0, 0, 0, 0]
  for (const p of treePreds) {
    for (let k = 0; k < 4; k += 1) rfMean[k] += p[k] / treePreds.length
  }

  // Compute ensemble standard deviation across trees as a confidence metric
  let varianceSum = 0
  for (const p of treePreds) {
    for (let k = 0; k < 4; k += 1) {
      const diff = p[k] - rfMean[k]
      varianceSum += diff * diff
    }
  }
  const treeSpread = Number(Math.sqrt(varianceSum / (treePreds.length * 4)).toFixed(4))

  // 2. Evaluate Ridge Regression linear head
  const ridgePred = [...MODEL.ridge.intercept]
  for (let i = 0; i < z.length; i += 1) {
    const row = MODEL.ridge.weights[i]
    if (!row) continue
    for (let k = 0; k < 4; k += 1) {
      ridgePred[k] += z[i] * (row[k] ?? 0)
    }
  }

  // 3. Combine ensemble predictions and project into schema bounds
  const wRf = MODEL.ensembleWeights.randomForest
  const wRidge = MODEL.ensembleWeights.ridge
  const raw: RiskWeights = {
    slope: clamp(
      wRf * rfMean[0] + wRidge * ridgePred[0],
      RISK_WEIGHT_BOUNDS.slope.min,
      RISK_WEIGHT_BOUNDS.slope.max,
    ),
    sand: clamp(
      wRf * rfMean[1] + wRidge * ridgePred[1],
      RISK_WEIGHT_BOUNDS.sand.min,
      RISK_WEIGHT_BOUNDS.sand.max,
    ),
    rock: clamp(
      wRf * rfMean[2] + wRidge * ridgePred[2],
      RISK_WEIGHT_BOUNDS.rock.min,
      RISK_WEIGHT_BOUNDS.rock.max,
    ),
    uncertainty: clamp(
      wRf * rfMean[3] + wRidge * ridgePred[3],
      RISK_WEIGHT_BOUNDS.uncertainty.min,
      RISK_WEIGHT_BOUNDS.uncertainty.max,
    ),
  }

  const total = raw.slope + raw.sand + raw.rock + raw.uncertainty
  if (total > 2.45) {
    const scale = 2.4 / total
    raw.slope = clamp(raw.slope * scale, RISK_WEIGHT_BOUNDS.slope.min, RISK_WEIGHT_BOUNDS.slope.max)
    raw.sand = clamp(raw.sand * scale, RISK_WEIGHT_BOUNDS.sand.min, RISK_WEIGHT_BOUNDS.sand.max)
    raw.rock = clamp(raw.rock * scale, RISK_WEIGHT_BOUNDS.rock.min, RISK_WEIGHT_BOUNDS.rock.max)
    raw.uncertainty = clamp(
      raw.uncertainty * scale,
      RISK_WEIGHT_BOUNDS.uncertainty.min,
      RISK_WEIGHT_BOUNDS.uncertainty.max,
    )
  }

  return {
    weights: validateRiskWeights(raw),
    treeSpread,
  }
}

export function predictRouteWithMl(
  request: AiPlanRequest,
  allowedStationIds?: ReadonlySet<string>,
): AiDecision {
  const features = extractMlFeatures(request)
  const { weights, treeSpread } = predictRiskWeightsFromFeatures(features)

  const routeA = request.candidates[0]
  const routeB = request.candidates[1]
  let preferredRouteId: CandidateRouteId = routeA.id
  if (routeB) {
    const bBetterVerdict = routeB.verdict === 'GO' && routeA.verdict !== 'GO'
    const bHigherSafety =
      routeB.verdict === routeA.verdict && (routeB.safetyScore ?? 0) > (routeA.safetyScore ?? 0)
    const bLowerRisk =
      routeB.verdict === routeA.verdict &&
      (routeB.safetyScore ?? 0) === (routeA.safetyScore ?? 0) &&
      routeB.riskCost < routeA.riskCost
    if ((bBetterVerdict || bHigherSafety || bLowerRisk) && routeB.marginHours >= 0) {
      preferredRouteId = routeB.id
    }
  }

  const reasoning: string[] = [
    `Jezero Random Forest + Ridge ML ensemble (R²=${MODEL.trainedOn.validationR2.toFixed(2)}, σ=${treeSpread.toFixed(3)}) predicted weights slope=${weights.slope.toFixed(2)}, sand=${weights.sand.toFixed(2)}, rock=${weights.rock.toFixed(2)}, uncertainty=${weights.uncertainty.toFixed(2)}.`,
  ]

  if (routeA.maxSlopeDeg >= 14.0) {
    reasoning.push(
      `Shortest corridor reaches ${routeA.maxSlopeDeg.toFixed(1)}° max slope (${routeA.steepSegmentCount15Deg} steep segment${routeA.steepSegmentCount15Deg === 1 ? '' : 's'}); elevated slope penalty (${weights.slope.toFixed(2)}) steers A* toward gentler delta benches.`,
    )
  } else {
    reasoning.push(
      `Moderate baseline slope (${routeA.maxSlopeDeg.toFixed(1)}° max, ${routeA.meanSlopeDeg.toFixed(1)}° mean) allows balanced slope weighting (${weights.slope.toFixed(2)}) to preserve EVA return reserve (${routeA.marginHours.toFixed(2)} h margin).`,
    )
  }

  if (routeA.duneKm + routeA.sandSheetKm > 0.05) {
    reasoning.push(
      `Corridor crosses ${(routeA.duneKm + routeA.sandSheetKm).toFixed(2)} km of mapped aeolian deposits (${routeA.duneKm.toFixed(2)} km active dunes); sand weight (${weights.sand.toFixed(2)}) prioritizes cohesive floor units.`,
    )
  }

  const warnings: string[] = [
    'Orbital HiRISE (25 cm) and Mars 2020 DEM (9.8 m display grid) cannot resolve sub-decimeter regolith crust induration or loose pebble hazards.',
  ]
  if (routeA.unknownDemFraction > 0.01) {
    warnings.push(
      `Corridor borders ${(routeA.unknownDemFraction * 100).toFixed(1)}% missing DEM coverage; local visual verification is required before traverse execution.`,
    )
  }
  if (request.mission.duneNoGoAssumption && routeA.duneKm > 0) {
    warnings.push(
      `Active dune NO-GO rule is enabled; A* enforces hard exclusion around ${routeA.duneKm.toFixed(2)} km of mapped dune bedforms.`,
    )
  }

  return validateAiDecision(
    {
      riskWeights: weights,
      preferredRouteId,
      recommendedWaypointIds: [],
      reasoning,
      warnings,
    },
    allowedStationIds,
  )
}

export function getJezeroMlModelInfo() {
  return {
    modelId: MODEL.modelId,
    modelType: MODEL.modelType,
    version: MODEL.version,
    trainedOn: MODEL.trainedOn,
    featureImportances: MODEL.featureImportances,
  }
}
