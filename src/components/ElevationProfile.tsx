import { useMemo } from 'react'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { RouteTerrain } from '@/domain/dem'

const MAX_POINTS = 420

export function ElevationProfile({ terrain }: { terrain: RouteTerrain }) {
  const data = useMemo(() => {
    const valid = terrain.samples.filter((sample) => sample.distanceKm >= 0)
    const step = Math.max(1, Math.ceil(valid.length / MAX_POINTS))
    return valid
      .filter((_, index) => index % step === 0 || index === valid.length - 1)
      .map((sample) => ({
        km: Number(sample.distanceKm.toFixed(3)),
        elevation: sample.elevationM === null ? null : Number(sample.elevationM.toFixed(1)),
      }))
  }, [terrain.samples])

  const elevations = terrain.samples.map((sample) => sample.elevationM).filter((value): value is number => value !== null)
  const min = elevations.length ? Math.min(...elevations) : null
  const max = elevations.length ? Math.max(...elevations) : null

  if (!data.length || terrain.totalKm === 0) {
    return (
      <section aria-labelledby="profile-heading" className="mt-4 border-t border-line pt-3">
        <div className="flex items-baseline justify-between">
          <h2 id="profile-heading" className="heading">
            Terrain profile
          </h2>
        </div>
        <p className="mt-2 text-[10.5px] text-faint">A second point samples the elevation profile.</p>
      </section>
    )
  }

  return (
    <section aria-labelledby="profile-heading" className="mt-4 border-t border-line pt-3">
      <div className="flex items-baseline justify-between">
        <h2 id="profile-heading" className="heading">
          Terrain profile
        </h2>
        <span className="meta tabular-nums">
          {min !== null && max !== null ? `${min.toFixed(0)} to ${max.toFixed(0)} m` : ''} · {terrain.totalKm.toFixed(2)} km
        </span>
      </div>
      <div
        className="mt-2 h-[150px] w-full"
        role="img"
        aria-label="Route elevation in metres against distance in kilometres"
      >
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 6, right: 2, left: -26, bottom: 0 }}>
            <CartesianGrid stroke="#1c2730" vertical={false} />
            <XAxis
              dataKey="km"
              type="number"
              domain={[0, 'dataMax']}
              tick={{ fill: '#5e6c77', fontSize: 8, fontFamily: 'ui-monospace, monospace' }}
              tickLine={false}
              axisLine={{ stroke: '#1c2730' }}
              tickFormatter={(value: number) => value.toFixed(1)}
            />
            <YAxis
              domain={['auto', 'auto']}
              tick={{ fill: '#5e6c77', fontSize: 8, fontFamily: 'ui-monospace, monospace' }}
              tickLine={false}
              axisLine={false}
              width={44}
            />
            <Tooltip
              contentStyle={{
                background: '#06080a',
                border: '1px solid #2e3d49',
                borderRadius: 2,
                fontSize: 10,
                fontFamily: 'ui-monospace, monospace',
              }}
              labelStyle={{ color: '#93a1ac' }}
              formatter={(value) => [`${value ?? '—'} m`, 'elevation']}
              labelFormatter={(value) => `${Number(value).toFixed(2)} km`}
            />
            <Area
              type="monotone"
              dataKey="elevation"
              stroke="#ff6b3d"
              strokeWidth={1.5}
              fill="#ff6b3d"
              fillOpacity={0.07}
              connectNulls={false}
              isAnimationActive={false}
              dot={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <p className="meta mt-1">distance km / elevation m, Mars areoid</p>
    </section>
  )
}
