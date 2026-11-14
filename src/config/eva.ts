export const EVA_ASSUMPTIONS = [
  'Walking speed 1.5 km/h on unknown mixed terrain; no suit overhead beyond sample stops.',
  'Every science or POV waypoint costs 20 minutes of sampling time.',
  'Return is along the same route in reverse; the mission starts at 09:00.',
  'A 30 minute reserve must remain at return; the target stay is user-controlled.',
  'Slope above 15° is a caution threshold; 25° is a hard no-go gate.',
  'Thermal inertia above the 80th percentile of the mapped region marks rocky terrain.',
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
