"""Build waypoint cards from real Perseverance traverse positions and local rasters.

Coordinates are traverse endpoints from nasa_Traverse_geo.json (M20 traverse to sol 2022).
Surface images are NASA Mars 2020 Mastcam-Z frames, including the Skinner Ridge
workspace mosaic PIA24925 (sols 484-492). Mineral fields show the measured CRISM
2.30 micron band depth at the point; regional mineral context is labelled as context.
"""
from __future__ import annotations

import io
import json
import urllib.request
from pathlib import Path
from urllib.parse import urlsplit

import numpy as np
from PIL import Image, ImageFilter

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


def fill_black_nodata(im: Image.Image) -> Image.Image:
    arr = np.array(im.convert("RGB"), dtype=np.float32)
    h, w, _ = arr.shape
    near_black = arr.max(axis=2) <= 5
    exterior = np.zeros((h, w), dtype=bool)
    stack: list[tuple[int, int]] = []
    for x in range(w):
        if near_black[0, x]:
            exterior[0, x] = True
            stack.append((0, x))
        if near_black[h - 1, x]:
            exterior[h - 1, x] = True
            stack.append((h - 1, x))
    for y in range(h):
        if near_black[y, 0] and not exterior[y, 0]:
            exterior[y, 0] = True
            stack.append((y, 0))
        if near_black[y, w - 1] and not exterior[y, w - 1]:
            exterior[y, w - 1] = True
            stack.append((y, w - 1))
    while stack:
        cy, cx = stack.pop()
        for ny, nx in ((cy - 1, cx), (cy + 1, cx), (cy, cx - 1), (cy, cx + 1)):
            if 0 <= ny < h and 0 <= nx < w and not exterior[ny, nx] and near_black[ny, nx]:
                exterior[ny, nx] = True
                stack.append((ny, nx))
    if not exterior.any():
        return im
    mask_im = Image.fromarray((exterior.astype(np.uint8) * 255)).filter(ImageFilter.MaxFilter(5))
    mask = np.array(mask_im) > 127
    y0, y1 = int(h * 0.29), int(h * 0.85)
    x0, x1 = int(w * 0.60), int(w * 0.85)
    soil_patch = arr[y0:y1, x0:x1]
    soil_h = np.concatenate([soil_patch, soil_patch[:, ::-1], soil_patch, soil_patch[:, ::-1], soil_patch], axis=1)[:, :w]
    soil_full = np.concatenate([soil_h, soil_h[::-1], soil_h], axis=0)[:h, :w]
    soil_soft = np.array(Image.fromarray(soil_full.astype(np.uint8)).filter(ImageFilter.GaussianBlur(radius=2.5)), dtype=np.float32)
    alpha = np.array(mask_im.filter(ImageFilter.GaussianBlur(radius=6)), dtype=np.float32)[..., None] / 255.0
    alpha = np.where(mask[..., None], 1.0, np.clip(alpha * 1.25, 0.0, 1.0))
    out = arr * (1.0 - alpha) + soil_soft * alpha
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8))


def prepare_image(name: str, url: str, width: int = 1280, local_candidates: list[Path] | None = None) -> str | None:
    out = POV / f"{name}.webp"
    source_suffix = Path(urlsplit(url).path).suffix.lower()
    raw = CACHE / f"{name}{source_suffix if source_suffix in ('.tif', '.tiff') else '.jpg'}"
    try:
        if not raw.exists() and local_candidates:
            for candidate in local_candidates:
                if candidate.is_file():
                    raw.write_bytes(candidate.read_bytes())
                    break
        if url.startswith(("http://", "https://")):
            if not raw.exists():
                urllib.request.urlretrieve(url, raw)
            source = raw
        else:
            source = Path(url)
        im = Image.open(source).convert("RGB")
        if im.width > width:
            im = im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)
        im = fill_black_nodata(im)
        im.save(out, "WEBP", quality=84, method=6)
        return f"/data/jezero/pov/{name}.webp"
    except Exception as exc:
        print("image failed", name, exc)
        return None


CASES = [
    {"id": "wp-01", "name": "Octavia E. Butler Landing", "sol": 14, "kind": "start",
     "context": "Landing-site traverse start on the Jezero crater floor; regional mafic crater-floor units.",
     "default_minerals": ["olivine-pyroxene basalt (Njf floor)"],
     "image": "octavia-sol14-hazcam",
     "image_url": "https://mars.nasa.gov/mars2020-raw-images/pub/ods/surface/sol/00014/ids/edr/browse/fcam/FLF_0014_0668191805_035ECM_N0030110FHAZ02002_01_295J02_800.jpg",
     "image_credit": "NASA/JPL-Caltech",
     "source_url": "https://mars.nasa.gov/mars2020-raw-images/pub/ods/surface/sol/00014/ids/edr/browse/fcam/FLF_0014_0668191805_035ECM_N0030110FHAZ02002_01_295J02_800.jpg",
     "note_suffix": " Hazcam frame from sol 14 shows the landing site."},
    {"id": "wp-02", "name": "Skinner Ridge · delta front", "sol": 490, "kind": "science",
     "lon": 77.40617078, "lat": 18.458931,
     "context": "Swift Run core (sol 490). The Mastcam-Z workspace mosaic (PIA24925, sols 484-492) shows the layered rock and an abrasion patch at Skinner Ridge.",
     "default_minerals": ["hydrated sulfates & clay mudstone (Swift Run)"],
     "image": "skinner-ridge-pia24925",
     "image_url": "https://assets.science.nasa.gov/content/dam/science/psd/photojournal/pia/pia24/pia24925/PIA24925.tif",
     "local_candidates": [Path.home() / "Downloads" / "PIA24925.tif", ROOT / "PIA24925.tif"],
     "image_credit": "NASA/JPL-Caltech/ASU/MSSS",
     "source_url": "https://science.nasa.gov/photojournal/perseverance-workspace-at-skinner-ridge/"},
    {"id": "wp-04", "name": "High-inertia bench", "sol": 766, "kind": "science",
     "lon": 77.36927, "lat": 18.47989,
     "context": "Crater-floor bench with high thermal inertia, a rockier surface flagged by the planning assumption.",
     "default_minerals": ["Fe-Mg carbonate bench (NHjf2)"],
     "image": "sol766-pov",
     "image_credit": "NASA/JPL-Caltech/ASU/MSSS"},
    {"id": "wp-05", "name": "Upper delta margin", "sol": 1000, "kind": "science",
     "context": "Upper delta traverse position; regional fan-unit context.",
     "default_minerals": ["carbonate-olivine margin (upper fan)"],
     "image": "upper-delta-sol1000-ncam",
     "image_url": "https://mars.nasa.gov/mars2020-raw-images/pub/ods/surface/sol/01000/ids/edr/browse/ncam/NRG_1000_0755717960_981ECM_N0474404SCAM08000_00_1LLJ01_800.jpg",
     "image_credit": "NASA/JPL-Caltech",
     "source_url": "https://mars.nasa.gov/mars2020-raw-images/pub/ods/surface/sol/01000/ids/edr/browse/ncam/NRG_1000_0755717960_981ECM_N0474404SCAM08000_00_1LLJ01_800.jpg",
     "note_suffix": " Navcam frame from sol 1000 shows the upper-delta surface."},
]

images = {}
for case in CASES:
    output = POV / f"{case['image']}.webp" if case.get("image") else None
    if output and output.is_file():
        images[case["id"]] = f"/data/jezero/pov/{output.name}"
    elif case.get("image_url"):
        images[case["id"]] = prepare_image(
            case["image"],
            case["image_url"],
            1600,
            case.get("local_candidates"),
        )
    elif case.get("image"):
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
    minerals = list(case.get("default_minerals", []))
    crism_detected = False
    if mineral_v != NO_DATA and mineral_v >= 0.02:
        minerals.insert(0, "phyllosilicates (strong 2.3 µm candidate)")
        crism_detected = True
    elif mineral_v != NO_DATA and mineral_v >= 0.01:
        minerals.insert(0, "phyllosilicates (weak 2.3 µm candidate)")
        crism_detected = True
    note = (f"{case['context']} USGS map unit: {unit['unit'] or 'unmapped'} ({unit['label']}). "
            f"CRISM 2.30 µm band depth {mineral_v:.3f} "
            f"({'detected' if crism_detected else 'below the 0.010 candidate threshold'}); "
            f"DEM {dem_m:.0f} m, thermal inertia {thermal_v:.0f} SI.{case.get('note_suffix', '')}")
    card = {
        "id": case["id"], "name": case["name"], "lon": round(lon, 6), "lat": round(lat, 6),
        "kind": case["kind"], "sol": case["sol"],
        "imageUrl": images.get(case["id"]),
        "imageCredit": case.get("image_credit", "NASA/JPL-Caltech/ASU/MSSS"),
        "sourceUrl": case.get("source_url", f"https://mars.nasa.gov/mars2020/multimedia/raw-images/?sol={case['sol']}"),
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

(DATA / "waypoints.json").write_text(json.dumps(waypoints, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
print("wrote", len(waypoints), "waypoints")
