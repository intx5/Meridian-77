"""Tile existing, declared co-registered web rasters. No synthetic terrain or reprojection.
Run: python scripts/prepare_terrain.py [--verify | --prepare-mola]
Requires numpy and Pillow. The optional MOLA export also uses rasterio.
"""
import hashlib
import json
import sys
from pathlib import Path
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'public/data/jezero'
OUT = DATA / 'terrain'
COUNT = 8
GUTTER = 2

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def prepare_mola():
    import rasterio

    path = ROOT / 'MOLA_Jezero_Corridor_DEM_463m.tif'
    with rasterio.open(path) as source:
        projection = source.crs.to_dict()
        radius = 3396000
        if projection['proj'] != 'eqc' or projection.get('R') != radius or any(
            projection.get(key, 0) != 0 for key in ('lat_ts', 'lat_0', 'lon_0', 'x_0', 'y_0')
        ) or source.transform.b or source.transform.d or source.transform.a <= 0 or source.transform.e >= 0:
            raise ValueError('Expected a north-up Mars MOLA crop in equatorial equirectangular metres')
        no_data = -9999
        raster = {
            'bounds': np.degrees(np.asarray(source.bounds) / radius).tolist(),
            'width': source.width, 'height': source.height, 'noData': no_data,
            'values': source.read(1, masked=True).filled(no_data).ravel().tolist(),
            'sourceUrl': source.tags().get('SOURCE_URL'),
            'sourceSha256': digest(path),
            'sourceResolutionProjectedM': source.transform.a,
            'verticalReference': 'MOLA areoid',
        }
    target = OUT / 'mola-dem.json'
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(raster, separators=(',', ':')) + '\n', encoding='utf-8')
    print(f'Exported native {raster["width"]}×{raster["height"]} MOLA grid for 3D gap fill')

def main():
    manifest = json.loads((DATA / 'layers.json').read_text(encoding='utf-8'))
    dem = json.loads((DATA / 'dem.json').read_text(encoding='utf-8'))
    region = manifest['region']
    assert dem['bounds'] == region['bounds']
    assert dem['projectedBoundsM'] == region['projectedBoundsM']
    assert len(dem['values']) == dem['width'] * dem['height']
    assert dem['width'] % COUNT == dem['height'] % COUNT == 0
    assert np.max(np.abs(np.radians(region['bounds']) * 3396190 - region['projectedBoundsM'])) < 1e-6
    layers = {p['id']: DATA / Path(p['imageUrl']).name for p in manifest['layers']}
    layers['slope'] = DATA / 'slope.webp'
    layers['shielding'] = DATA / 'shielding.webp'
    layers['radiation-sep-total'] = DATA / 'radiation-sep-total.webp'
    layers['radiation-gcr'] = DATA / 'radiation-gcr.webp'
    layers['radiation-sep'] = DATA / 'radiation-sep.webp'
    layers['optical-low'] = DATA / 'optical.webp'
    metadata = {
        'version': 1, 'count': COUNT, 'gutter': GUTTER, 'bounds': dem['bounds'],
        'demSha256': digest(DATA/'dem.json'), 'demWidth': dem['width'], 'demHeight': dem['height'],
        'gridSpacingProjectedM': dem['cellSizeM'], 'layers': {},
        'registration': 'Same declared bounds and north-first pixel-centre convention as 2D. Absolute optical registration is not independently certified; original optical preparation is absent.',
    }
    verify = '--verify' in sys.argv
    for name, path in layers.items():
        source = Image.open(path).convert('RGBA')
        if name == 'optical-low':
            source = source.resize((1280,1280),Image.Resampling.LANCZOS)
        assert source.width % COUNT == source.height % COUNT == 0
        size = source.width // COUNT
        metadata['layers'][name] = {'sourceSha256': digest(path), 'sourceSize': list(source.size), 'tileSize': size}
        for row in range(COUNT):
            for col in range(COUNT):
                box = (col*size,row*size,(col+1)*size,(row+1)*size)
                tile = source.crop(box)
                # Shared gutters prevent bilinear/mipmap edge lines. Clamp only at outer region.
                coords_x = np.clip(np.arange(box[0]-GUTTER, box[2]+GUTTER),0,source.width-1)
                coords_y = np.clip(np.arange(box[1]-GUTTER, box[3]+GUTTER),0,source.height-1)
                expanded = Image.fromarray(np.asarray(source)[np.ix_(coords_y,coords_x)])
                target = OUT / name / f'{col}-{row}.webp'
                if verify:
                    actual = Image.open(target).convert('RGBA')
                    assert actual.size == expanded.size
                    # Lossless output preserves the existing WebP pixels, including alpha.
                    assert np.array_equal(np.asarray(actual), np.asarray(expanded)), target
                    assert np.array_equal(np.asarray(actual)[GUTTER:-GUTTER,GUTTER:-GUTTER],np.asarray(tile))
                else:
                    target.parent.mkdir(parents=True,exist_ok=True)
                    expanded.save(target,format='WEBP',lossless=True,method=4,exact=True)
        print(f'{name}: 64 tiles, {size} px + gutter, verified' if verify else f'{name}: tiled {source.size}')
    if verify:
        assert json.loads((OUT/'manifest.json').read_text(encoding='utf-8')) == metadata
    else:
        (OUT/'manifest.json').write_text(json.dumps(metadata,indent=2)+'\n',encoding='utf-8')
    print('EQC bounds, dimensions, source hashes and tile registration OK')

if __name__ == '__main__':
    if '--prepare-mola' in sys.argv:
        prepare_mola()
    else:
        main()
