export const SCIENCE_STOP_MINUTES = 20
export const MIN_TRAVERSE_KM = 0.01

export const EVA_ASSUMPTIONS = [
  'Walking speed 1.5 km/h on unknown mixed terrain; no suit overhead beyond sample stops.',
  `Intermediate science and POV stops add ${SCIENCE_STOP_MINUTES} minutes each. The target stay is set separately.`,
  'Return is along the same route in reverse; the mission starts at 09:00.',
  'A 30 minute reserve must remain at return; the target stay is user-controlled.',
  'Slope above 15° is a caution threshold; 25° is a hard no-go gate.',
  'THEMIS thermal inertia is sampled continuously along the route: >80th percentile (~348 SI) marks rocky block hazards and <185 SI marks loose dust.',
  'Sand & Dune Detection: crossing active dune fields or >=5% sand sheets triggers CAUTION and safety penalties; enabling Dune No-Go (or >=35% dune crossing) triggers NO-GO.',
  'The radiation panel reports advisory environmental dose estimates (µGy) and DEM sky visibility.',
  'Safety is 60% of the composite score and science is 40%.',
  'Any route crossing more than 5% no-data DEM cells is INSUFFICIENT DATA.',
  'These are product planning assumptions, not NASA flight rules.',
]

export const SCORE_WEIGHTS = { safety: 0.6, science: 0.4 }

/** Budget defaults, all exposed as scenario assumptions in the UI. */
export const BUDGET_CONFIG = {
  timeLimitHours: 6,
  walkSpeedKmH: 1.5,
  missionStartMinutes: 9 * 60,
  targetStayMinutes: 20,
  reserveMinutes: 30,
  maxStayRangeMinutes: [0, 120] as const,
  reserveRangeMinutes: [0, 90] as const,
}
