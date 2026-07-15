# --- --- --- 04_trainingSamples
# This script generates annual training samples for the rocky outcrop class by Satellite Embedding mosaics, 
# and geomorphometric metrics, and sampling stratified points using pre-defined training locations.
# barbara.silva@ipam.org.br

# Read libraries
import ee
import math
import pandas as pd
import sys
import os
import re

# Authenticate and initialize Earth Engine
ee.Authenticate()
ee.Initialize(project = 'ee-barbaracostamapbiomas') # choose your own project

# Define input and output versions for processing
version_in = '1'
version_out  = '1'

# Define output folder path
dirout = f'projects/ee-barbarasilvaipam/assets/collection-03_rocky-outcrop/trainings/v{version_out}/'

# Define the range of years to be processed
years = list(range(2017, 2025))

# Load AOI and training samples
aoi_vec = ee.FeatureCollection('projects/ee-barbarasilvaipam/assets/collection-03_rocky-outcrop/masks/aoi_v1').geometry()
aoi_img = ee.Image(1).clip(aoi_vec)

# Load sample points for training
samples = ee.FeatureCollection('projects/ee-barbarasilvaipam/assets/collection-03_rocky-outcrop/sample/points/samplePoints_v' + version_in)

# Google Satellite Embedding (Source: https://developers.google.com/earth-engine/datasets/catalog/GOOGLE_SATELLITE_EMBEDDING_V1_ANNUAL?hl=pt-br)
collectionId = 'GOOGLE/SATELLITE_EMBEDDING/V1/ANNUAL'

# Load geomorphometric covariates (Geomorpho 90m - Amatulli et al. 2019)
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

# Initialize dictionary to store mosaics by year
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

    # Compute auxiliary coordinates
    coords = ee.Image.pixelLonLat().clip(aoi_vec)
    lat = coords.select('latitude').add(5).multiply(-1).multiply(1000).toInt16()
    lon_sin = coords.select('longitude').multiply(math.pi).divide(180).sin().multiply(-1).multiply(10000).toInt16().rename('longitude_sin')
    lon_cos = coords.select('longitude').multiply(math.pi).divide(180).cos().multiply(-1).multiply(10000).toInt16().rename('longitude_cos')

## -- -- -- Start of mosaic production
    # Set time range for mosaic generation
    dateStart = ee.Date.fromYMD(year, 1, 1)
    dateEnd = dateStart.advance(1, 'year')

    # Filter Sentinel image collection by date and region
    collection = ee.ImageCollection(collectionId)\
            .filter(ee.Filter.date(dateStart, dateEnd))\
            .filter(ee.Filter.bounds(aoi_vec))\
            .mosaic()

    # Generate mosaic using specific criteria
    mosaic = collection

    # Add auxiliary and geomorphometric variables
    mosaic = mosaic.addBands(lat).addBands(lon_sin).addBands(lon_cos)
    for key in geomorpho:
        mosaic = mosaic.addBands(geomorpho[key])

    # Store mosaic in dictionary
    mosaic_dict[year] = mosaic

    # Convert to int64 to ensure compatibility
    mosaic = mosaic.clip(aoi_vec)
    mosaic = mosaic.multiply(100000).round()

    # Add year
    mosaic = mosaic.addBands(ee.Image(year).int16().rename('year'))

## -- -- -- End of mosaic production

    training_samples = samples.randomColumn("random").filter(ee.Filter.lt('random', 0.70))

    # Extract training samples from the mosaic
    training_i =mosaic.sampleRegions(
        collection=training_samples,
        scale=10,
        geometries= True,
        tileScale= 4
      )

    print('Number of training points: ' + str(training_samples.size().getInfo()))

    # Remove null values
    training_i = training_i.filter(ee.Filter.notNull(mosaic.bandNames().getInfo()))

    # Define export path
    asset_id = f'{dirout}train_col03_rocky_{year}_v{version_out}'
    if asset_exists(asset_id):
        print(f'--> Asset already exists: {asset_id} — skipping export.')
        continue

    # Export training sample as GEE asset
    task = ee.batch.Export.table.toAsset(
        collection=training_i,
        description=f'train_col03_rocky_{year}_v{version_out}',
        assetId=asset_id
    )

    task.start()
    print('============================================')

print('✅ All tasks have been started. Now wait a few hours and have fun :)')
