## -- -- -- -- 05_rfClassification
# Generate classification and probability maps for rocky outcrops in the Cerrado biome
# Description: This script generates annual probability maps and classification layers for rocky outcrop and other land cover classes in the Brazilian Cerrado biome
# using Landsat mosaics, spectral and geomorphometric variables, and a Random Forest classifier trained with sample points.

# Author: barbara.silva@ipam.org.br 

## Read libraries
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
    'projects/ee-barbarasilvaipam/assets/collection-10_rocky-outcrop/masks/aoi_v4'
).geometry()
aoi_img = ee.Image(1).clip(aoi_vec)

# Define Landsat collection and spectral bands
collectionId = 'LANDSAT/COMPOSITES/C02/T1_L2_32DAY'
spectralBands = ['blue', 'red', 'green', 'nir', 'swir1', 'swir2']

# Load geomorphometric layers
def load_geomorpho():
    return {
    'dem': ee.Image('MERIT/DEM/v1_0_3').select('dem').toInt64().rename('merit_dem'),
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

# Main classification loop
for year in years:
    print(f'--> Processing year: {year}')

    # Generate pixel-based coordinates
    coords = ee.Image.pixelLonLat().clip(aoi_vec)
    lat = coords.select('latitude').add(5).multiply(-1).multiply(1000).toInt16()
    lon_sin = coords.select('longitude').multiply(math.pi / 180).sin().multiply(-1).multiply(10000).toInt16().rename('longitude_sin')
    lon_cos = coords.select('longitude').multiply(math.pi / 180).cos().multiply(-1).multiply(10000).toInt16().rename('longitude_cos')

    # Load HAND (height above nearest drainage)
    hand = ee.ImageCollection("users/gena/global-hand/hand-100").mosaic().clip(aoi_vec).rename('hand').toInt16()

    # Set mosaic time window (April to October)
    dateStart = ee.Date.fromYMD(year, 1, 1)
    dateEnd = dateStart.advance(1, 'year')

    # Load and filter Landsat imagery
    collection = ee.ImageCollection(collectionId)\
        .filterDate(dateStart, dateEnd)\
        .filterBounds(aoi_vec)\
        .select(spectralBands)\
        .map(lambda img: img.multiply(10000).copyProperties(img, ['system:time_start', 'system:time_end']))

    # Apply indices and generate mosaic
    collection = collection.map(getNDVI).map(getNBR).map(getMNDWI).map(getPRI).map(getCAI).map(getEVI2)\
                           .map(getGCVI).map(getGRND).map(getMSI).map(getGARI).map(getGNDVI).map(getMSAVI)\
                           .map(getTGSI).map(getHallCover).map(getHallHeigth)

    # Generate mosaic using custom method
    mosaic = getMosaic(
        collection=collection,
        dateStart=dateStart,
        dateEnd=dateEnd,
        percentileBand='ndvi',
        percentileDry=25,
        percentileWet=75,
        percentileMin=5,
        percentileMax=95
    )

    # Add terrain and geomorpho features
    mosaic = getSlope(mosaic)
    mosaic = getEntropyG(mosaic)
    mosaic = mosaic.addBands(lat).addBands(lon_sin).addBands(lon_cos).addBands(hand)
    for key in geomorpho:
        mosaic = mosaic.addBands(geomorpho[key])

    # Store and compute 3-year metrics
    mosaic_dict[year] = mosaic
    mosaic = addThreeYearMetrics(year, mosaic, mosaic_dict)
    mosaic = mosaic.clip(aoi_vec).multiply(10000).round().int64()
    mosaic = mosaic.addBands(ee.Image(year).int16().rename('year'))

    # Load training data
    training_path = f'projects/ee-barbarasilvaipam/assets/collection-10_rocky-outcrop/trainings/v{samples_version}/train_col10_rocky_{year}_v{samples_version}'
    training = ee.FeatureCollection(training_path)
    bandNames_list = mosaic.bandNames().getInfo()

    # Train Random Forest classifier
    band_names = mosaic.bandNames().getInfo()
    classifier = ee.Classifier.smileRandomForest(
        numberOfTrees= 300,
        variablesPerSplit= int(math.floor(math.sqrt(len(bandNames_list))))
    ).setOutputMode('MULTIPROBABILITY') \
        .train(training, 'class', bandNames_list)

    # Classify the image
    predicted = mosaic.classify(classifier).updateMask(aoi_img)

    # Format probability output
    classes = sorted(training.aggregate_array('class').distinct().getInfo())

    probabilities = predicted.arrayFlatten([list(map(str, classes))])
    new_names = [classDict[int(c)] for c in classes if int(c) in classDict]
    probabilities = probabilities.select(list(map(str, classes)), new_names)
    probabilities = probabilities.multiply(100).round().toInt8()

    # Get classification band
    probabilitiesArray = probabilities.toArray() \
        .arrayArgmax() \
        .arrayGet([0])

    classificationImage = probabilitiesArray.remap(
        list(range(len(classes))),
        classes
    ).rename('classification')

    # Combine classification with probabilities
    toExport = classificationImage.addBands(probabilities)

    # Set metadata
    toExport = toExport.set('collection', '10') \
        .set('version', output_version) \
        .set('biome', 'CERRADO') \
        .set('year', int(year))

    # Export to asset
    file_name = f'CERRADO_ROCKY_{year}_v{output_version}'
    
    task = ee.batch.Export.image.toAsset(
        image= toExport,
        description= file_name,
        assetId= output_asset + file_name,
        scale= 30,
        maxPixels= 1e13,
        pyramidingPolicy= {'.default': 'mode'},
        region= aoi_img.geometry()
    )
    task.start()

print('All classification export tasks started.')
