import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import type { LayersManifest, RadiationComponentId, RadiationScenarioId } from '@/types'
import { useMissionStore } from '@/store/useMissionStore'

const RADIATION_LEGENDS: Record<string, { label: string; color: string }[]> = {
  'background_gcr:total': [
    { label: 'Lower crater floor (~-2650 m · ~10.4 µGy/h · Lowest)', color: '#7c2d12' },
    { label: 'Mid-elevation delta (~-2450 m · ~10.6 µGy/h)', color: '#ea580c' },
    { label: 'Higher elevation rim (~-2100 m · ~10.8 µGy/h · Highest)', color: '#facc15' },
  ],
  'sep_sep2017:total': [
    { label: 'Lower floor / scarp base (~19.8 µGy/h · Lowest)', color: '#7f1d1d' },
    { label: 'Delta & open plains (~21.6 µGy/h 6h storm mean)', color: '#ef4444' },
    { label: 'Exposed high rim (~22.4 µGy/h, peak 25.9 µGy/h · Highest)', color: '#fde047' },
  ],
  gcr_only: [
    { label: 'Deep crater floor (~-2650 m · ~10.4 µGy/h GCR · Lowest)', color: '#065f46' },
    { label: 'Mid-elevation delta (~-2450 m · ~10.6 µGy/h GCR)', color: '#10b981' },
    { label: 'High-elevation rim (~-2100 m · ~10.8 µGy/h GCR · Highest)', color: '#fde047' },
  ],
  sep_only: [
    { label: 'Scarp/cliff shadow alcove (+8.9 µGy/h SEP · Lowest)', color: '#4c1d95' },
    { label: 'Moderate sky view (+11.1 µGy/h SEP surge)', color: '#d946ef' },
    { label: 'Exposed open sky & rim (+11.6 µGy/h SEP · Highest)', color: '#fda4af' },
  ],
}

function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <ul className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
      {items.map((item) => (
        <li key={`${item.label}-${item.color}`} className="flex items-center gap-1.5 text-[9.5px] text-muted">
          <span className="h-[7px] w-[7px] shrink-0" style={{ backgroundColor: item.color }} aria-hidden />
          {item.label}
        </li>
      ))}
    </ul>
  )
}

export function LayerPanel({ manifest }: { manifest: LayersManifest }) {
  const layers = useMissionStore((state) => state.layers)
  const toggleLayer = useMissionStore((state) => state.toggleLayer)
  const setLayerOpacity = useMissionStore((state) => state.setLayerOpacity)
  const slopeOverlay = useMissionStore((state) => state.slopeOverlay)
  const slopeOpacity = useMissionStore((state) => state.slopeOpacity)
  const setSlopeOverlay = useMissionStore((state) => state.setSlopeOverlay)
  const setSlopeOpacity = useMissionStore((state) => state.setSlopeOpacity)
  const shieldingOverlay = useMissionStore((state) => state.shieldingOverlay)
  const shieldingOpacity = useMissionStore((state) => state.shieldingOpacity)
  const setShieldingOverlay = useMissionStore((state) => state.setShieldingOverlay)
  const setShieldingOpacity = useMissionStore((state) => state.setShieldingOpacity)
  const radiationScenarioId = useMissionStore((state) => state.radiationScenarioId)
  const setRadiationScenarioId = useMissionStore((state) => state.setRadiationScenarioId)
  const radiationComponent = useMissionStore((state) => state.radiationComponent)
  const setRadiationComponent = useMissionStore((state) => state.setRadiationComponent)
  const visibleCount = Object.values(layers).filter((layer) => layer.visible).length

  return (
    <section aria-labelledby="layers-heading">
      <div className="flex items-baseline justify-between">
        <h2 id="layers-heading" className="heading">
          Overlays
        </h2>
        <span className="meta">{manifest.layers.length} channels</span>
      </div>

      <div className="mt-2">
        {manifest.layers.map((layer) => {
          const state = layers[layer.id] ?? { visible: false, opacity: 0.65 }
          const locked = visibleCount === 1 && state.visible
          return (
            <div key={layer.id} className="border-t border-line py-3">
              <div className="flex items-center justify-between gap-3">
                <label htmlFor={`layer-${layer.id}`} className="min-w-0 cursor-pointer">
                  <span className="block truncate text-[12px] text-ink">{layer.label}</span>
                  <span className="meta mt-0.5 block">
                    {layer.resolution}
                    {layer.units ? ` · ${layer.units}` : ''}
                  </span>
                </label>
                <Switch
                  id={`layer-${layer.id}`}
                  checked={state.visible}
                  disabled={locked}
                  onCheckedChange={() => toggleLayer(layer.id)}
                  aria-label={`Toggle ${layer.label}`}
                  title={locked ? 'At least one overlay stays on' : undefined}
                />
              </div>

              {state.visible ? (
                <div className="mt-2 flex items-center gap-2">
                  <Slider
                    label={`${layer.label} opacity`}
                    value={state.opacity}
                    onValueChange={(value) => setLayerOpacity(layer.id, value)}
                  />
                  <span className="meta w-7 text-right tabular-nums">{Math.round(state.opacity * 100)}%</span>
                </div>
              ) : null}

              <Legend
                items={
                  layer.id === 'radiation'
                    ? (RADIATION_LEGENDS[
                        radiationComponent === 'total'
                          ? `${radiationScenarioId}:total`
                          : radiationComponent
                      ] ?? layer.legend)
                    : layer.legend
                }
              />

              {layer.id === 'topography' && layer.overlay ? (
                <div className="mt-2.5 border-l border-line pl-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10.5px] text-muted">{layer.overlay.label}</span>
                    <Switch
                      checked={slopeOverlay}
                      onCheckedChange={setSlopeOverlay}
                      aria-label="Toggle slope overlay"
                    />
                  </div>
                  {slopeOverlay ? (
                    <div className="mt-1.5 flex items-center gap-2">
                      <Slider label="Slope overlay opacity" value={slopeOpacity} onValueChange={setSlopeOpacity} />
                      <span className="meta w-7 text-right tabular-nums">{Math.round(slopeOpacity * 100)}%</span>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {layer.id === 'radiation' ? (
                <div className="mt-2.5 space-y-2 border-l border-line pl-3">
                  <div className="grid grid-cols-2 gap-1.5">
                    <label className="block">
                      <span className="meta mb-0.5 block text-[8.5px]">Scenario</span>
                      <select
                        aria-label="Radiation scenario"
                        value={radiationScenarioId}
                        onChange={(e) => {
                          const nextScenario = e.target.value as RadiationScenarioId
                          setRadiationScenarioId(nextScenario)
                          if (!state.visible) toggleLayer('radiation')
                        }}
                        className="input h-6 w-full px-1 text-[9.5px]"
                      >
                        <option value="background_gcr">Background GCR</option>
                        <option value="sep_sep2017">Sep 2017 SEP Event</option>
                      </select>
                    </label>
                    <label className="block">
                      <span className="meta mb-0.5 block text-[8.5px]">Radiation Component</span>
                      <select
                        aria-label="Radiation component"
                        value={radiationComponent}
                        onChange={(e) => {
                          const nextComp = e.target.value as RadiationComponentId
                          setRadiationComponent(nextComp)
                          if (nextComp === 'sep_only' && radiationScenarioId === 'background_gcr') {
                            setRadiationScenarioId('sep_sep2017')
                          }
                          if (!state.visible) toggleLayer('radiation')
                        }}
                        className="input h-6 w-full px-1 text-[9.5px]"
                      >
                        <option value="total">Total (GCR + SEP)</option>
                        <option value="gcr_only">GCR Only</option>
                        <option value="sep_only">SEP Surge Only</option>
                      </select>
                    </label>
                  </div>

                  <div className="space-y-1 border-y border-line/70 py-1.5 font-mono text-[8.5px] text-muted">
                    <div className="flex justify-between gap-2">
                      <span className="text-faint">Data Source</span>
                      <span className="truncate text-ink">NASA PDS MSL-M-RAD-3-RDR-V1.0</span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-faint">Measurement / Model Status</span>
                      <span className="text-caution">Gale Measured → Jezero Model</span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-faint">Model Assumptions</span>
                      <span className="truncate text-ink">Uniform regional col. (&lt;4.5% Δ)</span>
                    </div>
                  </div>

                  {layer.overlay ? (
                    <div className="pt-0.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[10px] text-muted">{layer.overlay.label}</span>
                        <Switch
                          checked={shieldingOverlay}
                          onCheckedChange={setShieldingOverlay}
                          aria-label="Toggle Terrain Shielding Potential — Experimental"
                        />
                      </div>
                      {shieldingOverlay ? (
                        <div className="mt-1.5 flex items-center gap-2">
                          <Slider
                            label="Terrain Shielding Potential opacity"
                            value={shieldingOpacity}
                            onValueChange={setShieldingOpacity}
                          />
                          <span className="meta w-7 text-right tabular-nums">
                            {Math.round(shieldingOpacity * 100)}%
                          </span>
                        </div>
                      ) : null}
                      <Legend items={layer.overlay.legend} />
                    </div>
                  ) : null}
                </div>
              ) : null}

              <p className="mt-2 line-clamp-2 text-[9.5px] leading-snug text-faint">
                {layer.note}
                {layer.coveragePercent !== undefined ? ` Coverage ${layer.coveragePercent}%.` : ''}
              </p>
              <a
                href={layer.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="meta mt-1 inline-block text-signal no-underline hover:underline"
              >
                source
              </a>
            </div>
          )
        })}
      </div>
    </section>
  )
}
