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

The planner serves its terrain, overlays and station imagery from `public/data/jezero`. Route ML analysis runs locally via `/api/ml/plan` using a pre-trained Random Forest + Ridge regression ensemble (`src/domain/jezeroRouteMlModel.json`) with no external API keys required.

## What works

- **Map**: Leaflet `CRS.Simple` over the Jezero delta-front mosaic, graticule, hover coordinates with DEM elevation, Mars scale bar, zoom, recenter. The map refits after the panel reaches its final size and on resize.
- **Layers**: optical, topography with slope, USGS geology, thermal inertia, mineralogy, sand and radiation. The radiation controls also include an experimental topographic sky-visibility overlay.
- **Route comparison**: two pre-planned routes between the same start (Octavia E. Butler Landing) and science target (Skinner Ridge). Side-by-side total mission time, maximum slope, return margin and verdict. Selecting Route A or Route B loads it into the map and field card; the other route stays visible as a dim reference.
- **Route**: click the map or enter planetocentric lon/lat. Clicked markers do not add points. Undo and clear. Intermediate terrain is sampled every ~9 m; no-data cells become dashed unknown segments.
- **Analysis**: haversine distance on the Mars mean radius (3389.5 km), walk time plus 20 minutes per science stop, ascent/descent, max/mean slope, hazard count, elevation AreaChart.
- **EVA score**: safety (slope, duration, DEM coverage, thermal inertia) and science (mineral diversity, science stops, target proximity), weighted 60/40. Every penalty is listed with a reason. The slope row links to the steepest segment on the map. Assumptions are visible in the UI.
- **Return budget**: outbound walk, intermediate sampling, target stay, return walk and reserve against a 6 h EVA. The card gives the maximum target stay that preserves the reserve and the latest departure and return. An over-budget stay produces NO-GO.
- **Return-by card**: paper field card with the real Perseverance target frame, geology unit, max stay, latest departure/return and a budget bar. `INSUFFICIENT DATA` is shown when the route crosses no-data terrain.
- **Science cards**: four real Perseverance traverse positions with NASA/JPL-Caltech/ASU/MSSS surface frames, including the sol 14 Hazcam frame at Octavia E. Butler Landing, measured CRISM 2.30 µm band depth, thermal inertia, DEM elevation and USGS map unit. They can be centered, added to the route and inspected in a dialog.
- **Mission brief**: printable modal with the return-by card, route table, verdict, score breakdown, return-budget rows, science stations, sources and assumptions. Uses `window.print()`, no PDF library.
- **Responsive**: 64 px header, 280 px tool column, map, 320 px analysis column on wide screens; stacked 60vh map and panels on mobile. Keyboard focus rings, accessible switches, sliders and dialogs.

- **3D terrain**: the 3D view shares the route and layer controls with the 2D map. Relief magnification affects rendering only. The local A* planner provides candidate routes in both views.

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
| Mastcam-Z frames and PIA24925 / PIA24921 mosaics | Surface views | — | NASA/JPL-Caltech/ASU/MSSS |
| MSL Curiosity RAD RDR (`MSL-M-RAD-3-RDR-V1.0`) | Surface ionizing radiation reference (GCR baseline & Sep 2017 GLE 72 SEP event) | Regional reference (Gale Crater -> Jezero estimate) | [NASA PDS PPI](https://pds-ppi.igpp.ucla.edu/collection/MSL-M-RAD-3-RDR-V1.0) |
| MAVEN SEP (`maven.sep.calibrated`) & DEM Horizon Model | Solar Energetic Particle context & 16-azimuth topographic sky-visibility (`Ω_sky / 2π`) | Regional SEP context / 19.5 m DEM horizon grid | [NASA PDS PPI](https://pds-ppi.igpp.ucla.edu/bundle/urn:nasa:pds:maven.sep.calibrated) |

All layers use the region bounds `[77.2944, 18.3940, 77.4631, 18.5627]` (planetocentric east longitude, equirectangular sphere 3,396,190 m). Distance calculations deliberately use the volumetric mean radius 3,389.5 km, not the projection sphere.

### Generated data

`scripts/prepare_rasters.py`, `scripts/prepare_waypoints.py`, `scripts/prepare_sand_detection.py`, `scripts/prepare_radiation.py`, and `scripts/prepare_terrain.py` regenerate the thermal, mineral, sand, radiation and shielding grids, WebP overlays, 3D terrain tiles, waypoint JSON and surface images. Generated assets are in `public/data/jezero`.

`public/data/jezero/raster-provenance.json` records the CRISM bands, formula, thresholds and source coverage.
`public/data/jezero/radiation/radiation-provenance.json` records the NASA PDS `MSL-M-RAD-3-RDR-V1.0` observation records (`SOL_00270`–`SOL_04551`), detached `.LBL` byte-offset extraction, quality-flag filtering (`QC == "00000000"`, `OBS_DURATION >= 120 s`), mathematical equations, and scientific limitations.

### Mars Radiation Exposure & Topographic Shielding System

- **Real NASA PDS Data Provenance**: `scripts/prepare_radiation.py` queries the live NASA Planetary Data System PPI archive (`MSL-M-RAD-3-RDR-V1.0/DATA/`) and extracts 40 quality-verified (`QC == "00000000"`) Curiosity Radiation Assessment Detector (RAD) surface observations across two reference regimes:
  1. **Nominal GCR Background (`background_gcr`)**: Multi-year solar-cycle reference (`Sols 1227–4551`, `2016–2025`), mean Tissue-Equivalent Plastic (Detector E) absorbed dose rate `10.569 µGy/h` (`±22%` uncertainty across solar modulation and Gale-to-Jezero elevation transfer), Silicon (Detector B) mean `9.991 µGy/h`.
  2. **Solar Energetic Particle Surge (`sep_sep2017`)**: September 2017 GLE 72 solar storm (`Sols 1809–1815`), peaking on Sol 1812 (`2017-09-11T03:56:46Z`) at `25.892 µGy/h` (Silicon Detector B) / `24.027 µGy/h` (Detector E), with a 6-hour peak EVA window mean of `21.634 µGy/h` (`±30%`).
- **Cumulative EVA Exposure Model**:
  $$\text{Absorbed Dose } (\mu\text{Gy}) = \dot{D}_{\text{ref}}(\text{scenario}, \text{component}) \times \left(t_{\text{outbound}} + t_{\text{stops}} + t_{\text{target}} + t_{\text{return}}\right)$$
  Physical absorbed dose is reported strictly in **Gray (`µGy`, `µGy/h`)**. Direct unit conversion between `Gy` and `Sv` is blocked in code (`convertAbsorbedDoseRate`); informational dose-equivalent (`µSv`) is shown separately only with an explicit peer-reviewed quality factor ($\langle Q \rangle = 3.05 \pm 0.26$ for GCR, Hassler et al. 2014).
- **Measurement vs. Model Honesty**: Perseverance does not carry a dedicated surface radiation dosimeter (`MSL-RAD` is at Gale Crater, ~`-4500 m` MOLA vs. Jezero ~`-2540 m` MOLA). All Jezero exposure outputs are explicitly labeled **`Gale Crater RAD Reference -> Jezero Environmental Estimate`**, and the radiation layer is rendered as a low-contrast regional reference overlay rather than fabricated meter-scale hotspots.
- **Terrain Shielding Potential — Experimental**: A separate, independently toggleable layer (`shielding.webp` + `shielding-grid.json`) computes 16-azimuth horizon elevation angles $\alpha(\phi_k)$ from the Mars 2020 DEM and evaluates the geometric upper-hemisphere sky visibility fraction:
  $$f_{\text{sky}}(x,y) = \frac{1}{16}\sum_{k=1}^{16}\cos^2\!\bigl(\alpha(\phi_k)\bigr)$$
  Geometric sky visibility is **never** equated to a percentage radiation dose reduction (`claimedDoseReductionPercent: null`), because high-energy GCR ions penetrate rock scarps and produce secondary neutrons in regolith.

### Honest limits

- The mineralogy layer is **not** a mineral map. It is `1 - R(2.30 µm) / continuum(2.20–2.40 µm)` from one CRISM MTRDR scene. Positive values are candidate phyllosilicate absorptions; below 0.010 the pixels are transparent. It is not confirmed mineralogy or abundance.
- Thermal inertia is thermophysical context, not a measured temperature or a traversability rating. The THEMIS corridor covers 92.6% of the region; it is warped to the map grid, alpha-masked outside coverage and feathered at the corridor edge so it reads as an overlay rather than a pasted image.
- The DEM has 7.8% no-data coverage, concentrated on the eastern and north-western edges. The 3D view fills these areas with the local 463 m MOLA crop and blends the seams. The route model uses the original DEM to assess coverage and slope. Regenerate the MOLA grid from the local crop with `python scripts/prepare_terrain.py --prepare-mola`.
- Science-card imagery is from the rover sol stated on the card; the Skinner Ridge mosaic (PIA24925) was assembled from frames taken on sols 484–492, and the sol 464 delta panorama (PIA24921) from frames taken on sols 466–474. Coordinates come from the traverse endpoint for that sol, and the card says so.
- The USGS map unit is sampled from the local geology raster; mineral context in card notes is regional context, not a point measurement.

## Planning assumptions

- Walking speed is 1.5 km/h. An intermediate science or POV stop costs 20 minutes. The target stay uses the selected duration.
- Return follows the same route in reverse; the mission starts at 09:00 and keeps a 30 minute reserve.
- Maximum target stay = 6 h − outbound walk − intermediate sampling − return walk − reserve. Published deadlines are rounded down to the minute.
- Slope ≥ 15° is a caution; ≥ 25° is a hard no-go. Any route above the caution threshold cannot be GO.
- More than 5% of route distance with unknown DEM coverage yields `INSUFFICIENT DATA`.
- Thermal inertia above the regional 80th percentile (347.6 SI) marks a rocky-terrain hazard.
- Safety 60% / science 40% form the composite score.

These are product assumptions, shown in the interface and mission brief, not NASA standards.

Route analysis compares the current traverse, the short route, five local terrain searches, matching preset
routes and the candidate generated from the local Jezero Random Forest + Ridge ML ensemble (`jezero-ml`). The ML model receives the measured short route and
the best verified local alternative, or a balanced baseline when no alternative qualifies. The planner can
recommend a route from local terrain data when the model is unavailable.

Unreachable, NO-GO, insufficient-data and over-budget routes are excluded. Eligible routes rank by GO before CAUTION,
then higher safety score, shorter mission time at equal safety, and lower common risk cost. Exact ties retain the
current route. Radiation and the science-weighted composite score are advisory. The selection message reports the
winning route's measured trade-off among the candidates searched. Responses arriving after a mission edit cannot
replace the edited route.

## Verification

- `npm test` runs the domain, API and data-contract tests.
- `npm run test:browser` builds the application and tests 2D and 3D route editing, the mission brief, the presentation, AI selection and WebGL recovery in Chrome.
- `npm run verify:terrain` checks terrain source hashes, dimensions and raster registration.
- `npm run lint` checks the TypeScript and JavaScript source.

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
