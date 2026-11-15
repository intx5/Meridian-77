import { create } from 'zustand'
import type {
  LayerId,
  LonLat,
  MapLayer,
  PresetRouteId,
  RadiationComponentId,
  RadiationScenarioId,
  RoutePoint,
  Waypoint,
} from '@/types'
import { DEFAULT_TARGET_ID, TARGET_WAYPOINT_ID } from '@/config/region'
import { BUDGET_CONFIG } from '@/config/eva'
import { PRESET_ROUTES } from '@/config/routes'

export interface LayerState {
  visible: boolean
  opacity: number
}

export interface CoordinateReadout {
  lon: number
  lat: number
  elevationM: number | null
  temperatureC?: number | null
}

interface MissionState {
  viewMode: '2d' | '3d'
  relief: 1 | 2 | 3
  setViewMode: (mode: '2d' | '3d') => void
  setRelief: (relief: 1 | 2 | 3) => void
  route: RoutePoint[]
  presetRouteId: PresetRouteId | null
  startWaypointId: string
  targetId: string
  targetStayMinutes: number
  reserveMinutes: number
  highlightSegment: { from: LonLat; to: LonLat } | null
  selectedWaypointId: string | null
  selectedSandFeatureId: string | null
  duneNoGoAssumption: boolean
  showCandidateOverlay: boolean
  briefOpen: boolean
  layers: Record<LayerId, LayerState>
  slopeOverlay: boolean
  slopeOpacity: number
  shieldingOverlay: boolean
  shieldingOpacity: number
  radiationScenarioId: RadiationScenarioId
  radiationComponent: RadiationComponentId
  coordinate: CoordinateReadout | null
  focus: { lon: number; lat: number; nonce: number } | null
  addPoint: (lon: number, lat: number) => void
  addWaypoint: (waypoint: Waypoint) => void
  loadPresetRoute: (id: PresetRouteId) => void
  loadPlannedRoute: (waypoints: LonLat[], targetId: string, startWaypointId?: string, endWaypointId?: string) => void
  undo: () => void
  clear: () => void
  setStartWaypointId: (id: string) => void
  setTarget: (targetId: string) => void
  setTargetStayMinutes: (minutes: number) => void
  setReserveMinutes: (minutes: number) => void
  setHighlightSegment: (segment: { from: LonLat; to: LonLat } | null) => void
  selectWaypoint: (id: string | null) => void
  selectSandFeature: (id: string | null) => void
  setDuneNoGoAssumption: (enabled: boolean) => void
  setShowCandidateOverlay: (visible: boolean) => void
  setBriefOpen: (open: boolean) => void
  toggleLayer: (id: LayerId) => void
  setLayerOpacity: (id: LayerId, opacity: number) => void
  setSlopeOverlay: (visible: boolean) => void
  setSlopeOpacity: (opacity: number) => void
  setShieldingOverlay: (visible: boolean) => void
  setShieldingOpacity: (opacity: number) => void
  setRadiationScenarioId: (id: RadiationScenarioId) => void
  setRadiationComponent: (comp: RadiationComponentId) => void
  setCoordinate: (readout: CoordinateReadout | null) => void
  centerOn: (lon: number, lat: number) => void
  initLayers: (layers: MapLayer[]) => void
}

const DEFAULT_LAYERS: Record<LayerId, LayerState> = {
  optical: { visible: true, opacity: 1 },
  topography: { visible: true, opacity: 0.55 },
  geology: { visible: true, opacity: 0.45 },
  thermal: { visible: false, opacity: 0.6 },
  temperature: { visible: false, opacity: 0.65 },
  mineralogy: { visible: false, opacity: 0.75 },
  sand: { visible: false, opacity: 0.72 },
  radiation: { visible: false, opacity: 0.65 },
}

function routeFromPreset(id: PresetRouteId): RoutePoint[] {
  const preset = PRESET_ROUTES.find((route) => route.id === id)
  if (!preset) throw new Error(`Unknown preset route: ${id}`)
  const targetWaypointId = TARGET_WAYPOINT_ID[preset.targetId]
  return preset.waypoints.map((point, index) => ({
    id: `preset-${id}-${index}`,
    lon: point.lon,
    lat: point.lat,
    waypointId: index === 0 ? 'wp-01' : index === preset.waypoints.length - 1 ? targetWaypointId : undefined,
  }))
}

const newId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `pt-${Date.now()}-${Math.random().toString(36).slice(2)}`

export const useMissionStore = create<MissionState>((set) => ({
  viewMode: '2d',
  relief: 1,
  setViewMode: (viewMode) => set({ viewMode, coordinate: null }),
  setRelief: (relief) => set({ relief }),
  route: [],
  presetRouteId: null,
  startWaypointId: 'wp-01',
  targetId: DEFAULT_TARGET_ID,
  targetStayMinutes: BUDGET_CONFIG.targetStayMinutes,
  reserveMinutes: BUDGET_CONFIG.reserveMinutes,
  highlightSegment: null,
  selectedWaypointId: null,
  selectedSandFeatureId: null,
  duneNoGoAssumption: false,
  showCandidateOverlay: true,
  briefOpen: false,
  layers: DEFAULT_LAYERS,
  slopeOverlay: false,
  slopeOpacity: 0.55,
  shieldingOverlay: false,
  shieldingOpacity: 0.7,
  radiationScenarioId: 'background_gcr',
  radiationComponent: 'total',
  coordinate: null,
  focus: null,

  addPoint: (lon, lat) =>
    set((state) => ({
      presetRouteId: null,
      highlightSegment: null,
      route: [...state.route, { id: newId(), lon, lat }],
    })),

  addWaypoint: (waypoint) =>
    set((state) => {
      if (state.route.some((point) => point.waypointId === waypoint.id)) return state
      return {
        presetRouteId: null,
        highlightSegment: null,
        route: [
          ...state.route,
          { id: newId(), lon: waypoint.lon, lat: waypoint.lat, waypointId: waypoint.id },
        ],
      }
    }),

  loadPresetRoute: (id) => {
    const preset = PRESET_ROUTES.find((route) => route.id === id)
    if (!preset) return
    set({
      presetRouteId: id,
      route: routeFromPreset(id),
      targetId: preset.targetId,
      highlightSegment: null,
    })
  },

  loadPlannedRoute: (waypoints, targetId, startWaypointId, endWaypointId) => {
    set({
      presetRouteId: null,
      targetId,
      highlightSegment: null,
      route: waypoints.map((point, index) => ({
        id: `planned-${index}-${newId()}`,
        lon: point.lon,
        lat: point.lat,
        waypointId:
          index === 0 ? startWaypointId : index === waypoints.length - 1 ? endWaypointId : undefined,
      })),
    })
  },

  undo: () => set((state) => ({ route: state.route.slice(0, -1), presetRouteId: null, highlightSegment: null })),
  clear: () => set({ route: [], presetRouteId: null, highlightSegment: null }),
  setStartWaypointId: (startWaypointId) => set({ startWaypointId }),
  setTarget: (targetId) => set({ targetId }),
  setTargetStayMinutes: (targetStayMinutes) => set({ targetStayMinutes }),
  setReserveMinutes: (reserveMinutes) => set({ reserveMinutes }),
  setHighlightSegment: (highlightSegment) => set({ highlightSegment }),
  selectWaypoint: (selectedWaypointId) => set({ selectedWaypointId }),
  selectSandFeature: (selectedSandFeatureId) => set({ selectedSandFeatureId }),
  setDuneNoGoAssumption: (duneNoGoAssumption) => set({ duneNoGoAssumption }),
  setShowCandidateOverlay: (showCandidateOverlay) => set({ showCandidateOverlay }),
  setBriefOpen: (briefOpen) => set({ briefOpen }),

  toggleLayer: (id) =>
    set((state) => {
      const current = state.layers[id] ?? { visible: false, opacity: 0.65 }
      const next = { ...state.layers, [id]: { ...current, visible: !current.visible } }
      if (!Object.values(next).some((layer) => layer.visible)) return state
      return { layers: next }
    }),

  setLayerOpacity: (id, opacity) =>
    set((state) => {
      const current = state.layers[id] ?? { visible: false, opacity: 0.65 }
      return { layers: { ...state.layers, [id]: { ...current, opacity } } }
    }),

  setSlopeOverlay: (slopeOverlay) => set({ slopeOverlay }),
  setSlopeOpacity: (slopeOpacity) => set({ slopeOpacity }),
  setShieldingOverlay: (shieldingOverlay) => set({ shieldingOverlay }),
  setShieldingOpacity: (shieldingOpacity) => set({ shieldingOpacity }),
  setRadiationScenarioId: (radiationScenarioId) => set({ radiationScenarioId }),
  setRadiationComponent: (radiationComponent) => set({ radiationComponent }),
  setCoordinate: (coordinate) => set({ coordinate }),
  centerOn: (lon, lat) => set({ focus: { lon, lat, nonce: Date.now() } }),

  initLayers: (layers) =>
    set((state) => {
      const next = { ...state.layers }
      for (const layer of layers) {
        if (!next[layer.id]) next[layer.id] = { visible: false, opacity: 1 }
      }
      return { layers: next }
    }),
}))
