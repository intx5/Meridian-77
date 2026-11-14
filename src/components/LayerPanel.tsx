import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import type { LayersManifest } from '@/types'
import { useMissionStore } from '@/store/useMissionStore'

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
          const state = layers[layer.id]
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

              <Legend items={layer.legend} />

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
