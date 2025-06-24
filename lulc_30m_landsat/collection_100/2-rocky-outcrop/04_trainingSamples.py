## --- --- --- 04_getSignatures

# Generate annual training samples using Landsat mosaics and pre-defined points
# Description: This script generates annual training samples for the rocky outcrop class by producing custom Landsat mosaics, 
# applying spectral and geomorphometric metrics, and sampling stratified points using pre-defined training locations.

# Author: barbara.silva@ipam.org.br

## Read libraries
import ee
import math
import pandas as pd
import sys
import os
import re

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
version_in = '4'
version_out = '4'

# Set output asset path
dirout = f'projects/ee-barbarasilvaipam/assets/collection-10_rocky-outcrop/trainings/v{version_out}/'

# Define time range
years = list(range(1985, 2025))

# Load AOI and training samples
aoi_vec = ee.FeatureCollection('projects/ee-barbarasilvaipam/assets/collection-10_rocky-outcrop/masks/aoi_v4').geometry()
aoi_img = ee.Image(1).clip(aoi_vec)

samples = ee.FeatureCollection(
    f'projects/ee-barbarasilvaipam/assets/collection-10_rocky-outcrop/sample/points/samplePoints_v{version_in}'
)

# Set Landsat collection and bands
collectionId = 'LANDSAT/COMPOSITES/C02/T1_L2_32DAY'
spectralBands = ['blue', 'red', 'green', 'nir', 'swir1', 'swir2']

# Load geomorphometric variables
geomorpho = {
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

# Dictionary to store mosaics by year
mosaic_dict = {}

# Function to check if an asset exists in GEE
def asset_exists(asset_id):
    try:
        assets = ee.data.getList({'id': asset_id.rsplit('/', 1)[0]})
        asset_names = [a['id'] for a in assets]
        return asset_id in asset_names
    except Exception as e:
        print(f"Error checking asset: {e}")
        return False
 
# Loop over all years
for year in years:
    print(f"--> Processing year: {year}")

    # Generate pixel-based coordinates
    coords = ee.Image.pixelLonLat().clip(aoi_vec)
    lat = coords.select('latitude').add(5).multiply(-1).multiply(1000).toInt16()
    lon_sin = coords.select('longitude').multiply(math.pi).divide(180).sin().multiply(-1).multiply(10000).toInt16().rename('longitude_sin')
    lon_cos = coords.select('longitude').multiply(math.pi).divide(180).cos().multiply(-1).multiply(10000).toInt16().rename('longitude_cos')

    # Load HAND (height above nearest drainage)
    hand = ee.ImageCollection("users/gena/global-hand/hand-100").mosaic().toInt16().clip(aoi_vec).rename('hand')

    # Set mosaic time window (April to October)
    dateStart = ee.Date.fromYMD(year, 4, 1)
    dateEnd = ee.Date.fromYMD(year, 10, 1)

    # Load and filter Landsat imagery
    collection = (
        ee.ImageCollection(collectionId)
        .filter(ee.Filter.date(dateStart, dateEnd))
        .filter(ee.Filter.bounds(aoi_vec))
        .select(spectralBands)
        .map(lambda img: img.multiply(10000).copyProperties(img, ['system:time_start', 'system:time_end']))
    )

    # Apply spectral indexes
    collection = (
        collection
        .map(getNDVI).map(getNBR).map(getMNDWI).map(getPRI).map(getCAI).map(getEVI2)
        .map(getGCVI).map(getGRND).map(getMSI).map(getGARI).map(getGNDVI).map(getMSAVI)
        .map(getTGSI).map(getHallCover).map(getHallHeigth)
    )

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

    # Store and enhance mosaic
    mosaic_dict[year] = mosaic
    mosaic = addThreeYearMetrics(year, mosaic, mosaic_dict)
    mosaic = mosaic.clip(aoi_vec).multiply(10000).round().int64()
    mosaic = mosaic.addBands(ee.Image(year).int16().rename('year'))

    # Select 60% of samples for training
    training_samples = samples.randomColumn("random").filter(ee.Filter.lt('random', 0.60))

    # Sample mosaic using training points
    training_i = mosaic.sampleRegions(
        collection=training_samples,
        scale=30,
        geometries=True,
        tileScale=4
    )

    print(f'Number of training points: {training_samples.size().getInfo()}')

    # Remove null samples
    training_i = training_i.filter(ee.Filter.notNull(mosaic.bandNames().getInfo()))

    # Define export path
    asset_id = f'{dirout}train_col10_rocky_{year}_v{version_out}'
    if asset_exists(asset_id):
        print(f'--> Asset already exists: {asset_id} — skipping export.')
        continue

    # Export training sample as GEE asset
    task = ee.batch.Export.table.toAsset(
        collection=training_i,
        description=f'train_col10_rocky_{year}_v{version_out}',
        assetId=asset_id
    )
                       
    task.start()
    print('============================================')
