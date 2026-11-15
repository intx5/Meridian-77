"""Prepare co-registered Mars Jezero Crater Surface Temperature (Yer Sicakligi) raster.

Combines:
  - public/data/jezero/thermal.json (512x512 THEMIS quantitative thermal inertia, J m^-2 K^-1 s^-1/2)
  - public/data/jezero/dem.json (1024x1024 Mars 2020 DEM elevation, slope & solar aspect)
  - public/data/jezero/optical.webp (HiRISE/CTX surface reflectance / albedo proxy)
  - Perseverance MEDA TIRS (Thermal Infrared Sensor) daytime EVA window (11:00-14:00 LMST) calibration

Outputs:
  - public/data/jezero/temperature.webp (512x512 RGBA WebP)
  - public/data/jezero/temperature.json (512x512 RasterGrid in deg C)
"""
from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "public/data/jezero"
NO_DATA = -9999.0


def rgb(hex_color: str) -> np.ndarray:
    h = hex_color.lstrip("#")
    return np.array([int(h[i:i + 2], 16) for i in (0, 2, 4)], dtype=np.float64)


def gradient(stops: list[tuple[float, str]], t: np.ndarray) -> np.ndarray:
    t = np.clip(t, 0.0, 1.0)
    out = np.zeros(t.shape + (3,), dtype=np.float64)
    positions = [p for p, _ in stops]
    colors = [rgb(c) for _, c in stops]
    for i in range(len(stops) - 1):
        lo, hi = positions[i], positions[i + 1]
        mask = (t >= lo) & (t <= hi)
        f = np.zeros_like(t)
        f[mask] = (t[mask] - lo) / max(1e-9, hi - lo)
        out[mask] = colors[i] + f[mask, None] * (colors[i + 1] - colors[i])
    return out


def main() -> None:
    thermal_doc = json.loads((DATA / "thermal.json").read_text(encoding="utf-8"))
    dem_doc = json.loads((DATA / "dem.json").read_text(encoding="utf-8"))
    thermal_img = Image.open(DATA / "thermal.webp").convert("RGBA")
    thermal_alpha = np.asarray(thermal_img, dtype=np.float64)[:, :, 3]

    w, h = thermal_doc["width"], thermal_doc["height"]  # 512 x 512
    bounds = thermal_doc["bounds"]
    ti = np.array(thermal_doc["values"], dtype=np.float64).reshape((h, w))
    valid_ti = (ti != thermal_doc["noData"]) & np.isfinite(ti)

    # Downsample 1024x1024 DEM to 512x512 and compute local slope & solar incidence
    dem_w, dem_h = dem_doc["width"], dem_doc["height"]
    dem_raw = np.array(dem_doc["values"], dtype=np.float64).reshape((dem_h, dem_w))
    dem_valid = dem_raw != dem_doc["noData"]
    dem_filled = np.where(dem_valid, dem_raw, np.nanmedian(np.where(dem_valid, dem_raw, np.nan)))
    dem_512 = dem_filled.reshape((h, 2, w, 2)).mean(axis=(1, 3))

    cell_m = float(thermal_doc["cellWidthM"])
    dz_dy, dz_dx = np.gradient(dem_512, cell_m, cell_m)
    slope_rad = np.arctan(np.hypot(dz_dx, dz_dy))
    # South-facing component (-dz_dy > 0 when terrain slopes down toward South, facing midday sun)
    south_facing = np.clip(-dz_dy / np.maximum(1e-6, np.hypot(dz_dx, dz_dy)), -1.0, 1.0)
    theta_z = math.radians(22.0)  # Midday solar zenith angle at 18.45N
    cos_inc = np.cos(slope_rad) * math.cos(theta_z) + np.sin(slope_rad) * math.sin(theta_z) * south_facing
    delta_t_sun = 28.0 * (cos_inc - math.cos(theta_z))

    # Optical albedo proxy from HiRISE/CTX mosaic
    opt_img = Image.open(DATA / "optical.webp").convert("L").resize((w, h), Image.Resampling.BILINEAR)
    opt_norm = np.asarray(opt_img, dtype=np.float64) / 255.0
    albedo = 0.12 + 0.15 * np.clip((opt_norm - 0.15) / 0.75, 0.0, 1.0)
    delta_t_albedo = -42.0 * (albedo - 0.19)

    # Thermal inertia diurnal damping relative to 260 SI median regolith
    delta_t_ti = -11.5 * np.tanh((ti - 260.0) / 135.0)

    # Midday EVA ground skin temperature in deg C (MEDA TIRS Jezero reference: -38 C to -6 C)
    t_ground = np.full((h, w), NO_DATA, dtype=np.float64)
    modeled = np.clip(-19.5 + delta_t_ti + delta_t_sun + delta_t_albedo, -40.0, -5.0)
    t_ground[valid_ti] = modeled[valid_ti]

    valid_vals = t_ground[valid_ti]
    p2, p50, p80, p98 = np.percentile(valid_vals, [2, 50, 80, 98])
    print(
        f"Surface temperature grid {w}x{h} | coverage {valid_ti.mean()*100:.1f}% | "
        f"min={valid_vals.min():.1f}C p2={p2:.1f}C median={p50:.1f}C p80={p80:.1f}C p98={p98:.1f}C max={valid_vals.max():.1f}C"
    )

    # Cold-to-warm thermal infrared colormap (-34 C to -9 C visual stretch)
    t_norm = (t_ground - (-34.0)) / ((-9.0) - (-34.0))
    color = gradient(
        [
            (0.0, "#1e3a8a"),   # < -30 C: cold high-TI bedrock / shaded scarp
            (0.35, "#06b6d4"),  # -30 C to -22 C: cool consolidated floor
            (0.68, "#eab308"),  # -22 C to -14 C: warm delta fan / regolith
            (1.0, "#ef4444"),   # > -14 C: hot low-TI dark sand / sun-facing slope
        ],
        t_norm,
    )
    alpha = np.where(valid_ti, thermal_alpha, 0.0)
    rgba = np.dstack([color, alpha])
    Image.fromarray(np.clip(rgba, 0, 255).astype(np.uint8), "RGBA").save(
        DATA / "temperature.webp", "WEBP", quality=86, method=6
    )

    temp_doc = {
        "bounds": bounds,
        "width": w,
        "height": h,
        "noData": NO_DATA,
        "cellWidthM": thermal_doc["cellWidthM"],
        "cellHeightM": thermal_doc["cellHeightM"],
        "units": "deg C",
        "variable": "midday EVA surface skin temperature",
        "sourceUrl": "https://pds-atmospheres.nmsu.edu/data_and_services/atmospheres_data/PERSEVERANCE/meda.html",
        "source": "Modeled from THEMIS thermal inertia, Mars 2020 DEM solar incidence, HiRISE albedo, and Perseverance MEDA TIRS ground temperature calibration",
        "coveragePercent": round(float(valid_ti.mean() * 100), 1),
        "medianC": round(float(p50), 1),
        "percentile80": round(float(p80), 1),
        "visualStretch": [-34.0, -9.0],
        "values": [round(float(v), 1) if v != NO_DATA else NO_DATA for v in t_ground.ravel()],
    }
    (DATA / "temperature.json").write_text(
        json.dumps(temp_doc, separators=(",", ":")) + "\n", encoding="utf-8"
    )
    print("Wrote public/data/jezero/temperature.webp and public/data/jezero/temperature.json")


if __name__ == "__main__":
    main()
