import { create } from 'zustand'
import type { LayerId, LonLat, MapLayer, PresetRouteId, RoutePoint, Waypoint } from '@/types'
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
}

interface MissionState {
  route: RoutePoint[]
  presetRouteId: PresetRouteId | null
  targetId: string
  targetStayMinutes: number
  reserveMinutes: number
  highlightSegment: { from: LonLat; to: LonLat } | null
  selectedWaypointId: string | null
  briefOpen: boolean
  layers: Record<LayerId, LayerState>
  slopeOverlay: boolean
  slopeOpacity: number
  coordinate: CoordinateReadout | null
  focus: { lon: number; lat: number; nonce: number } | null
  addPoint: (lon: number, lat: number) => void
  addWaypoint: (waypoint: Waypoint) => void
  loadPresetRoute: (id: PresetRouteId) => void
  undo: () => void
  clear: () => void
  setTarget: (targetId: string) => void
  setTargetStayMinutes: (minutes: number) => void
  setReserveMinutes: (minutes: number) => void
  setHighlightSegment: (segment: { from: LonLat; to: LonLat } | null) => void
  selectWaypoint: (id: string | null) => void
  setBriefOpen: (open: boolean) => void
  toggleLayer: (id: LayerId) => void
  setLayerOpacity: (id: LayerId, opacity: number) => void
  setSlopeOverlay: (visible: boolean) => void
  setSlopeOpacity: (opacity: number) => void
  setCoordinate: (readout: CoordinateReadout | null) => void
  centerOn: (lon: number, lat: number) => void
  initLayers: (layers: MapLayer[]) => void
}

const DEFAULT_LAYERS: Record<LayerId, LayerState> = {
  optical: { visible: true, opacity: 1 },
  topography: { visible: true, opacity: 0.55 },
  geology: { visible: true, opacity: 0.45 },
  thermal: { visible: false, opacity: 0.6 },
  mineralogy: { visible: false, opacity: 0.75 },
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
  route: [],
  presetRouteId: null,
  targetId: DEFAULT_TARGET_ID,
  targetStayMinutes: BUDGET_CONFIG.targetStayMinutes,
  reserveMinutes: BUDGET_CONFIG.reserveMinutes,
  highlightSegment: null,
  selectedWaypointId: null,
  briefOpen: false,
  layers: DEFAULT_LAYERS,
  slopeOverlay: false,
  slopeOpacity: 0.55,
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

  undo: () => set((state) => ({ route: state.route.slice(0, -1), presetRouteId: null, highlightSegment: null })),
  clear: () => set({ route: [], presetRouteId: null, highlightSegment: null }),
  setTarget: (targetId) => set({ targetId, presetRouteId: null }),
  setTargetStayMinutes: (targetStayMinutes) => set({ targetStayMinutes }),
  setReserveMinutes: (reserveMinutes) => set({ reserveMinutes }),
  setHighlightSegment: (highlightSegment) => set({ highlightSegment }),
  selectWaypoint: (selectedWaypointId) => set({ selectedWaypointId }),
  setBriefOpen: (briefOpen) => set({ briefOpen }),

  toggleLayer: (id) =>
    set((state) => {
      const next = { ...state.layers, [id]: { ...state.layers[id], visible: !state.layers[id].visible } }
      if (!Object.values(next).some((layer) => layer.visible)) return state
      return { layers: next }
    }),

  setLayerOpacity: (id, opacity) =>
    set((state) => ({ layers: { ...state.layers, [id]: { ...state.layers[id], opacity } } })),

  setSlopeOverlay: (slopeOverlay) => set({ slopeOverlay }),
  setSlopeOpacity: (slopeOpacity) => set({ slopeOpacity }),
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
