## -- -- -- -- 05_rfClassification

# Generate classification and probability maps for rocky outcrops in the Cerrado biome
# Description: This script generates annual probability maps and classification layers for rocky outcrop and other land cover classes in the Brazilian Cerrado biome
# using Landsat mosaics, spectral and terrain variables, and a Random Forest classifier trained with sample points.

# Author: barbara.silva@ipam.org.br 

# Import libraries
import ee
import sys
import os
import math
import itertools

# Authenticate and initialize Earth Engine
ee.Authenticate()
ee.Initialize()

# Clone the GitHub repository with helper functions
!rm -rf /content/mapbiomas-mosaic
!git clone https://github.com/costa-barbara/mapbiomas-mosaic.git
sys.path.append("/content/mapbiomas-mosaic")

# Import custom modules for mosaicking and spectral metrics
from modules.SpectralIndexes import *
from modules.Miscellaneous import *
from modules.Mosaic import *
from modules.SmaAndNdfi import *
from modules.ThreeYearMetrics import *
from modules import Map

# Set input and output version
samples_version = '4'
output_version = '4'
output_asset = 'projects/mapbiomas-workspace/COLECAO_DEV/COLECAO10_DEV/CERRADO/LANDSAT/C10-ROCKY-GENERAL-MAP-PROBABILITY/'

# Define years to classify
years = list(range(1985, 2025))

# Class label dictionary
classDict = {
    1: 'Forest',
    2: 'Water',
    3: 'Shrubby',
    4: 'Anthropic',
    29: 'RockyOutcrop'
}

# Load AOI
aoi_vec = ee.FeatureCollection(
    'projects/ee-barbarasilvaipam/assets/collection-10_rocky-outcrop/masks/aoi_v2'
).geometry()
aoi_img = ee.Image(1).clip(aoi_vec)

# Define Landsat collection and spectral bands
collectionId = 'LANDSAT/COMPOSITES/C02/T1_L2_32DAY'
spectralBands = ['blue', 'red', 'green', 'nir', 'swir1', 'swir2']

# Load geomorphometric layers
def load_geomorpho():
    return {
        'merit_dem': ee.Image('MERIT/DEM/v1_0_3').select('dem').int16().rename('merit_dem'),
        'slope_geomorpho': ee.ImageCollection("projects/sat-io/open-datasets/Geomorpho90m/slope").mosaic().multiply(10000).round().rename('slope_geomorpho').toInt64(),
        'aspect': ee.ImageCollection("projects/sat-io/open-datasets/Geomorpho90m/aspect").mosaic().multiply(10000).round().rename('aspect').toInt64(),
        'aspect_cosine': ee.ImageCollection("projects/sat-io/open-datasets/Geomorpho90m/aspect-cosine").mosaic().multiply(10000).round().rename('aspect_cosine').toInt64(),
        'aspect_sine': ee.ImageCollection("projects/sat-io/open-datasets/Geomorpho90m/aspect-sine").mosaic().multiply(10000).round().rename('aspect_sine').toInt64(),
        'pcurv': ee.ImageCollection("projects/sat-io/open-datasets/Geomorpho90m/pcurv").mosaic().multiply(10000).round().rename('pcurv').toInt64(),
        'tcurv': ee.ImageCollection("projects/sat-io/open-datasets/Geomorpho90m/tcurv").mosaic().multiply(10000).round().rename('tcurv').toInt64(),
        'convergence': ee.ImageCollection("projects/sat-io/open-datasets/Geomorpho90m/convergence").mosaic().multiply(10000).round().rename('convergence').toInt64(),
        'roughness': ee.ImageCollection("projects/sat-io/open-datasets/Geomorpho90m/roughness").mosaic().multiply(10000).round().rename('roughness').toInt64(),
        'eastness': ee.ImageCollection("projects/sat-io/open-datasets/Geomorpho90m/eastness").mosaic().multiply(10000).round().rename('eastness').toInt64(),
        'northness': ee.ImageCollection("projects/sat-io/open-datasets/Geomorpho90m/northness").mosaic().multiply(10000).round().rename('northness').toInt64(),
        'dxx': ee.ImageCollection("projects/sat-io/open-datasets/Geomorpho90m/dxx").mosaic().multiply(10000).round().rename('dxx').toInt64(),
        'tri': ee.ImageCollection("projects/sat-io/open-datasets/Geomorpho90m/tri").mosaic().multiply(10000).round().rename('tri').toInt64(),
        'tpi': ee.ImageCollection("projects/sat-io/open-datasets/Geomorpho90m/tpi").mosaic().multiply(10000).round().rename('tpi').toInt64(),
        'cti': ee.ImageCollection("projects/sat-io/open-datasets/Geomorpho90m/cti").mosaic().multiply(10000).round().rename('cti').toInt64(),
    }

geomorpho = load_geomorpho()
mosaic_dict = {}

# Compute 3-year metrics
def compute_3yr_metrics(year, mosaic, mosaic_dict, aoi_img):
    if year < min(mosaic_dict.keys()) + 2:
        return mosaic.addBands(ee.Image(0).rename('amp_ndvi_3yr').updateMask(aoi_img))\
                     .addBands(ee.Image(0).rename('var_ndvi_p25_3yr').updateMask(aoi_img))\
                     .addBands(ee.Image(0).rename('var_nbr_median_3yr').updateMask(aoi_img))

    mosaics_3yr = [mosaic_dict[y] for y in [year, year - 1, year - 2]]
    ndvi_stack = ee.ImageCollection.fromImages([m.select('ndvi_p25') for m in mosaics_3yr])
    nbr_stack = ee.ImageCollection.fromImages([m.select('nbr_median') for m in mosaics_3yr])
    amp_ndvi = ee.ImageCollection.fromImages([m.select('ndvi_median_wet') for m in mosaics_3yr]).max()\
                .subtract(ee.ImageCollection.fromImages([m.select('ndvi_median_dry') for m in mosaics_3yr]).min())\
                .rename('amp_ndvi_3yr')
    var_p25 = ndvi_stack.map(lambda i: i.subtract(ndvi_stack.reduce(ee.Reducer.mean())).pow(2))\
                .reduce(ee.Reducer.mean()).rename('var_ndvi_p25_3yr')
    var_nbr = nbr_stack.map(lambda i: i.subtract(nbr_stack.reduce(ee.Reducer.mean())).pow(2))\
                .reduce(ee.Reducer.mean()).rename('var_nbr_median_3yr')

    return mosaic.addBands(amp_ndvi.updateMask(aoi_img))\
                 .addBands(var_p25.updateMask(aoi_img))\
                 .addBands(var_nbr.updateMask(aoi_img))

# Main classification loop
for year in years:
    print(f'--> Processing year: {year}')

    # Generate auxiliary bands
    coords = ee.Image.pixelLonLat().clip(aoi_vec)
    lat = coords.select('latitude').add(5).multiply(-1).multiply(1000).toInt16()
    lon_sin = coords.select('longitude').multiply(math.pi / 180).sin().multiply(-1).multiply(10000).toInt16().rename('longitude_sin')
    lon_cos = coords.select('longitude').multiply(math.pi / 180).cos().multiply(-1).multiply(10000).toInt16().rename('longitude_cos')
    hand = ee.ImageCollection("users/gena/global-hand/hand-100").mosaic().clip(aoi_vec).rename('hand').toInt16()

    # Filter Landsat collection
    dateStart = ee.Date.fromYMD(year, 1, 1)
    dateEnd = dateStart.advance(1, 'year')
    collection = ee.ImageCollection(collectionId)\
        .filterDate(dateStart, dateEnd)\
        .filterBounds(aoi_vec)\
        .select(spectralBands)\
        .map(lambda img: img.multiply(10000).copyProperties(img, ['system:time_start']))

    # Apply indices and generate mosaic
    collection = collection.map(getNDVI).map(getNBR).map(getMNDWI).map(getPRI).map(getCAI).map(getEVI2)\
                           .map(getGCVI).map(getGRND).map(getMSI).map(getGARI).map(getGNDVI).map(getMSAVI)\
                           .map(getTGSI).map(getHallCover).map(getHallHeigth)
    mosaic = getMosaic(collection, dateStart, dateEnd, 'ndvi', 25, 75, 5, 95)
    mosaic = getSlope(mosaic).addBands(getEntropyG(mosaic)).clip(aoi_vec)
    mosaic = mosaic.multiply(10000).round().int64()

    # Add auxiliary variables
    mosaic = mosaic.addBands(lat).addBands(lon_sin).addBands(lon_cos).addBands(hand)
    for b in geomorpho.values():
        mosaic = mosaic.addBands(b)
    mosaic = mosaic.addBands(ee.Image(year).int16().rename('year'))

    # Store and compute 3-year metrics
    mosaic_dict[year] = mosaic
    mosaic = compute_3yr_metrics(year, mosaic, mosaic_dict, aoi_img)

    # Load training data
    training_path = f'projects/ee-barbarasilvaipam/assets/collection-10_rocky-outcrop/trainings/v{samples_version}/train_col10_rocky_{year}_v{samples_version}'
    training = ee.FeatureCollection(training_path)

    # Train Random Forest classifier
    band_names = mosaic.bandNames().getInfo()
    classifier = ee.Classifier.smileRandomForest(300, int(math.sqrt(len(band_names))))\
                    .setOutputMode('MULTIPROBABILITY')\
                    .train(training, 'class', band_names)

    # Apply classification
    prediction = mosaic.classify(classifier).updateMask(aoi_img)
    classes = sorted(training.aggregate_array('class').distinct().getInfo())
    probs = prediction.arrayFlatten([list(map(str, classes))])
    probs = probs.select(list(map(str, classes)), [classDict[int(c)] for c in classes if int(c) in classDict])
    probs = probs.multiply(100).round().toInt8()

    # Generate classified image
    classification = probs.toArray().arrayArgmax().arrayGet([0]).remap(list(range(len(classes))), classes).rename('classification')
    toExport = classification.addBands(probs).set('collection', '10').set('version', output_version).set('biome', 'CERRADO').set('year', year)

    # Export to asset
    file_name = f'CERRADO_ROCKY_{year}_v{output_version}'
    task = ee.batch.Export.image.toAsset(
        image=toExport,
        description=file_name,
        assetId=output_asset + file_name,
        scale=30,
        maxPixels=1e13,
        pyramidingPolicy={'.default': 'mode'},
        region=aoi_img.geometry()
    )
    task.start()

print('All classification export tasks started.')
