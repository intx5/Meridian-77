"""Optional source-level checks against the large local NASA products.

Requires rasterio, numpy, Pillow. Does not download or change scientific inputs.
Registration correlation is a consistency check, not a certified positional accuracy.
"""
import json
from pathlib import Path
import numpy as np
import rasterio
from rasterio.enums import Resampling
from rasterio.windows import from_bounds
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'public/data/jezero'
manifest = json.loads((DATA/'layers.json').read_text(encoding='utf-8'))
waypoints = json.loads((DATA/'waypoints.json').read_text(encoding='utf-8'))
bounds = manifest['region']['projectedBoundsM']
report = {'limitations': 'Declared EQC coordinates and image correlation are checked. This is not an independent control-network or vertical-datum certification.'}

with rasterio.open('zip://' + (ROOT/'Jezero_ChannelFan_DEM.zip').as_posix() + '!Jezero_ChannelFan_DEM.tif') as source:
    coords = [(3396190*np.radians(p['lon']),3396190*np.radians(p['lat'])) for p in waypoints]
    report['localDem'] = {
        'gridSpacingM': list(source.res), 'bounds': list(source.bounds),
        'stations': [{'id':p['id'],'publishedSampleM':p.get('elevationM'),'sourceNearestM':round(float(value[0]),4),
                      'differenceM':round(float(value[0])-p['elevationM'],4)} for p,value in zip(waypoints,source.sample(coords))],
    }

with rasterio.open(ROOT/'PSP_003798_1985_Edited_affine_25cm_Eqc_latTs0_lon0_offNadir.tif') as source:
    size = 500
    original = source.read(1,window=from_bounds(*bounds,transform=source.transform),out_shape=(size,size),
                           boundless=True,fill_value=0,resampling=Resampling.bilinear).astype(float)
    displayed = np.asarray(Image.open(DATA/'optical.webp').convert('L').resize((size,size),Image.Resampling.BILINEAR)).astype(float)
    results = []
    # A sample is 20 projected m. Compare a +/- 60 m displacement in each axis.
    for dy in range(-3,4):
        for dx in range(-3,4):
            base = original[4:-4,4:-4]
            candidate = displayed[4+dy:size-4+dy,4+dx:size-4+dx]
            valid = (base>5)&(candidate>5)
            results.append({'eastShiftProjectedM':dx*20,'southShiftProjectedM':dy*20,
                            'correlation':round(float(np.corrcoef(base[valid],candidate[valid])[0,1]),6),
                            'pixels':int(valid.sum())})
    report['opticalConsistency'] = {
        'source':source.name,'nativeGridM':list(source.res),'comparisonGridProjectedM':20,
        'zeroOffset':next(r for r in results if r['eastShiftProjectedM']==r['southShiftProjectedM']==0),
        'bestOffset':max(results,key=lambda r:r['correlation']),
        'scope':'Only overlap with this local HiRISE image; does not certify CTX-filled areas or sub-grid registration.'}

output = ROOT/'docs/terrain-source-verification.json'
output.write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
print(json.dumps(report,indent=2))
