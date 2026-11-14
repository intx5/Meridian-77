"""Prepare co-registered thermal and mineralogy rasters from local Mars data.

Inputs (untouched):
  THEMIS_Jezero_Corridor_Thermal_Inertia_100m.tif  - THEMIS quantitative thermal inertia, 100 m/px
  CRISM_HRL000040FF/hrl000040ff_07_if183j_mtr3.img - CRISM MTRDR, 36 m/px, 489 bands
  public/data/jezero/dem.json + layers.json       - reference grid and region bounds

Outputs:
  public/data/jezero/thermal.webp, thermal.json
  public/data/jezero/mineralogy.webp, mineralogy.json
  public/data/jezero/raster-provenance.json
"""
from __future__ import annotations

import json
import math
import re
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "public/data/jezero"
REGION = json.loads((DATA / "layers.json").read_text())["region"]
BOUNDS = REGION["bounds"]
W = H = 256
GRID = np.arange(W * H, dtype=np.float64).reshape(H, W)
LON = BOUNDS[0] + (GRID % W + 0.5) / W * (BOUNDS[2] - BOUNDS[0])
LAT = BOUNDS[3] - (GRID // W + 0.5) / H * (BOUNDS[3] - BOUNDS[1])
NO_DATA = -9999.0


def rgb(hex_color: str) -> np.ndarray:
    h = hex_color.lstrip("#")
    return np.array([int(h[i:i + 2], 16) for i in (0, 2, 4)], dtype=np.float64)


def gradient(stops: list[tuple[float, str]], t: np.ndarray) -> np.ndarray:
    t = np.clip(t, 0, 1)
    out = np.zeros(t.shape + (3,))
    positions = [p for p, _ in stops]
    colors = [rgb(c) for _, c in stops]
    for i in range(len(stops) - 1):
        lo, hi = positions[i], positions[i + 1]
        mask = (t >= lo) & (t <= hi)
        f = np.zeros_like(t)
        f[mask] = (t[mask] - lo) / (hi - lo)
        out[mask] = colors[i] + f[mask, None] * (colors[i + 1] - colors[i])
    return out


def save_webp(path: Path, pixels: np.ndarray, quality: int = 82) -> None:
    Image.fromarray(np.clip(pixels, 0, 255).astype(np.uint8), "RGBA").save(
        path, "WEBP", quality=quality, method=6
    )


# ---------- thermal inertia ----------
tif = Image.open(ROOT / "THEMIS_Jezero_Corridor_Thermal_Inertia_100m.tif")
thermal = np.array(tif, dtype=np.float64)
tags = tif.tag_v2
scale_x, scale_y = tags[33550][:2]
tie = tags[33922]
r_mars = 3396190.0
thermal_x0, thermal_y0 = tie[3], tie[4]
print(f"thermal grid {thermal.shape} at {scale_x} m/px, origin {thermal_x0:.0f}, {thermal_y0:.0f}")

tx = r_mars * np.radians(LON)
ty = r_mars * np.radians(LAT)
tcol = np.floor((tx - thermal_x0) / scale_x).astype(int)
trow = np.floor((thermal_y0 - ty) / scale_y).astype(int)
inside = (tcol >= 0) & (tcol < thermal.shape[1]) & (trow >= 0) & (trow < thermal.shape[0])
thermal_grid = np.full((H, W), NO_DATA)
thermal_grid[inside] = thermal[trow[inside], tcol[inside]]
valid_t = thermal_grid != NO_DATA
lo, hi = np.percentile(thermal_grid[valid_t], [2, 98])
print(f"thermal region coverage {valid_t.mean() * 100:.1f}% | valid {thermal_grid[valid_t].min():.1f}-{thermal_grid[valid_t].max():.1f}, "
      f"p2={lo:.0f} p80={np.percentile(thermal_grid[valid_t], 80):.0f} p98={hi:.0f} SI")

color = gradient([(0, "#102a43"), (0.32, "#2a9d8f"), (0.66, "#e9c46a"), (1, "#ff6b3d")],
                 (thermal_grid - lo) / (hi - lo))
alpha = np.where(valid_t, 255, 0).astype(np.float64)
save_webp(DATA / "thermal.webp", np.dstack([color, alpha]))

thermal_doc = {
    "bounds": BOUNDS,
    "width": W,
    "height": H,
    "noData": NO_DATA,
    "cellWidthM": (BOUNDS[2] - BOUNDS[0]) * math.pi / 180 * r_mars * math.cos(math.radians(18.48)) / W,
    "cellHeightM": (BOUNDS[3] - BOUNDS[1]) * math.pi / 180 * r_mars / H,
    "units": "J m^-2 K^-1 s^-1/2",
    "variable": "apparent thermal inertia",
    "sourceUrl": "https://murray-lab.caltech.edu/Mars2020/data/ThemisTI/THEMIS_TI_Quantitative.zip",
    "source": "THEMIS quantitative thermal inertia, Mars 2020 landing site mosaic",
    "coveragePercent": round(float(valid_t.mean() * 100), 1),
    "percentile80": round(float(np.percentile(thermal_grid[valid_t], 80)), 1),
    "visualStretch": [round(float(lo), 1), round(float(hi), 1)],
    "values": [round(float(v), 1) for v in thermal_grid.ravel()],
}

# ---------- CRISM mineralogy ----------
CRISM = ROOT / "CRISM_HRL000040FF/hrl000040ff_07_if183j_mtr3"
hdr = CRISM.with_suffix(".hdr").read_text()
wavelengths = [float(x) for x in re.search(r"wavelength\s*=\s*\{(.*?)\}", hdr, re.S).group(1).replace("\n", " ").split(",")]
bbl = [int(x) for x in re.search(r"bbl\s*=\s*\{(.*?)\}", hdr, re.S).group(1).replace("\n", " ").split(",")]
ns, nl, nb = 455, 751, 489
mapinfo = re.search(r"map info\s*=\s*\{(.*?)\}", hdr, re.S).group(1).split(",")
proj = re.search(r"projection info\s*=\s*\{(.*?)\}", hdr, re.S).group(1).split(",")
crs_mars = float(proj[1])
std_parallel = float(proj[2])
cx0, cy0 = float(mapinfo[3]), float(mapinfo[4])
cscale = float(mapinfo[5])
ignore = 65535.0


def nearest_band(target_nm: float) -> int:
    return min((i for i in range(nb) if bbl[i] == 1), key=lambda i: abs(wavelengths[i] - target_nm))


bands = {target: nearest_band(target) for target in (2200.0, 2300.0, 2400.0)}
print("CRISM bands:", {k: (v + 1, wavelengths[v]) for k, v in bands.items()})
raw = np.memmap(CRISM.with_suffix(".img"), dtype="<f4", mode="r", shape=(nb, nl, ns))


def read_band(index: int) -> np.ndarray:
    return np.array(raw[index])


r2200, r2300, r2400 = (read_band(bands[t]) for t in (2200.0, 2300.0, 2400.0))
continuum = r2200 + (r2400 - r2200) * (2300.0 - 2200.0) / (2400.0 - 2200.0)
with np.errstate(divide="ignore", invalid="ignore"):
    bd2300 = 1.0 - r2300 / continuum
valid_scene = (
    np.isfinite(bd2300)
    & (r2200 != ignore) & (r2300 != ignore) & (r2400 != ignore)
    & (r2200 > 0) & (r2300 > 0) & (r2400 > 0)
    & (bd2300 > -1) & (bd2300 < 1)
)
print(f"CRISM scene valid {valid_scene.mean() * 100:.1f}% | BD2300 median {np.median(bd2300[valid_scene]):.4f}, "
      f"p95 {np.percentile(bd2300[valid_scene], 95):.4f}, positive {np.mean(bd2300[valid_scene] > 0.01) * 100:.1f}%")

cx = crs_mars * math.cos(math.radians(std_parallel)) * np.radians(LON)
cy = crs_mars * np.radians(LAT)
ccol = np.floor((cx - cx0) / cscale).astype(int)
crow = np.floor((cy0 - cy) / cscale).astype(int)
cinside = (ccol >= 0) & (ccol < ns) & (crow >= 0) & (crow < nl)
mineral = np.full((H, W), NO_DATA)
mineral[cinside] = bd2300[crow[cinside], ccol[cinside]]
valid_m = (mineral != NO_DATA) & np.isfinite(mineral)
print(f"CRISM region coverage {valid_m.mean() * 100:.1f}%")

THRESHOLD = 0.01
tval = np.clip((mineral - THRESHOLD) / (0.06 - THRESHOLD), 0, 1)
mcolor = gradient([(0, "#57c7ff"), (0.55, "#c3e88d"), (1, "#ff6b3d")], tval)
malpha = np.where(valid_m & (mineral > THRESHOLD), np.clip(90 + 165 * tval, 0, 255), 0)
save_webp(DATA / "mineralogy.webp", np.dstack([mcolor, malpha]))

mineral_doc = {
    "bounds": BOUNDS,
    "width": W,
    "height": H,
    "noData": NO_DATA,
    "cellWidthM": thermal_doc["cellWidthM"],
    "cellHeightM": thermal_doc["cellHeightM"],
    "units": "unitless continuum-removed band depth",
    "variable": "2.30 micron absorption depth (possible phyllosilicate indicator)",
    "definition": "1 - R(2.298) / linear continuum R(2.199)-R(2.397) from CRISM MTRDR L2 radiance factor",
    "sourceUrl": "https://pds-geosciences.wustl.edu/mro/mro-m-crism-5-rdr-mptargeted-v1/mrocr_2101/data/hrl000040ff/hrl000040ff_07_if183j_mtr3.img",
    "source": "CRISM HRL000040FF_07_IF183J_MTR3, 36 m/px, orbit 2387",
    "coveragePercent": round(float(valid_m.mean() * 100), 1),
    "thresholdPositive": THRESHOLD,
    "values": [round(float(v), 4) for v in mineral.ravel()],
}

provenance = {
    "region": REGION,
    "grid": {"width": W, "height": H, "rowOrder": "north first", "resampling": "nearest neighbour on native cells"},
    "thermal": {
        "input": "THEMIS_Jezero_Corridor_Thermal_Inertia_100m.tif",
        "inputCrs": "Mars equirectangular sphere 3396190 m, standard parallel 0, planetocentric east longitude",
        "transform": "x = R * lon, y = R * lat; nearest source cell",
        "nativeResolutionM": 100,
        "coverage": f"{valid_t.mean() * 100:.1f}% of region (western strip outside source extent)",
        "units": thermal_doc["units"],
        "caution": "Apparent thermal inertia is thermophysical, not a measured temperature or traversability rating.",
    },
    "mineralogy": {
        "input": "CRISM HRL000040FF_07_IF183J_MTR3 (489 bands, 36 m/px)",
        "bands": {k: {"band": v + 1, "wavelengthNm": wavelengths[v]} for k, v in bands.items()},
        "index": mineral_doc["definition"],
        "threshold": THRESHOLD,
        "coverage": f"{valid_m.mean() * 100:.1f}% of region",
        "caution": "Positive 2.30 micron absorption is a candidate phyllosilicate indicator; it is not a confirmed mineral identification or abundance. Verify with targeted spectral modelling.",
    },
}
(DATA / "thermal.json").write_text(json.dumps(thermal_doc, separators=(",", ":")))
(DATA / "mineralogy.json").write_text(json.dumps(mineral_doc, separators=(",", ":")))
(DATA / "raster-provenance.json").write_text(json.dumps(provenance, indent=2))
print("wrote thermal.json", (DATA / "thermal.json").stat().st_size // 1024, "KiB,",
      "mineralogy.json", (DATA / "mineralogy.json").stat().st_size // 1024, "KiB")
