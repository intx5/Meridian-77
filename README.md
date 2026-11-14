# Meridian 77 · Jezero EVA Planner

A local-first web planner for a six-hour astronaut traverse across the Jezero delta front. Optical, topographic, thermal-inertia and CRISM mineral-indicator layers share one projection; a clicked route is sampled against the DEM and returns distance, time, elevation, slope, hazards and an explainable GO / CAUTION / NO-GO verdict.

Built from the brief in `proje.txt`. Not NASA software and not flight-certified.

## Visual direction

The interface is a traverse sheet rather than a dashboard: the terrain is full-bleed, the two rails are ruled columns without a card kit, and system sans carries hierarchy while monospace is reserved for measured values and coordinates. Orange marks the traverse and the decision; pale blue marks data. Route points are numbered survey pins, stations read as a ledger, and the verdict is a stamped plate with a scored ruler. The printable brief switches to paper, which is also what `@media print` produces. The only decorative detail is the registration ticks around the map.

## Run

```bash
npm install
npm run dev        # http://127.0.0.1:5173
```

Production:

```bash
npm run build
npm run preview    # http://127.0.0.1:4173
```

Every image, DEM, thermal grid and mineral grid is served from `public/data/jezero`; there are no map tiles, CDNs or runtime APIs. The station links open NASA/USGS pages but are not needed to use the planner.

## What works

- **Map**: Leaflet `CRS.Simple` over the Jezero delta-front mosaic, graticule, hover coordinates with DEM elevation, Mars scale bar, zoom, recenter. The map refits after the panel reaches its final size and on resize.
- **Layers**: five manifest-driven layers (optical, topography with slope overlay, USGS geology, thermal inertia, mineralogy). Each has a switch, opacity control, legend, coverage note and source link. The last visible layer cannot be switched off.
- **Route comparison**: two pre-planned routes between the same start (Octavia E. Butler Landing) and science target (Skinner Ridge). Side-by-side total mission time, maximum slope, return margin and verdict. Selecting Route A or Route B loads it into the map and field card; the other route stays visible as a dim reference.
- **Route**: click the map or enter planetocentric lon/lat. Clicked markers do not add points. Undo and clear. Intermediate terrain is sampled every ~9 m; no-data cells become dashed unknown segments.
- **Analysis**: haversine distance on the Mars mean radius (3389.5 km), walk time plus 20 minutes per science stop, ascent/descent, max/mean slope, hazard count, elevation AreaChart.
- **EVA score**: safety (slope, duration, DEM coverage, thermal inertia) and science (mineral diversity, science stops, target proximity), weighted 60/40. Every penalty is listed with a reason. The slope row links to the steepest segment on the map. Assumptions are visible in the UI.
- **Return budget**: outbound + target stay + return + reserve against a 6 h EVA. The jury slider changes the target stay; the card shows the maximum stay that still preserves the reserve, the latest departure and the latest return. Exceeding the max stay turns the card NO-GO and marks the budget bar.
- **Return-by card**: paper field card with the real Perseverance target frame, geology unit, max stay, latest departure/return and a budget bar. `INSUFFICIENT DATA` is shown when the route crosses no-data terrain.
- **Science cards**: four real Perseverance traverse positions with NASA/JPL-Caltech/ASU/MSSS surface frames, including the sol 14 Hazcam frame at Octavia E. Butler Landing, measured CRISM 2.30 µm band depth, thermal inertia, DEM elevation and USGS map unit. They can be centered, added to the route and inspected in a dialog.
- **Mission brief**: printable modal with the return-by card, route table, verdict, score breakdown, return-budget rows, science stations, sources and assumptions. Uses `window.print()`, no PDF library.
- **Responsive**: 64 px header, 280 px tool column, map, 320 px analysis column on wide screens; stacked 60vh map and panels on mobile. Keyboard focus rings, accessible switches, sliders and dialogs.

Optional 3D, automatic path finding, astronaut HUD, turnaround point and a second region from the brief's stretch list are not included. The core flow shipped first; 3D in particular is gated behind the brief's "do not start before core" rule.

## Data

| Product | Use | Native resolution | Source |
| --- | --- | --- | --- |
| HiRISE/CTX orthomosaic | Optical | 2 projected m/px | [USGS Astrogeology](https://astrogeology.usgs.gov/search/map/Mars/Mars2020/JEZ_hirise_soc_006_orthoMosaic_25cm_Eqc_latTs0_lon0_first) |
| Mars 2020 DEM mosaic | Elevation, hillshade, slope | 9.77 m display grid | [Murray Lab, Caltech](https://murray-lab.caltech.edu/Mars2020/index.html) |
| USGS Jezero geologic map | Geology layer and target-unit context | 1:75,000 | [USGS](https://www.usgs.gov/maps/geologic-map-jezero-crater-and-nili-planum-region-mars) |
| THEMIS quantitative thermal inertia | Thermal layer and hazard assumption | 100 m source, warped to 19.5 m display grid | [THEMIS TI mosaic](https://murray-lab.caltech.edu/Mars2020/data/ThemisTI/THEMIS_TI_Quantitative.zip) |
| CRISM HRL000040FF MTRDR | 2.30 µm absorption indicator | 36 m | [PDS Geosciences](https://pds-geosciences.wustl.edu/mro/mro-m-crism-5-rdr-mptargeted-v1/mrocr_2101/data/hrl000040ff/hrl000040ff_07_if183j_mtr3.img) |
| USGS Jezero geologic map | Map unit on science cards | 1:75,000 | [USGS](https://www.usgs.gov/maps/geologic-map-jezero-crater-and-nili-planum-region-mars) |
| Perseverance traverse GeoJSON | Waypoint coordinates | — | NASA Mars 2020 traverse path |
| Mastcam-Z frames and PIA24921 panorama | Surface views | — | NASA/JPL-Caltech/ASU/MSSS |

All layers use the region bounds `[77.2944, 18.3940, 77.4631, 18.5627]` (planetocentric east longitude, equirectangular sphere 3,396,190 m). Distance calculations deliberately use the volumetric mean radius 3,389.5 km, not the projection sphere.

### Generated data

`scripts/prepare_rasters.py` and `scripts/prepare_waypoints.py` regenerate the thermal/mineral grids, colorized webp overlays, waypoint JSON and surface images. They need Python 3 with `numpy` and `Pillow`; generated artifacts are already committed in `public/data/jezero`.

`public/data/jezero/raster-provenance.json` records the CRISM bands, formula, thresholds and source coverage.

### Honest limits

- The mineralogy layer is **not** a mineral map. It is `1 - R(2.30 µm) / continuum(2.20–2.40 µm)` from one CRISM MTRDR scene. Positive values are candidate phyllosilicate absorptions; below 0.010 the pixels are transparent. It is not confirmed mineralogy or abundance.
- Thermal inertia is thermophysical context, not a measured temperature or a traversability rating. The THEMIS corridor covers 92.6% of the region; it is warped to the map grid, alpha-masked outside coverage and feathered at the corridor edge so it reads as an overlay rather than a pasted image.
- The DEM has 7.8% no-data coverage, concentrated on the eastern and north-western edges. Routes crossing it are marked unknown and cannot receive GO.
- Science-card imagery is from the rover sol stated on the card; the sol 464 panorama was assembled from frames taken on sols 466–474. Coordinates come from the traverse endpoint for that sol, and the card says so.
- The USGS map unit is sampled from the local geology raster; mineral context in card notes is regional context, not a point measurement.

## Planning assumptions

- Walking speed 1.5 km/h; each science or POV stop costs 20 minutes.
- Return follows the same route in reverse; the mission starts at 09:00 and keeps a 30 minute reserve.
- Maximum target stay = 6 h − outbound − return − reserve. Exceeding it is NO-GO.
- Slope ≥ 15° is a caution; ≥ 25° is a hard no-go. Any route above the caution threshold cannot be GO.
- More than 1.2× the 6 h budget is NO-GO; more than 5% unknown DEM coverage is `INSUFFICIENT DATA`.
- Thermal inertia above the regional 80th percentile (347.6 SI) marks a rocky-terrain hazard.
- Safety 60% / science 40% form the composite score.

These are product assumptions, shown in the interface and mission brief, not NASA standards.

## Verification

- `npm test` — 40 tests covering Mars distance, interpolation, bilinear DEM orientation/no-data, intermediate sampling, gain/loss, EVA thresholds, score bounds, over-budget and unknown-terrain cases, return-budget max stay/latest departure/latest return, preset-route geometry, data-contract validation and zero-length/nearby-target edges.
- `npm run build` and `npm run lint` pass.
- Lighthouse desktop snapshot: Accessibility 100, Best Practices 100, SEO 100.
- Browser checks on the production build: a 1.83 km route returns 1 h 13 min, +65/−62 m, 30.2° max slope and NO-GO; a 0.55 km gentle route returns GO with safety 100; a 15.1° route returns CAUTION; a fully no-data route returns NO-GO; the 403 SI card adds a thermal hazard and −8 safety; the last visible layer stays enabled; opacity changes propagate to the Leaflet overlay; Escape closes the science dialog; 390 px viewport has no horizontal overflow.

## Structure

```
src/
  components/      UI, map, route, EVA, cards, brief
  domain/          geo, DEM sampling, EVA scoring, data contract (+ tests)
  store/           Zustand mission state
  config/          region and science targets, assumptions
  types/
scripts/           reproducible raster and waypoint preparation
public/data/jezero local layers, DEM, waypoints, POV imagery
docs/              implementation plan and decisions
```
