# --- --- --- 04_trainingSamples.py
# Generate annual training samples for land cover classification
# using Landsat mosaics, spectral indices, SMA, fire history, geomorphometry,
# and three-year temporal metrics for the Cerrado biome (1985–2024).

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
ee.Initialize(project = 'ee-barbaracostamapbiomas')

# Clone the GitHub repository with helper functions
!rm -rf /content/mapbiomas-mosaic
!git clone https://github.com/costa-barbara/mapbiomas-mosaic.git
sys.path.append("/content/mapbiomas-mosaic")

# Import custom modules for mosaicking and spectral metrics
from modules.SpectralIndexes import *
from modules.Miscellaneous import *
from modules.Mosaic import *
from modules.SmaAndNdfi import *
from modules import Map

# Define input and output versions for processing
version_in = '1'
version_out  = '11'

# Define output folder path
dirout = f'projects/mapbiomas-workspace/COLECAO_DEV/COLECAO10_DEV/CERRADO/LANDSAT/trainings/v{version_out}/'

# Define the range of years to be processed
years = list(range(1985, 2025))

# Define the list of regions to be processed
regions = list(range(1, 39))

## Regions where it is necessary to reduce the number of samples due to their size and memory excess errors
reduced_regions  = [8, 10, 14, 15, 20, 21, 32]

# List existing assets in the output folder
files = ee.data.listAssets({'parent': dirout})
files = [asset['name'] for asset in files['assets']]

# Remove the prefix from asset names
files = [file.replace('projects/earthengine-legacy/assets/', '') for file in files]

# Identify missing assets
expected = [
    f'projects/mapbiomas-workspace/COLECAO_DEV/COLECAO10_DEV/CERRADO/LANDSAT/trainings/v{version_out}/train_col10_reg{region}_{year}_v{version_out}'
    for region in regions for year in years
]

# Identify missing assets
missing = [entry for entry in expected if entry not in files]

# Load biome layer raster data
biomes = ee.Image('projects/mapbiomas-workspace/AUXILIAR/biomas-2019-raster')
cerrado = biomes.updateMask(biomes.eq(4))

# Load classification region boundaries
regionsCollection = ee.FeatureCollection('users/dh-conciani/collection7/classification_regions/vector_v2')

# Load sample points for training
samples = ee.FeatureCollection('projects/mapbiomas-workspace/COLECAO_DEV/COLECAO10_DEV/CERRADO/LANDSAT/sample/points/samplePoints_v' + version_in)

# Landsat mosaic parameters
collectionId = 'LANDSAT/COMPOSITES/C02/T1_L2_32DAY'
spectralBands = ['blue', 'red', 'green', 'nir', 'swir1', 'swir2']

# Define spectral endmembers for SMA analysis
endmembers = ENDMEMBERS['landsat-8']

# Load ancillary layers
# Load fire age data from MapBiomas Fire (collection 3.1)
fire_age = ee.Image('projects/ee-barbarasilvaipam/assets/collection10/masks/fire_age')
fire_age = fire_age.addBands(fire_age.select('classification_2023').rename('classification_2024')) ## add 2024

# Load geomorphometric covariates (Geomorpho 90m - Amatulli et al. 2019)
geomorpho = {
    'dem': ee.Image('MERIT/DEM/v1_0_3').select('dem').toInt64().rename('merit_dem'),
    'aspect': ee.ImageCollection("projects/sat-io/open-datasets/Geomorpho90m/aspect").mosaic().multiply(10000).round().rename('aspect').toInt64(),
    'convergence': ee.ImageCollection("projects/sat-io/open-datasets/Geomorpho90m/convergence").mosaic().multiply(10000).round().rename('convergence').toInt64(),
    'roughness': ee.ImageCollection("projects/sat-io/open-datasets/Geomorpho90m/roughness").mosaic().multiply(10000).round().rename('roughness').toInt64(),
    'eastness': ee.ImageCollection("projects/sat-io/open-datasets/Geomorpho90m/eastness").mosaic().multiply(10000).round().rename('eastness').toInt64(),
    'northness': ee.ImageCollection("projects/sat-io/open-datasets/Geomorpho90m/northness").mosaic().multiply(10000).round().rename('northness').toInt64(),
    'dxx': ee.ImageCollection("projects/sat-io/open-datasets/Geomorpho90m/dxx").mosaic().multiply(10000).round().rename('dxx').toInt64(),
    'cti': ee.ImageCollection("projects/sat-io/open-datasets/Geomorpho90m/cti").mosaic().multiply(10000).round().rename('cti').toInt64(),
}

# Initialize dictionary to store mosaics by year
mosaic_dict = {}

# Generate and export training samples per year and region
for obj in missing:
    print(obj)

    # Extract region ID from asset name using regex
    match = re.search(r"(?<=reg)\d+", obj)
    if match:
        region_list = int(match.group())

    # Extract year from asset name using regex
    match = re.search(r"\d{4}", obj)
    if match:
        year = int(match.group())

    # Subset the region from the classification collection
    region_i = regionsCollection.filterMetadata('mapb', "equals", region_list).geometry()
    print ('processing region [', region_list, ']')
    print ('processing year [', year, ']')

    region_i_img = ee.Image('projects/barbaracosta-ipam/assets/base/CERRADO_CLASSIFICATION_REGIONS').eq(region_list).selfMask()

    # Compute additional bands
    # Generate geographic coordinates for modeling
    geo_coordinates = ee.Image.pixelLonLat().clip(region_i)

    # Compute auxiliary coordinates
    coords = ee.Image.pixelLonLat().clip(region_i)
    lat = coords.select('latitude').add(5).multiply(-1).multiply(1000).toInt16()
    lon_sin = coords.select('longitude').multiply(math.pi).divide(180).sin().multiply(-1).multiply(10000).toInt16().rename('longitude_sin')
    lon_cos = coords.select('longitude').multiply(math.pi).divide(180).cos().multiply(-1).multiply(10000).toInt16().rename('longitude_cos')

    # Load HAND data (height above nearest drainage)
    hand = ee.ImageCollection("users/gena/global-hand/hand-100").mosaic().toInt16().clip(region_i).rename('hand')

## -- -- -- Start of mosaic production
    # Set time range for mosaic generation
    dateStart = ee.Date.fromYMD(year, 4, 1)
    dateEnd = ee.Date.fromYMD(year, 10, 1)

    # Filter Landsat image collection by date and region
    collection = ee.ImageCollection(collectionId)\
            .filter(ee.Filter.date(dateStart, dateEnd))\
            .filter(ee.Filter.bounds(region_i))\
            .select(spectralBands)

    # Apply scaling factor for reflectance correction
    collection = collection.map(lambda image: image.multiply(10000).copyProperties(image, ['system:time_start', 'system:time_end']))

    # Apply Spectral Mixture Analysis (SMA)
    collection = collection.map(lambda image: getFractions(image, endmembers))

    # Compute SMA-based indexes
    collection = collection\
            .map(getNDFI)\
            .map(getSEFI)\
            .map(getWEFI)\
            .map(getFNS)

    # Apply spectral indexes function
    collection = collection\
      .map(getNDVI).map(getNBR).map(getMNDWI).map(getPRI).map(getCAI).map(getEVI2)\
      .map(getGCVI).map(getGRND).map(getMSI).map(getGARI).map(getGNDVI).map(getMSAVI)\
      .map(getHallCover).map(getHallHeigth)

    # Generate mosaic using specific criteria
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

    # Add terrain and texture features
    mosaic = getSlope(mosaic)
    mosaic = getEntropyG(mosaic)

    # Add auxiliary and geomorphometric variables
    mosaic = mosaic.addBands(lat).addBands(lon_sin).addBands(lon_cos).addBands(hand)\
                    .addBands(fire_age.select('classification_' + str(year)).rename('fire_age').clip(region_i))

    for key in geomorpho:
        mosaic = mosaic.addBands(geomorpho[key])

    # Store mosaic in dictionary
    mosaic_dict[year] = mosaic

    # Convert to int64 to ensure compatibility
    mosaic = mosaic.clip(region_i)
    mosaic = mosaic.multiply(10000).round().divide(1000).int64()

    # Add year
    mosaic = mosaic.addBands(ee.Image(year).int16().rename('year'))

## -- -- -- End of mosaic production

    # Sample training points
    training_samples = samples.filterBounds(regionsCollection.filterMetadata('mapb', "equals", region_list))

    # Sample training points (70% stratified sample, only for regions 8, 10, 14, 15, 20, 21, 32)
    if region_list in reduced_regions:
        training_samples = training_samples.randomColumn("random")
        training_samples = training_samples.filter(ee.Filter.lt("random", 0.70))

    # Extract training samples from the mosaic
    training_i =mosaic.sampleRegions(
        collection=training_samples,
        scale=30,
        geometries= True,
        tileScale= 4
      )

    print('number of points: ' + str(training_samples.size().getInfo()))

    # point = ee.Geometry.Point([-42.7989, -4.5429])
    # print(
    #     mosaic.reduceRegion(
    #         reducer=ee.Reducer.first(),
    #         geometry=point,
    #         scale=30
    #       ).getInfo()
    #     )

    # Remove null values
    training_i = training_i.filter(ee.Filter.notNull(mosaic.bandNames().getInfo()))

    # Export to Earth Engine Asset
    task = ee.batch.Export.table.toAsset(
        collection=training_i,
        description='train_col10_reg' + str(region_list) + '_' + str(year) + '_v' + version_out,
        assetId=dirout + 'train_col10_reg' + str(region_list) + '_' + str(year) + '_v' + version_out
    )

    # Start the export task
    task.start()
    print ('------------> NEXT REGION --------->')

print('✅ All tasks have been started. Now wait a few hours and have fun :)')
