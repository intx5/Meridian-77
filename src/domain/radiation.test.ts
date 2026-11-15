import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  assessRouteTopographicShielding,
  compareRoutesRadiation,
  computeEvaRadiationExposure,
  computeInformationalDoseEquivalentMicroSv,
  convertAbsorbedDoseRate,
  parseRadRdrObservationRecord,
  pdsDoyToIsoUtc,
  sampleShieldingAt,
  validateRadiationData,
} from './radiation'
import { useMissionStore } from '@/store/useMissionStore'
import type {
  LayersManifest,
  RadiationProvenanceData,
  RadiationReferenceData,
  RadiationScenariosData,
  ReturnBudget,
  ShieldingGrid,
} from '@/types'
import type { RouteTerrain } from './dem'

const dataDir = path.resolve(process.cwd(), 'public/data/jezero')
const radiationDir = path.join(dataDir, 'radiation')

const referenceData = JSON.parse(
  fs.readFileSync(path.join(radiationDir, 'radiation-reference.json'), 'utf8'),
) as RadiationReferenceData

const scenariosData = JSON.parse(
  fs.readFileSync(path.join(radiationDir, 'radiation-scenarios.json'), 'utf8'),
) as RadiationScenariosData

const provenanceData = JSON.parse(
  fs.readFileSync(path.join(radiationDir, 'radiation-provenance.json'), 'utf8'),
) as RadiationProvenanceData

const shieldingGridData = JSON.parse(
  fs.readFileSync(path.join(radiationDir, 'shielding-grid.json'), 'utf8'),
) as ShieldingGrid

const layersManifest = JSON.parse(
  fs.readFileSync(path.join(dataDir, 'layers.json'), 'utf8'),
) as LayersManifest

const terrainManifest = JSON.parse(
  fs.readFileSync(path.join(dataDir, 'terrain/manifest.json'), 'utf8'),
) as { layers: Record<string, unknown> }

const mockTerrain: RouteTerrain = {
  samples: [
    { lon: 77.451, lat: 18.445, distanceKm: 0, elevationM: -2565 },
    { lon: 77.432, lat: 18.449, distanceKm: 1.2, elevationM: -2520 },
    { lon: 77.405, lat: 18.455, distanceKm: 2.4, elevationM: -2485 },
  ],
  totalKm: 2.4,
  elevationGainM: 80,
  elevationLossM: 0,
  meanSlopeDeg: 4.2,
  maxSlopeDeg: 6.2,
  unknownFraction: 0,
  hazardSegments: [],
}

const mockBudget: ReturnBudget = {
  outboundHours: 1.5,
  returnHours: 1.4,
  scienceStopMinutes: 20,
  targetStayMinutes: 45,
  reserveMinutes: 30,
  timeLimitHours: 6,
  totalHours: 3.98,
  marginHours: 1.52,
  maxTargetStayMinutes: 136,
  latestDeparture: '11:36',
  latestReturn: '14:30',
  targetReachable: true,
  exceeded: false,
  excessMinutes: 0,
  unknownFraction: 0,
  dataInsufficient: false,
}

describe('Mars Radiation Exposure & Topographic Shielding System', () => {
  it('rejects a shielding grid with zero columns and empty arrays', () => {
    const malformed = { ...shieldingGridData, width: 0, skyVisibilityValues: [], meanHorizonDegValues: [] }
    expect(() => validateRadiationData(
      referenceData, scenariosData, provenanceData, malformed, layersManifest.region.bounds,
    )).toThrow(/shielding-grid.json:.*dimensions/)
  })

  it('1. validates real NASA PDS MSL-M-RAD-3-RDR-V1.0 record format and dataset schema', () => {
    expect(() =>
      validateRadiationData(
        referenceData,
        scenariosData,
        provenanceData,
        shieldingGridData,
        layersManifest.region.bounds,
      ),
    ).not.toThrow()

    const parsed = parseRadRdrObservationRecord({
      productId: 'RAD_RDR_2017_254_02_02_1812_V02',
      sol: 1812,
      obsIndex: 220,
      startObsUtc: '2017-254 03:56:46',
      startObsMars: '1812M03:49:15',
      obsDurationSeconds: 975,
      qcFlag: '00000000',
      doseBMicroGyPerHour: 25.891916,
      doseEMicroGyPerHour: 24.02735,
    })

    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.record.productId).toBe('RAD_RDR_2017_254_02_02_1812_V02')
      expect(parsed.record.sol).toBe(1812)
      expect(parsed.record.absorbedDoseRateSiliconMicroGyPerHour).toBeCloseTo(25.8919, 3)
      expect(parsed.record.absorbedDoseRateTissuePlasticMicroGyPerHour).toBeCloseTo(24.0274, 3)
      expect(parsed.record.dataStatus).toBe('MEASURED_GALE_RAD_RDR')
    }
  })

  it('2. converts PDS YYYY-DOY HH:MM:SS timestamps accurately to ISO-8601 UTC', () => {
    // 2017 Day-of-Year 254 is September 11, 2017 (GLE 72 SEP peak)
    expect(pdsDoyToIsoUtc('2017-254 03:56:46')).toBe('2017-09-11T03:56:46Z')
    // Leap year check: 2016 Day-of-Year 060 is February 29, 2016
    expect(pdsDoyToIsoUtc('2016-060 00:08:50')).toBe('2016-02-29T00:08:50Z')
    // Invalid day of year (>365 in non-leap year)
    expect(pdsDoyToIsoUtc('2017-366 12:00:00')).toBeNull()
    expect(pdsDoyToIsoUtc('invalid-date')).toBeNull()
  })

  it('3. rejects missing, null, NaN, or non-positive radiation measurements', () => {
    const nullDose = parseRadRdrObservationRecord({
      productId: 'RAD_RDR_2017_254_02_02_1812_V02',
      sol: 1812,
      obsIndex: 1,
      startObsUtc: '2017-254 00:12:31',
      obsDurationSeconds: 974,
      qcFlag: '00000000',
      doseBMicroGyPerHour: null,
      doseEMicroGyPerHour: 10.5,
    })
    expect(nullDose.ok).toBe(false)

    const zeroDose = parseRadRdrObservationRecord({
      productId: 'RAD_RDR_2017_254_02_02_1812_V02',
      sol: 1812,
      obsIndex: 1,
      startObsUtc: '2017-254 00:12:31',
      obsDurationSeconds: 974,
      qcFlag: '00000000',
      doseBMicroGyPerHour: 10.2,
      doseEMicroGyPerHour: 0,
    })
    expect(zeroDose.ok).toBe(false)

    const nanDose = parseRadRdrObservationRecord({
      productId: 'RAD_RDR_2017_254_02_02_1812_V02',
      sol: 1812,
      obsIndex: 1,
      startObsUtc: '2017-254 00:12:31',
      obsDurationSeconds: 974,
      qcFlag: '00000000',
      doseBMicroGyPerHour: Number.NaN,
      doseEMicroGyPerHour: 10.5,
    })
    expect(nanDose.ok).toBe(false)
  })

  it('4. filters out records with non-nominal QC flags or truncated durations (< 120 s)', () => {
    const badQc = parseRadRdrObservationRecord({
      productId: 'RAD_RDR_2017_254_02_02_1812_V02',
      sol: 1812,
      obsIndex: 10,
      startObsUtc: '2017-254 00:12:31',
      obsDurationSeconds: 974,
      qcFlag: '00000100',
      doseBMicroGyPerHour: 10.2,
      doseEMicroGyPerHour: 10.8,
    })
    expect(badQc.ok).toBe(false)
    if (!badQc.ok) {
      expect(badQc.reason).toContain('non-nominal QC flag')
    }

    const shortObs = parseRadRdrObservationRecord({
      productId: 'RAD_RDR_2017_254_02_02_1812_V02',
      sol: 1812,
      obsIndex: 10,
      startObsUtc: '2017-254 00:12:31',
      obsDurationSeconds: 45,
      qcFlag: '00000000',
      doseBMicroGyPerHour: 10.2,
      doseEMicroGyPerHour: 10.8,
    })
    expect(shortObs.ok).toBe(false)
    if (!shortObs.ok) {
      expect(shortObs.reason).toContain('minimum 120 s')
    }
  })

  it('5. converts physical absorbed dose rates accurately between uGy/h, mGy/h, Gy/h, and uGy/day', () => {
    expect(convertAbsorbedDoseRate(10, 'uGy/h', 'uGy/day')).toBeCloseTo(240, 6)
    expect(convertAbsorbedDoseRate(240, 'uGy/day', 'uGy/h')).toBeCloseTo(10, 6)
    expect(convertAbsorbedDoseRate(1000, 'uGy/h', 'mGy/h')).toBeCloseTo(1, 6)
    expect(convertAbsorbedDoseRate(1, 'mGy/h', 'uGy/h')).toBeCloseTo(1000, 6)
    expect(convertAbsorbedDoseRate(10, 'uGy/h', 'Gy/h')).toBeCloseTo(0.00001, 9)
  })

  it('6. computes total EVA exposure as Absorbed Dose = Dose Rate * Exposure Time across all phases', () => {
    const gcrScenario = scenariosData.scenarios.find((s) => s.id === 'background_gcr')!
    const result = computeEvaRadiationExposure({
      terrain: mockTerrain,
      budget: mockBudget,
      scenario: gcrScenario,
      component: 'total',
      shieldingGrid: shieldingGridData,
    })

    expect(result.status).toBe('OK')
    // Outbound = 1.5 h, Stop = 1 * 20m (0.3333h) + 45m (0.75h) = 1.0833 h, Return = 1.4 h -> Total = 3.9833 h
    const rate = gcrScenario.absorbedDoseRateMicroGyPerHour
    const expectedTotalHours = 1.5 + 20 / 60 + 45 / 60 + 1.4
    expect(result.totalExposureHours).toBeCloseTo(expectedTotalHours, 2)
    expect(result.outboundWalkExposureMicroGy).toBeCloseTo(rate * 1.5, 1)
    expect(result.scienceStopExposureMicroGy).toBeCloseTo(rate * (20 / 60 + 45 / 60), 1)
    expect(result.returnExposureMicroGy).toBeCloseTo(rate * 1.4, 1)
    expect(result.totalModeledExposureMicroGy).toBeCloseTo(rate * expectedTotalHours, 1)
  })

  it('7. integrates a full 6-hour round-trip EVA and reflects scenario switching (GCR vs Sep 2017 SEP)', () => {
    const sixHourBudget: ReturnBudget = {
      ...mockBudget,
      outboundHours: 2.25,
      targetStayMinutes: 60,
      returnHours: 2.4167,
      totalHours: 6.0,
    }
    const gcrScenario = scenariosData.scenarios.find((s) => s.id === 'background_gcr')!
    const sepScenario = scenariosData.scenarios.find((s) => s.id === 'sep_sep2017')!

    const gcrAssessment = computeEvaRadiationExposure({
      terrain: mockTerrain,
      budget: sixHourBudget,
      scenario: gcrScenario,
      component: 'total',
      shieldingGrid: shieldingGridData,
    })

    const sepAssessment = computeEvaRadiationExposure({
      terrain: mockTerrain,
      budget: sixHourBudget,
      scenario: sepScenario,
      component: 'total',
      shieldingGrid: shieldingGridData,
    })

    expect(gcrAssessment.totalExposureHours).toBeCloseTo(6.0, 2)
    expect(sepAssessment.totalExposureHours).toBeCloseTo(6.0, 2)
    expect(sepAssessment.totalModeledExposureMicroGy).toBeGreaterThan(
      gcrAssessment.totalModeledExposureMicroGy * 1.9,
    )
    // Verify GCR-only and SEP-only component filtering during SEP scenario
    const sepExcessOnly = computeEvaRadiationExposure({
      terrain: mockTerrain,
      budget: sixHourBudget,
      scenario: sepScenario,
      component: 'sep_only',
      shieldingGrid: shieldingGridData,
    })
    expect(sepExcessOnly.referenceDoseRateMicroGyPerHour).toBeCloseTo(
      sepScenario.sepComponentMicroGyPerHour,
      3,
    )
  })

  it('8. strictly prevents direct Gy <-> Sv conflation and requires explicit quality factor <Q>', () => {
    expect(() => convertAbsorbedDoseRate(10.5, 'uGy/h', 'uSv/h')).toThrow(
      /Direct unit conversion between Gray \(Gy\) and Sievert \(Sv\) is physically invalid/,
    )
    expect(() => convertAbsorbedDoseRate(30, 'mSv/h', 'mGy/h')).toThrow(
      /Direct unit conversion between Gray \(Gy\) and Sievert \(Sv\) is physically invalid/,
    )

    // Informational dose equivalent requires explicit <Q> within [1, 20]
    expect(computeInformationalDoseEquivalentMicroSv(50, 3.05)).toBeCloseTo(152.5, 2)
    expect(() => computeInformationalDoseEquivalentMicroSv(50, 0)).toThrow()
  })

  it('9. returns INSUFFICIENT_DATA cleanly when route or radiation scenario is missing', () => {
    const emptyTerrain: RouteTerrain = {
      ...mockTerrain,
      samples: [],
      totalKm: 0,
    }
    const gcrScenario = scenariosData.scenarios.find((s) => s.id === 'background_gcr')!
    const emptyRouteResult = computeEvaRadiationExposure({
      terrain: emptyTerrain,
      budget: mockBudget,
      scenario: gcrScenario,
    })
    expect(emptyRouteResult.status).toBe('INSUFFICIENT_DATA')
    expect(emptyRouteResult.totalModeledExposureMicroGy).toBe(0)

    const missingScenarioResult = computeEvaRadiationExposure({
      terrain: mockTerrain,
      budget: mockBudget,
      scenario: null,
    })
    expect(missingScenarioResult.status).toBe('INSUFFICIENT_DATA')
  })

  it('10. enforces scientific honesty labels (Gale Measurement vs Jezero Model & Experimental Shielding)', () => {
    const gcrScenario = scenariosData.scenarios.find((s) => s.id === 'background_gcr')!
    const sepScenario = scenariosData.scenarios.find((s) => s.id === 'sep_sep2017')!

    const gcrResult = computeEvaRadiationExposure({
      terrain: mockTerrain,
      budget: mockBudget,
      scenario: gcrScenario,
      shieldingGrid: shieldingGridData,
    })
    expect(gcrResult.estimateLabel).toBe(
      'Environmental Radiation Exposure Estimate (Unshielded Surface Reference)',
    )
    expect(gcrResult.measurementVsModelLabel).toBe(
      'Gale Crater RAD Reference -> Jezero Environmental Estimate',
    )
    expect(gcrResult.verdictImpact).toBe('ADVISORY_ONLY_NO_AUTOMATIC_GO_NOGO')
    expect(gcrResult.topographicShielding.statusLabel).toBe(
      'Terrain Shielding Potential — Experimental',
    )
    // Sky visibility fraction must NEVER be claimed as a direct % dose reduction
    expect(gcrResult.topographicShielding.claimedDoseReductionPercent).toBeNull()

    const sepResult = computeEvaRadiationExposure({
      terrain: mockTerrain,
      budget: mockBudget,
      scenario: sepScenario,
      shieldingGrid: shieldingGridData,
    })
    expect(sepResult.measurementVsModelLabel).toBe(
      'Historical SEP Event Reference -> Jezero Environmental Estimate',
    )

    const pointSample = sampleShieldingAt(shieldingGridData, 77.42, 18.45)
    expect(pointSample.skyVisibilityFraction).not.toBeNull()
    expect(pointSample.skyVisibilityFraction!).toBeGreaterThan(0.5)
    expect(pointSample.skyVisibilityFraction!).toBeLessThanOrEqual(1.0)

    const routeShielding = assessRouteTopographicShielding(shieldingGridData, mockTerrain.samples)
    expect(routeShielding.claimedDoseReductionPercent).toBeNull()
  })

  it('11. supports toggling Radiation Exposure and independent Terrain Shielding Potential in store', () => {
    const store = useMissionStore.getState()
    store.initLayers(layersManifest.layers)

    expect(useMissionStore.getState().layers.radiation.visible).toBe(false)
    store.toggleLayer('radiation')
    expect(useMissionStore.getState().layers.radiation.visible).toBe(true)
    store.setLayerOpacity('radiation', 0.65)
    expect(useMissionStore.getState().layers.radiation.opacity).toBeCloseTo(0.65, 2)

    // Shielding overlay is independent of radiation layer visibility
    expect(useMissionStore.getState().shieldingOverlay).toBe(false)
    store.setShieldingOverlay(true)
    expect(useMissionStore.getState().shieldingOverlay).toBe(true)
    store.setShieldingOpacity(0.55)
    expect(useMissionStore.getState().shieldingOpacity).toBeCloseTo(0.55, 2)

    store.setRadiationScenarioId('sep_sep2017')
    expect(useMissionStore.getState().radiationScenarioId).toBe('sep_sep2017')
    store.setRadiationComponent('gcr_only')
    expect(useMissionStore.getState().radiationComponent).toBe('gcr_only')
  })

  it('12. verifies 2D and 3D terrain tile assets exist for both radiation and shielding overlays', () => {
    const radiationLayer = layersManifest.layers.find((l) => l.id === 'radiation')
    expect(radiationLayer).toBeDefined()
    expect(fs.existsSync(path.join(dataDir, 'radiation.webp'))).toBe(true)
    expect(fs.existsSync(path.join(dataDir, 'radiation-sep-total.webp'))).toBe(true)
    expect(fs.existsSync(path.join(dataDir, 'radiation-gcr.webp'))).toBe(true)
    expect(fs.existsSync(path.join(dataDir, 'radiation-sep.webp'))).toBe(true)
    expect(fs.existsSync(path.join(dataDir, 'shielding.webp'))).toBe(true)

    expect(terrainManifest.layers.radiation).toBeDefined()
    expect(terrainManifest.layers['radiation-sep-total']).toBeDefined()
    expect(terrainManifest.layers['radiation-gcr']).toBeDefined()
    expect(terrainManifest.layers['radiation-sep']).toBeDefined()
    expect(terrainManifest.layers.shielding).toBeDefined()
    expect(fs.existsSync(path.join(dataDir, 'terrain/radiation/0-0.webp'))).toBe(true)
    expect(fs.existsSync(path.join(dataDir, 'terrain/radiation-sep-total/0-0.webp'))).toBe(true)
    expect(fs.existsSync(path.join(dataDir, 'terrain/radiation-gcr/0-0.webp'))).toBe(true)
    expect(fs.existsSync(path.join(dataDir, 'terrain/radiation-sep/0-0.webp'))).toBe(true)
    expect(fs.existsSync(path.join(dataDir, 'terrain/shielding/0-0.webp'))).toBe(true)
  })

  it('13. compares candidate routes and attributes exposure differences strictly to EVA duration', () => {
    const gcrScenario = scenariosData.scenarios.find((s) => s.id === 'background_gcr')!
    const fastAssessment = computeEvaRadiationExposure({
      terrain: mockTerrain,
      budget: { ...mockBudget, outboundHours: 1.2, returnHours: 1.1 },
      scenario: gcrScenario,
    })
    const slowAssessment = computeEvaRadiationExposure({
      terrain: mockTerrain,
      budget: { ...mockBudget, outboundHours: 1.9, returnHours: 1.8 },
      scenario: gcrScenario,
    })

    const comparison = compareRoutesRadiation([
      { routeId: 'route_a', routeLabel: 'Route A (Shortest)', assessment: fastAssessment },
      { routeId: 'route_b', routeLabel: 'Route B (Detour)', assessment: slowAssessment },
    ])

    expect(comparison).toHaveLength(2)
    expect(comparison[0].differenceFromLowestExposureMicroGy).toBe(0)
    expect(comparison[0].comparisonBasisNote).toContain('shorter total EVA duration')
    expect(comparison[1].differenceFromLowestExposureMicroGy).toBeGreaterThan(0)
    expect(comparison[1].comparisonBasisNote).toContain('longer exposure duration in the same regional radiation environment')
  })
})
