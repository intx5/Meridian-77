import { ReturnByCard } from '@/components/ReturnByCard'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { EVA_ASSUMPTIONS, MIN_TRAVERSE_KM } from '@/config/eva'
import { sampleElevation, type RouteTerrain } from '@/domain/dem'
import { formatCoord, formatDuration, formatKm } from '@/domain/geo'
import type { EvaRadiationAssessment } from '@/domain/radiation'
import type {
  EvaResult,
  LayersManifest,
  MissionTarget,
  RasterGrid,
  ReturnBudget,
  RoutePoint,
  Waypoint,
} from '@/types'
import { useMissionStore } from '@/store/useMissionStore'

interface MissionBriefProps {
  manifest: LayersManifest
  dem: RasterGrid
  route: RoutePoint[]
  terrain: RouteTerrain
  eva: EvaResult
  budget: ReturnBudget
  target: MissionTarget | undefined
  targetWaypoint: Waypoint | null
  routeLabel: string
  cards: Waypoint[]
  radiation?: EvaRadiationAssessment
}

function Rule({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-[#c9bfae] py-1.5">
      <dt className="text-[10.5px] text-[#5d5549]">{label}</dt>
      <dd className="num font-mono text-[10.5px] text-[#14181b]">{value}</dd>
    </div>
  )
}

function SectionTitle({ children }: { children: string }) {
  return <h4 className="mb-2 border-b border-[#bfb5a4] pb-1 text-[10.5px] font-semibold text-[#14181b]">{children}</h4>
}

export function MissionBrief({
  manifest,
  dem,
  route,
  terrain,
  eva,
  budget,
  target,
  targetWaypoint,
  routeLabel,
  cards,
  radiation,
}: MissionBriefProps) {
  const briefOpen = useMissionStore((state) => state.briefOpen)
  const setBriefOpen = useMissionStore((state) => state.setBriefOpen)
  const routeCards = cards.filter((card) => route.some((point) => point.waypointId === card.id))
  const hasMeasuredRoute = terrain.totalKm >= MIN_TRAVERSE_KM
  const hasReturnPlan = hasMeasuredRoute && !budget.dataInsufficient && budget.targetReachable
  const generated = new Date().toISOString().slice(0, 10)
  const verdictColor =
    eva.verdict === 'GO'
      ? '#2f7d4f'
      : eva.verdict === 'CAUTION' || eva.verdict === 'INSUFFICIENT DATA'
        ? '#8a6415'
        : '#a63a24'

  return (
    <Dialog open={briefOpen} onOpenChange={setBriefOpen}>
      <DialogContent
        title="Mission brief"
        description="Printable traverse sheet with assessment, route ledger, stations and provenance."
        className="brief-paper max-w-[840px]"
      >
        <div className="print-brief">
          <header className="flex items-start justify-between gap-8 border-b border-[#bfb5a4] pb-4">
            <div>
              <p className="meta text-[#6b6153]">Meridian 77 / EVA brief</p>
              <h3 className="mt-1 text-[24px] font-semibold leading-tight tracking-[-0.02em] text-[#14181b]">
                {manifest.region.name}
              </h3>
              <p className="mt-1 max-w-[52ch] text-[10px] leading-relaxed text-[#5d5549]">
                {manifest.region.coordinateSystem}
              </p>
            </div>
            <div className="shrink-0 text-right">
              <p className="meta">generated {generated}</p>
              <p className="mt-1 text-[12px] font-medium text-[#14181b]">{target?.name ?? 'No objective'}</p>
              <p className="meta mt-0.5">
                {route.length} route points / {cards.length} cards
              </p>
            </div>
          </header>

          <div className="mt-4">
            <ReturnByCard
              routeLabel={routeLabel}
              target={target}
              targetWaypoint={targetWaypoint ?? undefined}
              budget={budget}
              verdict={eva.verdict}
              ready={hasMeasuredRoute}
              onOpenBrief={() => undefined}
              showPrintButton={false}
            />
          </div>

          <section className="mt-5 border-b border-[#bfb5a4] pb-4">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="meta">verdict</p>
                <p
                  className="mt-1 text-[42px] font-semibold leading-[0.9] tracking-[-0.045em]"
                  style={{ color: verdictColor }}
                >
                  {route.length >= 2 ? eva.verdict : 'NO ROUTE'}
                </p>
              </div>
              <div className="flex-1 basis-[260px]">
                <p className="text-[11px] leading-relaxed text-[#4a4338]">
                  {route.length >= 2 ? eva.verdictReason : 'Place at least two route points before issuing a plan.'}
                </p>
              </div>
              <div className="text-right">
                <p className="meta">
                  safety {eva.safetyScore} / science {eva.scienceScore}
                </p>
                <p className="num font-mono text-[16px] text-[#14181b]">{eva.compositeScore}</p>
              </div>
            </div>
          </section>

          <div className="mt-5 grid gap-x-10 gap-y-6 sm:grid-cols-2">
            <section>
              <SectionTitle>Route summary</SectionTitle>
              <dl>
                <Rule label="Distance" value={formatKm(eva.distanceKm)} />
                <Rule label="Outbound time" value={formatDuration(budget.outboundHours)} />
                <Rule label="Intermediate sampling" value={`${budget.scienceStopMinutes} min`} />
                <Rule label="Return time" value={formatDuration(budget.returnHours)} />
                <Rule label="Target stay" value={`${budget.targetStayMinutes} min`} />
                <Rule label="Max target stay" value={hasReturnPlan ? `${budget.maxTargetStayMinutes} min` : '—'} />
                <Rule label="Latest departure" value={hasReturnPlan ? budget.latestDeparture : '—'} />
                <Rule label="Latest return" value={hasReturnPlan ? budget.latestReturn : '—'} />
                <Rule label="Total mission" value={formatDuration(budget.totalHours)} />
                <Rule label="Return margin" value={formatDuration(budget.marginHours)} />
                <Rule label="Ascent / descent" value={`+${terrain.elevationGainM} / −${terrain.elevationLossM} m`} />
                <Rule label="Maximum slope" value={`${terrain.maxSlopeDeg.toFixed(1)}°`} />
                <Rule label="Mean slope" value={`${terrain.meanSlopeDeg.toFixed(1)}°`} />
                <Rule label="Sampling stops" value={`${eva.stopCount}`} />
                <Rule label="Hazards" value={`${eva.hazardCount}`} />
                <Rule label="DEM coverage" value={`${Math.round((1 - terrain.unknownFraction) * 100)}%`} />
              </dl>
            </section>

            <section>
              <SectionTitle>Score ledger</SectionTitle>
              <ul>
                {eva.breakdown.map((item) => (
                  <li
                    key={item.factor}
                    className="flex items-baseline justify-between gap-3 border-b border-[#c9bfae] py-1.5"
                  >
                    <span className="text-[10.5px] text-[#4a4338]">
                      {item.factor} <span className="num font-mono text-[9.5px]">{item.value}</span>
                    </span>
                    <span className="num font-mono text-[10px] text-[#14181b]">{item.penalty}</span>
                  </li>
                ))}
              </ul>
            </section>
          </div>

          {radiation ? (
            <section className="mt-6">
              <SectionTitle>Environmental radiation exposure estimate</SectionTitle>
              <dl className="grid gap-x-10 sm:grid-cols-2">
                <Rule label="Scenario" value={radiation.scenarioLabel} />
                <Rule label="Measurement / model status" value={radiation.measurementVsModelLabel} />
                <Rule
                  label="Reference absorbed dose rate"
                  value={`${radiation.referenceDoseRateMicroGyPerHour.toFixed(2)} µGy/h`}
                />
                <Rule
                  label="Total modeled EVA exposure"
                  value={
                    radiation.status === 'OK'
                      ? `${radiation.totalModeledExposureMicroGy.toFixed(2)} µGy (±${radiation.uncertaintyPercent}%)`
                      : 'Insufficient route data'
                  }
                />
                <Rule
                  label="Outbound + stops exposure"
                  value={
                    radiation.status === 'OK'
                      ? `${radiation.estimatedRouteExposureMicroGy.toFixed(2)} µGy`
                      : '—'
                  }
                />
                <Rule
                  label="Return walk exposure"
                  value={radiation.status === 'OK' ? `${radiation.returnExposureMicroGy.toFixed(2)} µGy` : '—'}
                />
              </dl>
              <p className="mt-2 text-[9.5px] leading-relaxed text-[#5d5549]">
                Reference origin: {radiation.referenceOrigin} ({radiation.referenceDateRange}). Values represent an
                unshielded surface environmental estimate transferred from Gale Crater, not an in-situ Jezero
                measurement or biological organ dose.
              </p>
            </section>
          ) : null}

          <section className="mt-6">
            <SectionTitle>Route points</SectionTitle>
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-[#bfb5a4]">
                  {['#', 'Point', 'Longitude', 'Latitude', 'Elevation'].map((heading) => (
                    <th key={heading} className="py-1 pr-3 text-[9px] font-normal text-[#6b6153]">
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {route.map((point, index) => {
                  const card = cards.find((item) => item.id === point.waypointId)
                  const elevation = sampleElevation(dem, point.lon, point.lat)
                  return (
                    <tr key={point.id} className="border-b border-[#d6ccbb]">
                      <td className="num py-1 pr-3 font-mono text-[10px] text-[#6b6153]">
                        {String(index + 1).padStart(2, '0')}
                      </td>
                      <td className="py-1 pr-3 text-[10.5px] text-[#14181b]">{card?.name ?? 'Route point'}</td>
                      <td className="num py-1 pr-3 font-mono text-[10px] text-[#14181b]">
                        {formatCoord(point.lon, 'lon')}
                      </td>
                      <td className="num py-1 pr-3 font-mono text-[10px] text-[#14181b]">
                        {formatCoord(point.lat, 'lat')}
                      </td>
                      <td className="num py-1 font-mono text-[10px] text-[#14181b]">
                        {elevation === null ? 'unknown' : `${elevation.toFixed(0)} m`}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </section>

          {routeCards.length ? (
            <section className="mt-6">
              <SectionTitle>Science stations</SectionTitle>
              <ul className="space-y-2">
                {routeCards.map((card) => (
                  <li key={card.id} className="text-[10.5px] leading-relaxed text-[#4a4338]">
                    <span className="font-medium text-[#14181b]">{card.name}</span>
                    <span className="meta ml-2">
                      {formatCoord(card.lon, 'lon')} {formatCoord(card.lat, 'lat')}
                    </span>
                    <br />
                    {card.note}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <div className="mt-6 grid gap-x-10 gap-y-6 sm:grid-cols-2">
            <section>
              <SectionTitle>Data sources</SectionTitle>
              <ul className="space-y-2">
                {manifest.layers.map((layer) => (
                  <li key={layer.id} className="text-[9.5px] leading-relaxed text-[#4a4338]">
                    <span className="font-medium text-[#14181b]">{layer.label}</span> · {layer.resolution}
                    <br />
                    <span className="break-all">{layer.sourceUrl}</span>
                  </li>
                ))}
                <li className="text-[9.5px] leading-relaxed text-[#4a4338]">
                  <span className="font-medium text-[#14181b]">Elevation</span> · {manifest.elevation.verticalReference}
                  <br />
                  <span className="break-all">{manifest.elevation.sourceUrl}</span>
                </li>
              </ul>
            </section>

            <section>
              <SectionTitle>Assumptions</SectionTitle>
              <ul className="space-y-1.5">
                {EVA_ASSUMPTIONS.map((assumption) => (
                  <li key={assumption} className="border-l border-[#bfb5a4] pl-2.5 text-[9.5px] leading-relaxed text-[#4a4338]">
                    {assumption}
                  </li>
                ))}
              </ul>
            </section>
          </div>

          <footer className="mt-6 flex items-end justify-between gap-6 border-t border-[#bfb5a4] pt-3">
            <p className="max-w-[62ch] text-[9px] leading-relaxed text-[#6b6153]">
              Meridian 77 is a planning aid built with local NASA, USGS and ASU data. It is not flight software, a
              certified traverse plan, or a substitute for mission operations review.
            </p>
            <Button variant="outline" size="sm" onClick={() => window.print()} className="no-print shrink-0">
              Print / PDF
            </Button>
          </footer>
        </div>
      </DialogContent>
    </Dialog>
  )
}
