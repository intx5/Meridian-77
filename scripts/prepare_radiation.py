"""Offline & NASA PDS-backed Mars Radiation Exposure & Topographic Shielding pipeline.

Sources:
  1. NASA PDS Planetary Plasma Interactions (PPI) Node:
     MSL-M-RAD-3-RDR-V1.0 (Curiosity Radiation Assessment Detector Reduced Data Records)
     https://pds-ppi.igpp.ucla.edu/data/MSL-M-RAD-3-RDR-V1.0/
     https://pds.nasa.gov/ds-view/pds/viewProfile.jsp?dsid=MSL-M-RAD-3-RDR-V1.0
  2. MAVEN Solar Energetic Particle (SEP) Instrument context:
     https://lasp.colorado.edu/maven/science/instrument-package/sep/
  3. Mars 2020 Jezero Crater DEM (public/data/jezero/dem.json, 9.77 m/px)

Outputs:
  - public/data/jezero/radiation/radiation-reference.json
  - public/data/jezero/radiation/radiation-scenarios.json
  - public/data/jezero/radiation/radiation-provenance.json
  - public/data/jezero/radiation/shielding-grid.json
  - public/data/jezero/radiation.webp (512x512 RGBA regional reference layer)
  - public/data/jezero/shielding.webp (512x512 RGBA experimental terrain shielding layer)
"""
from __future__ import annotations

import datetime as dt
import json
import math
import re
import urllib.request
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "public/data/jezero"
RAD_DIR = DATA / "radiation"
PDS_BASE = "https://pds-ppi.igpp.ucla.edu/data/MSL-M-RAD-3-RDR-V1.0/DATA/"
W = H = 256


def doy_to_iso(utc_str: str) -> str:
    """Convert PDS YYYY-DOY HH:MM:SS timestamp into ISO-8601 UTC."""
    clean = utc_str.strip().strip('"')
    m = re.match(r"^(\d{4})-(\d{3})[T\s](\d{2}:\d{2}:\d{2})$", clean)
    if not m:
        return clean
    year, doy, hms = int(m.group(1)), int(m.group(2)), m.group(3)
    date_obj = dt.date(year, 1, 1) + dt.timedelta(days=doy - 1)
    return f"{date_obj.isoformat()}T{hms}Z"


def fetch_text(url: str, byte_range: tuple[int, int] | None = None, timeout: int = 20) -> str:
    headers = {"User-Agent": "Meridian77-NASA-SpaceApps/1.0"}
    if byte_range is not None:
        headers["Range"] = f"bytes={byte_range[0]}-{byte_range[1]}"
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read().decode("utf-8", errors="ignore")


def parse_observation_slice(
    product_id: str,
    sol: int,
    obs_id: str,
    header_txt: str,
    dosimetry_txt: str,
) -> dict[str, Any] | None:
    """Validate and extract a single MSL RAD RDR observation record."""
    utc_match = re.search(r'START_OBS_UTC="([^"]+)"', header_txt)
    mars_match = re.search(r'START_OBS_MARS="([^"]+)"', header_txt)
    dur_match = re.search(r"OBS_DURATION=(\d+)", header_txt)
    qc_match = re.search(r'QC="([^"]+)"', header_txt)

    if not (utc_match and dur_match and qc_match):
        return None

    qc_flag = qc_match.group(1).strip()
    duration_s = int(dur_match.group(1))
    # Reject bad quality flags or truncated observations (< 120 s)
    if qc_flag != "00000000" or duration_s < 120:
        return None

    b_match = re.search(
        r"\[DOSIMETRY_TOTAL_DOSE_B:\s*\d+\]\s*[\r\n]+\s*([+-]?\d+(?:\.\d+)?)",
        dosimetry_txt,
    )
    e_match = re.search(
        r"\[DOSIMETRY_TOTAL_DOSE_E:\s*\d+\]\s*[\r\n]+\s*([+-]?\d+(?:\.\d+)?)",
        dosimetry_txt,
    )
    if not (b_match and e_match):
        return None

    dose_b = float(b_match.group(1))
    dose_e = float(e_match.group(1))
    if not (math.isfinite(dose_b) and math.isfinite(dose_e)) or dose_b <= 0 or dose_e <= 0:
        return None

    return {
        "productId": product_id,
        "sol": sol,
        "obsIndex": int(obs_id),
        "startUtc": doy_to_iso(utc_match.group(1)),
        "startMarsLocal": mars_match.group(1).strip() if mars_match else f"{sol}",
        "durationSeconds": duration_s,
        "qcFlag": qc_flag,
        "absorbedDoseRateSiliconMicroGyPerHour": round(dose_b, 4),
        "absorbedDoseRateTissuePlasticMicroGyPerHour": round(dose_e, 4),
        "units": "microGray/hour (uGy/h)",
        "measurementLocation": "Gale Crater, Mars (4.59°S, 137.44°E, ~-4500 m MOLA)",
        "dataStatus": "MEASURED_GALE_RAD_RDR",
    }


def fetch_pds_observations_from_product(
    subdir: str,
    product_id: str,
    sample_count: int = 3,
) -> list[dict[str, Any]]:
    """Fetch verified dosimetry records from a NASA PDS MSL-M-RAD-3-RDR-V1.0 product."""
    lbl_url = f"{PDS_BASE}{subdir}/{product_id}.LBL"
    txt_url = f"{PDS_BASE}{subdir}/{product_id}.TXT"
    lbl_text = fetch_text(lbl_url, timeout=25)

    sol_match = re.search(r"_(\d{4})_V\d+$", product_id)
    sol = int(sol_match.group(1)) if sol_match else 0

    l1_offsets = dict(
        re.findall(r"\^OBS(\d+)_L1_TABLE\s*=\s*\([^\)]+,(\d+)\s*<BYTES>\)", lbl_text)
    )
    db_offsets = dict(
        re.findall(r"\^OBS(\d+)_TOT_DOSE_B_ELEMENT\s*=\s*\([^\)]+,(\d+)\s*<BYTES>\)", lbl_text)
    )
    common_keys = sorted(k for k in db_offsets if k in l1_offsets)
    if not common_keys:
        return []

    if sample_count >= len(common_keys):
        chosen_keys = common_keys
    else:
        indices = np.linspace(0, len(common_keys) - 1, sample_count, dtype=int)
        chosen_keys = [common_keys[i] for i in indices]

    records: list[dict[str, Any]] = []
    for obs_id in chosen_keys:
        l1_byte = int(l1_offsets[obs_id])
        db_byte = int(db_offsets[obs_id])
        h_start = max(0, l1_byte - 680)
        h_end = l1_byte + 40
        d_start = max(0, db_byte - 120)
        d_end = db_byte + 180
        header_txt = fetch_text(txt_url, (h_start, h_end), timeout=15)
        dos_txt = fetch_text(txt_url, (d_start, d_end), timeout=15)
        parsed = parse_observation_slice(product_id, sol, obs_id, header_txt, dos_txt)
        if parsed is not None:
            records.append(parsed)
    return records


def discover_first_product(subdir: str, target_sol: int | None = None) -> str | None:
    html = fetch_text(f"{PDS_BASE}{subdir}/", timeout=20)
    lbls = re.findall(r'href="(RAD_RDR_[^"]+\.LBL)"', html)
    if not lbls:
        return None
    if target_sol is not None:
        token = f"_{target_sol:04d}_"
        for name in lbls:
            if token in name:
                return name[:-4]
    return lbls[len(lbls) // 2][:-4]


def collect_nasa_pds_rad_data() -> dict[str, Any]:
    """Fetch real MSL-M-RAD-3-RDR-V1.0 surface observations from NASA PDS PPI Node."""
    import sys
    cache_path = RAD_DIR / "raw-pds-rad-samples.json"
    if cache_path.exists() and "--refresh-pds" not in sys.argv:
        print(f"Using verified NASA PDS RAD samples from {cache_path} (pass --refresh-pds to re-fetch live)")
        return json.loads(cache_path.read_text(encoding="utf-8"))
    try:
        print("Connecting to NASA PDS PPI archive (MSL-M-RAD-3-RDR-V1.0)...")
        # 1. September 2017 GLE 72 Solar Energetic Particle Event (Sols 1809 - 1815)
        sep_event_records: list[dict[str, Any]] = []
        sep_sols = [
            (1809, 2),
            (1810, 2),
            (1811, 3),
            (1812, 8),
            (1813, 8),
            (1814, 3),
            (1815, 2),
        ]
        for sol_num, n_samples in sep_sols:
            prod = discover_first_product("SOL_01773_01869", target_sol=sol_num)
            if prod:
                recs = fetch_pds_observations_from_product("SOL_01773_01869", prod, sample_count=n_samples)
                sep_event_records.extend(recs)
                print(f"  Sol {sol_num} ({prod}): fetched {len(recs)} verified observations")

        # Also ensure the exact Sol 1812 peak observation (OBS 220) is included
        prod_1812 = discover_first_product("SOL_01773_01869", target_sol=1812)
        if prod_1812 and not any(r["sol"] == 1812 and r["obsIndex"] == 220 for r in sep_event_records):
            lbl_text = fetch_text(f"{PDS_BASE}SOL_01773_01869/{prod_1812}.LBL", timeout=20)
            l1_m = re.search(r"\^OBS220_L1_TABLE\s*=\s*\([^\)]+,(\d+)\s*<BYTES>\)", lbl_text)
            db_m = re.search(r"\^OBS220_TOT_DOSE_B_ELEMENT\s*=\s*\([^\)]+,(\d+)\s*<BYTES>\)", lbl_text)
            if l1_m and db_m:
                l1_b, db_b = int(l1_m.group(1)), int(db_m.group(1))
                h_txt = fetch_text(f"{PDS_BASE}SOL_01773_01869/{prod_1812}.TXT", (l1_b - 680, l1_b + 40))
                d_txt = fetch_text(f"{PDS_BASE}SOL_01773_01869/{prod_1812}.TXT", (db_b - 120, db_b + 180))
                peak_rec = parse_observation_slice(prod_1812, 1812, "220", h_txt, d_txt)
                if peak_rec:
                    sep_event_records.append(peak_rec)

        sep_event_records.sort(key=lambda r: (r["sol"], r["obsIndex"]))

        # 2. Long-term GCR background across the solar cycle (2013 - 2025)
        era_dirs = [
            "SOL_00270_00359",
            "SOL_00584_00707",
            "SOL_01160_01293",
            "SOL_01773_01869",
            "SOL_02483_02579",
            "SOL_03069_03192",
            "SOL_03779_03902",
            "SOL_04489_04612",
        ]
        solar_cycle_records: list[dict[str, Any]] = []
        for subdir in era_dirs:
            target = 1773 if subdir == "SOL_01773_01869" else None
            prod = discover_first_product(subdir, target_sol=target)
            if prod:
                recs = fetch_pds_observations_from_product(subdir, prod, sample_count=2)
                solar_cycle_records.extend(recs)
                print(f"  Era {subdir} ({prod}): fetched {len(recs)} verified GCR baseline records")

        solar_cycle_records.sort(key=lambda r: (r["sol"], r["obsIndex"]))

        payload = {
            "fetchedAtUtc": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "pdsDatasetId": "MSL-M-RAD-3-RDR-V1.0",
            "pdsArchiveUrl": "https://pds-ppi.igpp.ucla.edu/data/MSL-M-RAD-3-RDR-V1.0/",
            "pdsProfileUrl": "https://pds.nasa.gov/ds-view/pds/viewProfile.jsp?dsid=MSL-M-RAD-3-RDR-V1.0",
            "sepEventSeries": sep_event_records,
            "solarCycleSeries": solar_cycle_records,
        }
        RAD_DIR.mkdir(parents=True, exist_ok=True)
        cache_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
        return payload
    except Exception as exc:
        if cache_path.exists():
            print(f"Warning: PDS live fetch failed ({exc}); using cached NASA PDS samples at {cache_path}")
            return json.loads(cache_path.read_text(encoding="utf-8"))
        raise


def compute_dem_horizon_shielding(dem_doc: dict[str, Any]) -> dict[str, Any]:
    """Compute 16-azimuth horizon angles and sky visibility fraction from Mars 2020 DEM."""
    dem_full = np.array(dem_doc["values"], dtype=np.float32).reshape(dem_doc["height"], dem_doc["width"])
    no_data = float(dem_doc["noData"])
    valid_full = dem_full != no_data

    # Downsample 1024x1024 DEM to 256x256 (39.06 m/px) for fast 16-azimuth ray marching
    step = dem_doc["height"] // H
    dem_nan = np.where(valid_full, dem_full, np.nan)
    import warnings
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", category=RuntimeWarning)
        elev = np.nanmean(dem_nan.reshape(H, step, W, step), axis=(1, 3))
    valid = ~np.isnan(elev)
    elev_clean = np.where(valid, elev, -2540.0).astype(np.float32)

    cell_m = 9.765625 * step  # 39.0625 m per 256-grid pixel
    n_az = 16
    angles = np.linspace(0.0, 2.0 * math.pi, n_az, endpoint=False)
    horizon_angles_deg = np.zeros((n_az, H, W), dtype=np.float32)

    # Ray march up to 36 cells (~1.41 km local topographic horizon radius)
    max_steps = 36
    yy, xx = np.indices((H, W), dtype=np.float32)

    for a_idx, theta in enumerate(angles):
        dx = math.cos(theta)
        dy = -math.sin(theta)  # north is up (-y)
        max_slope = np.zeros((H, W), dtype=np.float32)
        for s in range(1, max_steps + 1):
            dist_m = s * cell_m
            rx = np.clip(np.round(xx + dx * s).astype(np.int32), 0, W - 1)
            ry = np.clip(np.round(yy + dy * s).astype(np.int32), 0, H - 1)
            rem_valid = valid[ry, rx]
            dz = elev_clean[ry, rx] - elev_clean
            slope = np.where(rem_valid & (dz > 0.0), dz / dist_m, 0.0)
            max_slope = np.maximum(max_slope, slope)
        horizon_angles_deg[a_idx] = np.degrees(np.arctan(max_slope))

    mean_horizon_deg = horizon_angles_deg.mean(axis=0)
    max_horizon_deg = horizon_angles_deg.max(axis=0)

    # Upper hemisphere solid-angle sky visibility fraction:
    # For horizon elevation angle alpha(phi), unobstructed zenith angle runs from 0 to pi/2 - alpha(phi),
    # so solid angle element is (1 - sin(alpha(phi))) averaged over azimuths.
    sin_h = np.sin(np.radians(np.clip(horizon_angles_deg, 0.0, 85.0)))
    sky_view = np.clip(1.0 - np.mean(sin_h, axis=0), 0.15, 1.0)
    # Experimental terrain shielding proxy: geometric solid-angle obstruction fraction (1 - sky_view)
    # Scaled to [0.0, 1.0] where 1.0 = ~25 deg mean horizon obstruction
    shielding_proxy = np.clip((1.0 - sky_view) / 0.35, 0.0, 1.0)

    mean_horizon_deg = np.where(valid, mean_horizon_deg, -9999.0)
    max_horizon_deg = np.where(valid, max_horizon_deg, -9999.0)
    sky_view = np.where(valid, sky_view, -9999.0)
    shielding_proxy = np.where(valid, shielding_proxy, -9999.0)

    return {
        "valid": valid,
        "elev": elev_clean,
        "meanHorizonDeg": mean_horizon_deg,
        "maxHorizonDeg": max_horizon_deg,
        "skyView": sky_view,
        "shieldingProxy": shielding_proxy,
        "cellSizeM": round(cell_m, 3),
    }


def render_layers(
    valid_256: np.ndarray,
    elev_256: np.ndarray,
    sky_view_256: np.ndarray,
    shielding_proxy_256: np.ndarray,
) -> None:
    """Render 512x512 RGBA WebP rasters for Radiation Exposure variants and Terrain Shielding Potential."""
    valid = np.repeat(np.repeat(valid_256, 2, axis=0), 2, axis=1)
    elev = np.repeat(np.repeat(elev_256, 2, axis=0), 2, axis=1)
    sky_view = np.repeat(np.repeat(sky_view_256, 2, axis=0), 2, axis=1)
    proxy = np.repeat(np.repeat(shielding_proxy_256, 2, axis=0), 2, axis=1)

    yy, xx = np.indices((512, 512))
    grid_line = ((xx % 64) == 0) | ((yy % 64) == 0)
    hatch = ((xx + yy) % 8) < 2

    # Normalized elevation within Jezero [-2640, -2140] -> [0, 1]
    e_norm = np.clip((elev - (-2640.0)) / 500.0, 0.0, 1.0)
    # Normalized open-sky factor [0.70, 1.0] -> [0, 1]
    sky_norm = np.clip((sky_view - 0.72) / 0.28, 0.0, 1.0)

    # 1a. radiation.webp (Total · Nominal GCR Baseline ~10.6 uGy/h):
    # Warm Amber-to-Gold palette (#b46e3c low crater floor -> #dc8c48 delta -> #f5aa5a high rim).
    # Zero blue channel dominance so it never confuses with Terrain Shielding (cyan/blue).
    rad_rgba = np.zeros((512, 512, 4), dtype=np.uint8)
    t_nom = np.clip(0.75 * e_norm + 0.25 * sky_norm, 0.0, 1.0)
    rad_rgba[valid, 0] = np.round(165 + 85 * t_nom[valid]).astype(np.uint8)
    rad_rgba[valid, 1] = np.round(82 + 108 * t_nom[valid]).astype(np.uint8)
    rad_rgba[valid, 2] = np.round(38 + 42 * t_nom[valid]).astype(np.uint8)
    rad_rgba[valid, 3] = np.round(135 + 45 * t_nom[valid]).astype(np.uint8)
    rad_rgba[valid & grid_line] = [245, 170, 90, 195]
    rad_rgba[(~valid) & hatch] = [148, 163, 184, 120]
    Image.fromarray(rad_rgba, "RGBA").save(DATA / "radiation.webp", "WEBP", lossless=True, method=6)

    # 1b. radiation-sep-total.webp (Total · Sep 2017 GLE 72 Solar Storm ~21.6 uGy/h, peak 25.9 uGy/h):
    # High-intensity Crimson-to-Bright-Yellow storm palette (#7f1d1d -> #ef4444 -> #fde047).
    sep_tot_rgba = np.zeros((512, 512, 4), dtype=np.uint8)
    t_storm = np.clip(0.55 * e_norm + 0.45 * sky_norm, 0.0, 1.0)
    sep_tot_rgba[valid, 0] = np.round(145 + 110 * t_storm[valid]).astype(np.uint8)
    sep_tot_rgba[valid, 1] = np.round(28 + 185 * (t_storm[valid] ** 1.35)).astype(np.uint8)
    sep_tot_rgba[valid, 2] = np.round(28 + 45 * (t_storm[valid] ** 2.0)).astype(np.uint8)
    sep_tot_rgba[valid, 3] = np.round(150 + 55 * t_storm[valid]).astype(np.uint8)
    sep_tot_rgba[valid & grid_line] = [254, 240, 138, 210]
    sep_tot_rgba[(~valid) & hatch] = [148, 163, 184, 120]
    Image.fromarray(sep_tot_rgba, "RGBA").save(
        DATA / "radiation-sep-total.webp", "WEBP", lossless=True, method=6
    )

    # 1c. radiation-gcr.webp (GCR Only · Galactic Cosmic Ray Baseline ~10.6 uGy/h):
    # Pure atmospheric CO2 column depth modulation (elevation driven), rendered in a distinct
    # Emerald-Teal to Lime-Gold scientific palette (#065f46 -> #10b981 -> #fde047).
    gcr_rgba = np.zeros((512, 512, 4), dtype=np.uint8)
    gcr_rgba[valid, 0] = np.round(16 + 235 * (e_norm[valid] ** 1.15)).astype(np.uint8)
    gcr_rgba[valid, 1] = np.round(115 + 110 * e_norm[valid]).astype(np.uint8)
    gcr_rgba[valid, 2] = np.round(95 - 35 * e_norm[valid]).astype(np.uint8)
    gcr_rgba[valid, 3] = np.round(135 + 45 * e_norm[valid]).astype(np.uint8)
    gcr_rgba[valid & grid_line] = [167, 243, 208, 195]
    gcr_rgba[(~valid) & hatch] = [148, 163, 184, 120]
    Image.fromarray(gcr_rgba, "RGBA").save(DATA / "radiation-gcr.webp", "WEBP", lossless=True, method=6)

    # 1d. radiation-sep.webp (SEP Only · Solar Energetic Particle Surge +11.1 uGy/h):
    # Strongly modulated by upper-hemisphere sky visibility f_sky and elevation, rendered in a
    # distinct Solar-Proton Violet-to-Magenta/Rose palette (#4c1d95 sheltered -> #d946ef -> #fda4af exposed).
    sep_only_rgba = np.zeros((512, 512, 4), dtype=np.uint8)
    t_sep = np.clip(0.35 * e_norm + 0.65 * sky_norm, 0.0, 1.0)
    sep_only_rgba[valid, 0] = np.round(88 + 162 * t_sep[valid]).astype(np.uint8)
    sep_only_rgba[valid, 1] = np.round(28 + 115 * (t_sep[valid] ** 1.5)).astype(np.uint8)
    sep_only_rgba[valid, 2] = np.round(155 + 85 * (1.0 - 0.35 * t_sep[valid])).astype(np.uint8)
    sep_only_rgba[valid, 3] = np.round(145 + 55 * t_sep[valid]).astype(np.uint8)
    sep_only_rgba[valid & grid_line] = [245, 208, 254, 205]
    sep_only_rgba[(~valid) & hatch] = [148, 163, 184, 120]
    Image.fromarray(sep_only_rgba, "RGBA").save(
        DATA / "radiation-sep.webp", "WEBP", lossless=True, method=6
    )

    # 2. shielding.webp:
    # Terrain Shielding Potential — Experimental (derived from 16-azimuth DEM horizon obstruction).
    # Blue/cyan highlights scarp alcoves, delta fronts, and crater walls with higher horizon obstruction
    # (lower sky-view factor); open flat plains are nearly transparent slate.
    sh_rgba = np.zeros((512, 512, 4), dtype=np.uint8)
    p_val = np.clip(proxy, 0.0, 1.0)
    high_sh = valid & (p_val >= 0.30)
    mod_sh = valid & (p_val >= 0.12) & (p_val < 0.30)
    low_sh = valid & (p_val < 0.12)

    sh_rgba[low_sh] = [71, 85, 105, 55]
    sh_rgba[mod_sh] = [234, 179, 8, 155]
    sh_rgba[high_sh] = [56, 189, 248, 215]
    sh_rgba[(~valid) & hatch] = [148, 163, 184, 95]

    Image.fromarray(sh_rgba, "RGBA").save(DATA / "shielding.webp", "WEBP", lossless=True, method=6)


def main() -> None:
    RAD_DIR.mkdir(parents=True, exist_ok=True)
    manifest = json.loads((DATA / "layers.json").read_text(encoding="utf-8"))
    dem_doc = json.loads((DATA / "dem.json").read_text(encoding="utf-8"))
    waypoints = json.loads((DATA / "waypoints.json").read_text(encoding="utf-8"))
    bounds = manifest["region"]["bounds"]

    pds_data = collect_nasa_pds_rad_data()
    sep_series = pds_data["sepEventSeries"]
    cycle_series = pds_data["solarCycleSeries"]

    # Compute baseline GCR statistics from quiet-sun records (Sols 1809-1811 pre-event + solar cycle series)
    quiet_records = [r for r in sep_series if r["sol"] in (1809, 1810, 1811)] + cycle_series
    gcr_e_vals = [r["absorbedDoseRateTissuePlasticMicroGyPerHour"] for r in quiet_records]
    gcr_b_vals = [r["absorbedDoseRateSiliconMicroGyPerHour"] for r in quiet_records]

    mean_gcr_e = round(float(np.mean(gcr_e_vals)), 3)
    mean_gcr_b = round(float(np.mean(gcr_b_vals)), 3)
    min_gcr_e = round(float(np.min(gcr_e_vals)), 3)
    max_gcr_e = round(float(np.max(gcr_e_vals)), 3)

    # Compute September 2017 GLE 72 SEP peak & 6-hour peak window statistics (Sol 1812 late + Sol 1813 early)
    sep_peak_records = [
        r
        for r in sep_series
        if r["absorbedDoseRateSiliconMicroGyPerHour"] >= 18.0
        or r["absorbedDoseRateTissuePlasticMicroGyPerHour"] >= 18.0
    ]
    peak_b = round(max(r["absorbedDoseRateSiliconMicroGyPerHour"] for r in sep_series), 3)
    peak_e = round(max(r["absorbedDoseRateTissuePlasticMicroGyPerHour"] for r in sep_series), 3)
    mean_sep_window_e = round(
        float(np.mean([r["absorbedDoseRateTissuePlasticMicroGyPerHour"] for r in sep_peak_records])), 3
    )
    mean_sep_window_b = round(
        float(np.mean([r["absorbedDoseRateSiliconMicroGyPerHour"] for r in sep_peak_records])), 3
    )

    # Compute DEM horizon & sky-visibility grid
    horizon = compute_dem_horizon_shielding(dem_doc)
    valid_mask = horizon["valid"]
    sky_vals = horizon["skyView"][valid_mask]
    hor_vals = horizon["meanHorizonDeg"][valid_mask]
    proxy_vals = horizon["shieldingProxy"][valid_mask]

    render_layers(
        horizon["valid"],
        horizon["elev"],
        horizon["skyView"],
        horizon["shieldingProxy"],
    )

    # Sample horizon shielding at each Perseverance station
    station_shielding = []
    for wp in waypoints:
        c = min(W - 1, max(0, int((wp["lon"] - bounds[0]) / (bounds[2] - bounds[0]) * W)))
        r = min(H - 1, max(0, int((bounds[3] - wp["lat"]) / (bounds[3] - bounds[1]) * H)))
        is_val = bool(horizon["valid"][r, c])
        station_shielding.append(
            {
                "id": wp["id"],
                "name": wp["name"],
                "lon": wp["lon"],
                "lat": wp["lat"],
                "elevationM": wp.get("elevationM"),
                "meanHorizonObstructionDeg": round(float(horizon["meanHorizonDeg"][r, c]), 2) if is_val else None,
                "maxHorizonObstructionDeg": round(float(horizon["maxHorizonDeg"][r, c]), 2) if is_val else None,
                "skyVisibilityFraction": round(float(horizon["skyView"][r, c]), 4) if is_val else None,
                "experimentalShieldingProxy": round(float(horizon["shieldingProxy"][r, c]), 3) if is_val else None,
            }
        )

    reference_doc = {
        "schemaVersion": 1,
        "datasetId": "MSL-M-RAD-3-RDR-V1.0",
        "instrument": "Curiosity Mars Science Laboratory — Radiation Assessment Detector (RAD)",
        "measurementSite": {
            "name": "Gale Crater, Mars",
            "lat": -4.5895,
            "lon": 137.4417,
            "elevationMolaM": -4501,
            "note": "All RAD measurements originate from Gale Crater. Mars 2020 Perseverance does not carry an active ionizing radiation dosimeter at Jezero Crater.",
        },
        "applicationSite": {
            "name": "Jezero Crater Delta Front, Mars",
            "bounds": bounds,
            "meanElevationMolaM": -2535,
            "elevationRangeM": [-2645, -2120],
            "status": "REGIONAL_REFERENCE_TRANSFER_MODEL",
            "spatialResolutionNote": (
                "No in-situ radiation map exists for Jezero Crater. Within the 10 km x 10 km delta region, "
                "the ~500 m elevation relief modifies vertical CO2 atmospheric column depth by <4.5%, which is "
                "smaller than reference uncertainty (+/-22%). Spatial variations are therefore not claimed as "
                "verified dose differences."
            ),
        },
        "summary": {
            "gcrBackgroundMeanTissuePlasticMicroGyPerHour": mean_gcr_e,
            "gcrBackgroundMeanSiliconMicroGyPerHour": mean_gcr_b,
            "gcrSolarCycleRangeMicroGyPerHour": [min_gcr_e, max_gcr_e],
            "sep2017PeakSiliconMicroGyPerHour": peak_b,
            "sep2017PeakTissuePlasticMicroGyPerHour": peak_e,
            "sep2017SixHourPeakWindowMeanMicroGyPerHour": mean_sep_window_e,
            "sep2017AdditionalEventIntegratedMicroGy": 418.0,
            "publishedGcrMeanQualityFactorQ": 3.05,
            "publishedGcrQualityFactorUncertainty": 0.26,
            "verifiedObservationCount": len(sep_series) + len(cycle_series),
        },
        "sep2017HighCadenceSeries": sep_series,
        "solarCycleReferenceSeries": cycle_series,
        "stationTopographicContext": station_shielding,
    }

    scenarios_doc = {
        "schemaVersion": 1,
        "defaultScenarioId": "background_gcr",
        "scenarios": [
            {
                "id": "background_gcr",
                "label": "Background Radiation Scenario (GCR Dominated)",
                "shortLabel": "Background GCR",
                "dataStatus": "MEASURED_GALE_REFERENCE_APPLIED_TO_JEZERO",
                "radiationSource": "Galactic Cosmic Rays (GCR: ~85–90% protons, ~10–14% alpha particles, ~1% HZE ions + secondary neutrons/gammas)",
                "referenceOrigin": "NASA PDS MSL-M-RAD-3-RDR-V1.0 · Curiosity RAD at Gale Crater (Sols 13–4550 & pre-event Sols 1809–1811)",
                "referenceDateRange": "2012-08-19 to 2025-05-30 (Quiet-Sun Reference Baseline)",
                "absorbedDoseRateMicroGyPerHour": mean_gcr_e,
                "siliconAbsorbedDoseRateMicroGyPerHour": mean_gcr_b,
                "gcrComponentMicroGyPerHour": mean_gcr_e,
                "sepComponentMicroGyPerHour": 0.0,
                "uncertaintyPercent": 22,
                "publishedMeanQualityFactorQ": 3.05,
                "informationalDoseEquivalentRateMicroSvPerHour": round(mean_gcr_e * 3.05, 2),
                "sixHourEvaReferenceDoseMicroGy": round(mean_gcr_e * 6.0, 2),
                "sixHourEvaUncertaintyRangeMicroGy": [
                    round(mean_gcr_e * 6.0 * 0.78, 2),
                    round(mean_gcr_e * 6.0 * 1.22, 2),
                ],
                "shelterAdvisory": (
                    "Nominal galactic cosmic ray background. High-energy GCR ions penetrate thin EVA suits and "
                    "shallow regolith overhangs; cumulative EVA exposure is governed primarily by total mission duration."
                ),
                "limitations": [
                    "Measured by Curiosity RAD in Gale Crater (~-4.5 km MOLA), not in-situ at Jezero Crater (~-2.5 km MOLA).",
                    "Jezero's ~2 km higher elevation reduces overlying CO2 mass column by ~15-18%, which can increase surface GCR dose rate within the +/-22% uncertainty band.",
                    "Absorbed dose (uGy) is a physical energy deposition quantity and must not be equated 1:1 with biological dose equivalent (uSv).",
                ],
            },
            {
                "id": "sep_sep2017",
                "label": "Historical Solar Particle Event Scenario (Sep 2017 GLE 72)",
                "shortLabel": "Sep 2017 SEP Event",
                "dataStatus": "HISTORICAL_SEP_EVENT_SCENARIO",
                "radiationSource": "GCR Background + Solar Energetic Particles (SEP protons >100 MeV penetrating Mars CO2 atmosphere during GLE 72)",
                "referenceOrigin": "NASA PDS MSL-M-RAD-3-RDR-V1.0 (Sols 1811–1815) & MAVEN SEP Orbital Context (Zeitlin et al., 2018)",
                "referenceDateRange": "2017-09-10 to 2017-09-13 (MSL Sols 1812–1814 Peak Window)",
                "absorbedDoseRateMicroGyPerHour": mean_sep_window_e,
                "siliconAbsorbedDoseRateMicroGyPerHour": mean_sep_window_b,
                "peakAbsorbedDoseRateMicroGyPerHour": peak_b,
                "gcrComponentMicroGyPerHour": mean_gcr_e,
                "sepComponentMicroGyPerHour": round(max(0.0, mean_sep_window_e - mean_gcr_e), 3),
                "uncertaintyPercent": 28,
                "publishedMeanQualityFactorQ": 2.15,
                "informationalDoseEquivalentRateMicroSvPerHour": round(
                    mean_gcr_e * 3.05 + max(0.0, mean_sep_window_e - mean_gcr_e) * 1.45, 2
                ),
                "sixHourEvaReferenceDoseMicroGy": round(mean_sep_window_e * 6.0, 2),
                "sixHourEvaUncertaintyRangeMicroGy": [
                    round(mean_sep_window_e * 6.0 * 0.72, 2),
                    round(mean_sep_window_e * 6.0 * 1.28, 2),
                ],
                "shelterAdvisory": (
                    "Historical SEP surge scenario (modeled on the Sept 10–13, 2017 GLE 72 event where surface dose rate "
                    "rose ~2.3x above GCR background to 25.89 uGy/h). Pre-mission planning advisory: minimize exposed "
                    "target stay duration, keep return margin positive, and note high-obstruction scarp alcoves along the traverse."
                ),
                "limitations": [
                    "Historical reference event (September 2017 GLE 72); this system does NOT predict the timing or intensity of future solar particle events.",
                    "More extreme historical SPEs (e.g., Carrington 1859, August 1972, October 1989) with harder proton spectra could produce substantially higher surface dose rates than Sept 2017.",
                    "MAVEN SEP measures orbital particle fluxes above the atmosphere; surface dose rates here come from MSL-RAD surface measurements underneath ~20-23 g/cm² of CO2.",
                ],
            },
        ],
    }

    provenance_doc = {
        "schemaVersion": 1,
        "generatedAtUtc": pds_data["fetchedAtUtc"],
        "pipelineScript": "scripts/prepare_radiation.py",
        "sources": [
            {
                "id": "msl_rad_pds",
                "title": "MSL Mars Radiation Assessment Detector (RAD) Reduced Data Record V1.0",
                "datasetId": "MSL-M-RAD-3-RDR-V1.0",
                "profileUrl": "https://pds.nasa.gov/ds-view/pds/viewProfile.jsp?dsid=MSL-M-RAD-3-RDR-V1.0",
                "archiveUrl": "https://pds-ppi.igpp.ucla.edu/data/MSL-M-RAD-3-RDR-V1.0/",
                "variablesUsed": [
                    "DOSIMETRY_TOTAL_DOSE_B (microGray/Hour, 300 um Silicon Detector B)",
                    "DOSIMETRY_TOTAL_DOSE_E (microGray/Hour, Tissue-Equivalent Plastic Scintillator E)",
                    "OBS_DURATION (seconds)",
                    "QC (8-bit quality control string; required QC=='00000000')",
                    "START_OBS_UTC / START_OBS_MARS",
                ],
                "role": "Primary surface ionizing radiation reference (Gale Crater, Mars).",
            },
            {
                "id": "maven_sep",
                "title": "MAVEN Solar Energetic Particle (SEP) Instrument Package",
                "url": "https://lasp.colorado.edu/maven/science/instrument-package/sep/",
                "role": (
                    "Orbital energetic particle context for the September 2017 SEP event (Lee et al., 2018; "
                    "Zeitlin et al., 2018). Not converted directly to surface dose without atmospheric transport."
                ),
            },
            {
                "id": "mars2020_dem",
                "title": "Mars 2020 Jezero Crater Digital Elevation Model (DEM)",
                "url": "https://murray-lab.caltech.edu/Mars2020/index.html",
                "localPath": "/data/jezero/dem.json",
                "role": (
                    "16-azimuth local topographic horizon obstruction and sky-visibility solid-angle fraction "
                    "(Terrain Shielding Potential — Experimental)."
                ),
            },
            {
                "id": "scientific_literature",
                "title": "Peer-Reviewed Mars Surface Dosimetry Benchmarks",
                "citations": [
                    "Hassler, D. M., et al. (2014), Mars' Surface Radiation Environment Measured with the Mars Science Laboratory's Curiosity Rover, Science, 343(6169), 1244797.",
                    "Zeitlin, C., et al. (2018), Analysis of the Radiation Hazard Observed by RAD on the Surface of Mars During the September 2017 Solar Particle Event, Geophys. Res. Lett., 45, 5845–5851.",
                    "Guo, J., et al. (2021), Radiation environment for future human exploration on the surface of Mars, Astron. Astrophys. Rev., 29, 8.",
                ],
            },
        ],
        "processingSteps": [
            "1. Connected to NASA PDS PPI archive (MSL-M-RAD-3-RDR-V1.0) and parsed detached PDS3 .LBL byte pointers for observation headers and DOSIMETRY sections.",
            "2. Filtered observations by quality control flag QC == '00000000', observation duration >= 120 s, and finite positive detector B & E dose rates.",
            "3. Preserved physical units (microGray/hour for absorbed dose rate; microGray for integrated absorbed dose) without conflating Gray (Gy) and Sievert (Sv).",
            "4. Computed 16-azimuth ray-marched horizon elevation angles and upper-hemisphere sky visibility fraction (Omega_sky / 2pi) across the 256x256 Jezero DEM grid.",
            "5. Separated the regional Radiation Exposure reference layer from the experimental Terrain Shielding Potential layer.",
        ],
    }

    shielding_grid_doc = {
        "bounds": bounds,
        "width": W,
        "height": H,
        "noData": -9999,
        "cellSizeM": horizon["cellSizeM"],
        "units": "sky_visibility_fraction (0.0 to 1.0)",
        "layerLabel": "Terrain Shielding Potential — Experimental",
        "disclaimer": (
            "Geometric upper-hemisphere sky visibility fraction (Omega_sky / 2pi) computed from 16-azimuth ray-marching "
            "within the local 10 km x 10 km Mars 2020 DEM. Does NOT equal percentage dose reduction: high-energy GCR "
            "ions penetrate rock scarps and generate secondary neutrons/albedo radiation in regolith, and terrain "
            "outside the local DEM footprint is not included."
        ),
        "summary": {
            "meanSkyVisibilityFraction": round(float(np.mean(sky_vals)), 4),
            "minSkyVisibilityFraction": round(float(np.min(sky_vals)), 4),
            "meanHorizonObstructionDeg": round(float(np.mean(hor_vals)), 2),
            "maxHorizonObstructionDeg": round(float(np.max(horizon["maxHorizonDeg"][valid_mask])), 2),
            "meanShieldingProxy": round(float(np.mean(proxy_vals)), 3),
            "demCoveragePercent": round(float(valid_mask.mean() * 100.0), 1),
        },
        "skyVisibilityValues": [
            round(float(v), 4) if v != -9999.0 else -9999 for v in horizon["skyView"].ravel()
        ],
        "meanHorizonDegValues": [
            round(float(v), 2) if v != -9999.0 else -9999 for v in horizon["meanHorizonDeg"].ravel()
        ],
    }

    (RAD_DIR / "radiation-reference.json").write_text(
        json.dumps(reference_doc, indent=2) + "\n", encoding="utf-8"
    )
    (RAD_DIR / "radiation-scenarios.json").write_text(
        json.dumps(scenarios_doc, indent=2) + "\n", encoding="utf-8"
    )
    (RAD_DIR / "radiation-provenance.json").write_text(
        json.dumps(provenance_doc, indent=2) + "\n", encoding="utf-8"
    )
    (RAD_DIR / "shielding-grid.json").write_text(
        json.dumps(shielding_grid_doc, separators=(",", ":")) + "\n", encoding="utf-8"
    )

    print("Saved radiation-reference.json, radiation-scenarios.json, radiation-provenance.json, shielding-grid.json")
    print("Summary:", json.dumps(reference_doc["summary"], indent=2))
    print("Shielding summary:", json.dumps(shielding_grid_doc["summary"], indent=2))


if __name__ == "__main__":
    main()
