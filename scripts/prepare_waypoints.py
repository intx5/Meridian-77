"""Build waypoint cards from real Perseverance traverse positions and local rasters.

Coordinates are traverse endpoints from nasa_Traverse_geo.json (M20 traverse to sol 2022).
Surface images are NASA Mars 2020 raw Mastcam-Z frames from the same sol; the delta
panorama is PIA24921 (Mastcam-Z, sols 466-474). Mineral fields show the measured CRISM
2.30 micron band depth at the point; regional mineral context is labelled as context.
"""
from __future__ import annotations

import io
import json
import urllib.request
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "public/data/jezero"
POV = DATA / "pov"
CACHE = ROOT / ".cache"
CACHE.mkdir(exist_ok=True)
POV.mkdir(exist_ok=True)
Image.MAX_IMAGE_PIXELS = None

traverse = json.loads((ROOT / "nasa_Traverse_geo.json").read_text())
by_sol = {f["properties"]["sol"]: f["geometry"]["coordinates"][-1] for f in traverse["features"]}
region = json.loads((DATA / "layers.json").read_text())["region"]
bounds = region["bounds"]
geology_legend = {u["color"].upper(): u for u in json.loads((DATA / "geology-legend.json").read_text())["units"]}
geology_img = np.array(Image.open(DATA / "geology.webp").convert("RGB"))
geology_colors = sorted({tuple(c) for c in geology_img.reshape(-1, 3)[::17]})
dem = json.loads((DATA / "dem.json").read_text())
thermal = json.loads((DATA / "thermal.json").read_text())
mineral = json.loads((DATA / "mineralogy.json").read_text())
NO_DATA = -9999.0


def grid_value(doc: dict, lon: float, lat: float) -> float:
    b = doc["bounds"]
    w, h = doc["width"], doc["height"]
    c = min(max(int((lon - b[0]) / (b[2] - b[0]) * w), 0), w - 1)
    r = min(max(int((b[3] - lat) / (b[3] - b[1]) * h), 0), h - 1)
    return float(doc["values"][r * w + c])


def geology_unit(lon: float, lat: float) -> dict:
    h, w = geology_img.shape[:2]
    c = min(max(int((lon - bounds[0]) / (bounds[2] - bounds[0]) * w), 0), w - 1)
    r = min(max(int((bounds[3] - lat) / (bounds[3] - bounds[1]) * h), 0), h - 1)
    color = geology_img[r, c]
    key = "#%02X%02X%02X" % tuple(int(v) for v in color)
    unit = geology_legend.get(key)
    return {"unit": unit["symbol"] if unit else None, "label": unit["label"] if unit else "Unmapped",
            "color": key}


def fetch_raw(sol: int) -> dict | None:
    url = ("https://mars.nasa.gov/rss/api/?feed=raw_images&category=mars2020&feedtype=json"
           f"&num=80&sol={sol}&camera=MCZ_LEFT")
    try:
        with urllib.request.urlopen(url, timeout=60) as r:
            payload = json.loads(r.read())
    except Exception as exc:  # network failure is reported, not hidden
        print("raw fetch failed", sol, exc)
        return None
    candidates = [i for i in payload.get("images", [])
                  if "RGB" in i["camera"].get("filter_name", "")
                  and i["camera"].get("instrument", "").startswith("MCZ_LEFT")]
    if not candidates:
        return None
    best, best_std = None, -1.0
    for candidate in candidates[:12]:
        try:
            with urllib.request.urlopen(candidate["image_files"]["medium"], timeout=30) as r:
                probe = Image.open(io.BytesIO(r.read())).convert("RGB")
            contrast = float(np.array(probe).std())
        except Exception:
            continue
        if probe.width >= 400 and contrast > best_std:
            best, best_std = candidate, contrast
    return best


def prepare_image(name: str, url: str, width: int = 1280) -> str | None:
    out = POV / f"{name}.webp"
    raw = CACHE / f"{name}.jpg"
    try:
        if url.startswith(("http://", "https://")):
            if not raw.exists():
                urllib.request.urlretrieve(url, raw)
            source = raw
        else:
            source = Path(url)
        im = Image.open(source).convert("RGB")
        if im.width > width:
            im = im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)
        im.save(out, "WEBP", quality=82, method=6)
        return f"/data/jezero/pov/{name}.webp"
    except Exception as exc:
        print("image failed", name, exc)
        return None


CASES = [
    {"id": "wp-01", "name": "Octavia E. Butler Landing", "sol": 14, "kind": "start",
     "context": "Landing-site traverse start on the Jezero crater floor; regional mafic crater-floor units.",
     "image": None},
    {"id": "wp-02", "name": "Skinner Ridge · delta front", "sol": 490, "kind": "science",
     "lon": 77.40617078, "lat": 18.458931,
     "context": "Swift Run core (sol 490) and the Mastcam-Z delta panorama (PIA24921, sols 466-474) from this front; regional clay and carbonate context.",
     "image": "delta-panorama"},
    {"id": "wp-04", "name": "High-inertia bench", "sol": 766, "kind": "science",
     "lon": 77.36927, "lat": 18.47989,
     "context": "Crater-floor bench with high thermal inertia, a rockier surface flagged by the planning assumption.",
     "image": "sol766-pov"},
    {"id": "wp-05", "name": "Upper delta margin", "sol": 1000, "kind": "science",
     "context": "Upper delta traverse position; regional fan-unit context.",
     "image": "sol1000-pov"},
]

images = {}
for case in CASES:
    if case["image"] == "delta-panorama":
        images[case["id"]] = prepare_image(
            "delta-panorama",
            "https://assets.science.nasa.gov/dynamicimage/assets/science/psd/photojournal/pia/pia24/pia24921/PIA24921.jpg?w=2400",
            1600,
        )
    elif case["image"]:
        meta = fetch_raw(case["sol"])
        if meta:
            images[case["id"]] = prepare_image(case["image"], meta["image_files"]["medium"])
            print("fetched", case["sol"], meta["imageid"])

waypoints = []
for case in CASES:
    lon, lat = case.get("lon"), case.get("lat")
    if lon is None:
        lon, lat = by_sol[case["sol"]][:2]
    dem_m = grid_value(dem, lon, lat)
    thermal_v = grid_value(thermal, lon, lat)
    mineral_v = grid_value(mineral, lon, lat)
    unit = geology_unit(lon, lat)
    minerals = []
    if mineral_v != NO_DATA and mineral_v >= 0.02:
        minerals = ["phyllosilicates (strong 2.3 µm candidate)"]
    elif mineral_v != NO_DATA and mineral_v >= 0.01:
        minerals = ["phyllosilicates (weak 2.3 µm candidate)"]
    note = (f"{case['context']} USGS map unit: {unit['unit'] or 'unmapped'} ({unit['label']}). "
            f"CRISM 2.30 µm band depth {mineral_v:.3f} "
            f"({'detected' if minerals else 'below the 0.010 candidate threshold'}); "
            f"DEM {dem_m:.0f} m, thermal inertia {thermal_v:.0f} SI.")
    card = {
        "id": case["id"], "name": case["name"], "lon": round(lon, 6), "lat": round(lat, 6),
        "kind": case["kind"], "sol": case["sol"],
        "imageUrl": images.get(case["id"]),
        "imageCredit": "NASA/JPL-Caltech/ASU/MSSS",
        "sourceUrl": ("https://science.nasa.gov/photojournal/detailed-panorama-of-mars-jezero-crater-delta/"
                      if case["image"] == "delta-panorama"
                      else f"https://mars.nasa.gov/mars2020/multimedia/raw-images/?sol={case['sol']}"),
        "minerals": minerals,
        "note": note,
        "geologyUnit": unit,
        "spectral": {"bandDepth2300": round(mineral_v, 4), "threshold": 0.01},
        "thermalInertia": round(thermal_v, 1),
        "elevationM": round(dem_m, 1),
        "locationBasis": f"Perseverance traverse endpoint for sol {case['sol']} (M20 traverse GeoJSON)",
    }
    waypoints.append(card)
    print(card["id"], card["name"], card["lon"], card["lat"], "image", bool(card["imageUrl"]),
          "BD", card["spectral"]["bandDepth2300"], "unit", unit["unit"])

(DATA / "waypoints.json").write_text(json.dumps(waypoints, indent=2))
print("wrote", len(waypoints), "waypoints")
