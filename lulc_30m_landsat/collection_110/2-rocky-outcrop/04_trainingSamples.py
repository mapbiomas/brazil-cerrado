# --- --- --- 04) Training Samples Generation
# This script extracts temporal and geomorphometric signatures for the Rocky 
# Outcrop classification. It generates annual mosaics (1985–2025) from Landsat annual 
# mosaics and other terrain and spatial-context covariates. It then samples these mosaics 
# at the pre-defined stratified training point and exports the datasets as GEE Table Assets.

## Initialization and Imports
import ee            # Import the Earth Engine API
import math          # Import math for trigonometric functions
import pandas as pd  # Import pandas for data manipulation 
import sys           # Import system-specific parameters and functions
import os            # Import operating system functionalities
import re            # Import regular expression operations for string parsing

# Authenticate the Earth Engine account (required in new environments)
ee.Authenticate()

# Initialize the Earth Engine session with the specified project
ee.Initialize(project = 'ee-ipam')

# Clone the MapBiomas GitHub repository to access custom helper functions
!rm -rf /content/mapbiomas-mosaic
!git clone https://github.com/costa-barbara/mapbiomas-mosaic.git
sys.path.append("/content/mapbiomas-mosaic")

# Import custom MapBiomas modules for mosaicking and spectral metrics
from modules.SpectralIndexes import *
from modules.Miscellaneous import *
from modules.Mosaic import *
from modules.SmaAndNdfi import *
from modules.ThreeYearMetrics import *
from modules import Map

## Parameters and Asset Paths
# Define the input version for the sample points
version_in = '3'

# Define the output version for the generated training data
version_out = '3'

# Define the base output folder path for storing the generated training assets in GEE
dirout = f'projects/ee-ipam/assets/MAPBIOMAS/LULC/CERRADO_DEV/COL_11/LANDSAT/trainings_rocky/v{version_out}/'

# Define the list of years to be processed
years = list(range(1985, 2026))

# Landsat mosaic parameters
collectionId = 'LANDSAT/COMPOSITES/C02/T1_L2_32DAY'
spectralBands = ['blue', 'red', 'green', 'nir', 'swir1', 'swir2']

## Load Base Datasets
# Load the Area of Interest (AOI) feature
aoi_vec = ee.FeatureCollection('projects/ee-barbarasilvaipam/assets/collection-11_rocky-outcrop/masks/aoi_v1').geometry()

# Convert the AOI geometry into a binary image mask
aoi_img = ee.Image(1).clip(aoi_vec)

# Load the unified sample points generated in the previous step
samples = ee.FeatureCollection('projects/ee-barbarasilvaipam/assets/collection-11_rocky-outcrop/sample/points/samplePoints_v' + version_in)

# Initialize an empty dictionary to store computed mosaics by year temporarily
mosaic_dict = {}

# Define a function to check if a specific asset already exists in the Earth Engine directory
def asset_exists(asset_id):
    try:
        # Request the list of assets in the parent folder
        assets = ee.data.getList({'id': asset_id.rsplit('/', 1)[0]})
        # Extract the full asset IDs from the returned dictionary
        asset_names = [a['id'] for a in assets]
        # Return True if the target asset ID is found in the list, False otherwise
        return asset_id in asset_names
    except Exception as e:
        # Print the error if the API request fails and safely return False
        print(f"Error checking asset: {e}")
        return False

## Main Processing Loop
# Iterate over each year defined in the processing list
for year in years:
    # Print a status message indicating the current year
    print(f"--> Processing year: {year}")

    # Extract pixel latitude and longitude coordinates
    coords = ee.Image.pixelLonLat().clip(aoi_vec)

    lat = coords.select('latitude').add(5).multiply(-1).multiply(1000).toInt16()
    lon_sin = coords.select('longitude').multiply(math.pi).divide(180).sin().multiply(-1).multiply(10000).toInt16().rename('longitude_sin')
    lon_cos = coords.select('longitude').multiply(math.pi).divide(180).cos().multiply(-1).multiply(10000).toInt16().rename('longitude_cos')

    # Load HAND data (height above nearest drainage)
    hand = ee.ImageCollection("users/gena/global-hand/hand-100").mosaic().toInt16().clip(aoi_vec).rename('hand')
    
    ## Mosaic Assembly 
    # Set the best temporal window for the Cerrado biome
    dateStart = ee.Date.fromYMD(year, 4, 1)
    dateEnd = ee.Date.fromYMD(year, 10, 1)

    # Filter Landsat image collection by date and region
    collection = ee.ImageCollection(collectionId)\
            .filter(ee.Filter.date(dateStart, dateEnd))\
            .filter(ee.Filter.bounds(aoi_vec))\
            .select(spectralBands)
    
    # Apply scaling factor for reflectance correction
    collection = collection.map(lambda image: image.multiply(10000).copyProperties(image, ['system:time_start', 'system:time_end']))

    # Apply spectral indexes function
    collection = collection\
      .map(getNDVI).map(getNBR).map(getMNDWI).map(getEVI2)\
      .map(getMSI).map(getTGSI).map(getBSI).map(getNDRI)\
      .map(getHallCover).map(getHallHeight)
    
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
    
    # Add terrain ruggedness and texture
    mosaic = getTerrainMetrics(mosaic)
    mosaic = getSpatialContext(mosaic)
    
    # Append the processed geographic coordinate bands to the mosaic
    mosaic = mosaic.addBands(lat).addBands(lon_sin).addBands(lon_cos).addBands(hand)
    
    # Store the assembled multi-band composite in the tracking dictionary
    mosaic_dict[year] = mosaic
    mosaic = threeYearMetrics(year, mosaic, mosaic_dict)

    # Clip the final mosaic to the boundaries of the AOI
    mosaic = mosaic.clip(aoi_vec)
    
    # Convert to int32 to ensure compatibility
    mosaic = mosaic.multiply(100).round().toInt32()

    # Append a constant band representing the processing year cast as Int16
    mosaic = mosaic.addBands(ee.Image(year).int16().rename('year'))


    ## Sampling and Export
    # Extract the mosaic pixel values at the locations of the training points
    training_i = mosaic.sampleRegions(
        collection = samples,
        scale = 30,
        geometries = True,
        tileScale = 4
    )

    # Print the total number of points submitted for extraction to the console
    print('Number of training points: ' + str(samples.size().getInfo()))

    # Filter the extracted collection to strictly remove points that returned null values for any band
    training_i = training_i.filter(ee.Filter.notNull(mosaic.bandNames().getInfo()))

    # Construct the exact expected asset ID for the current year's export
    asset_id = f'{dirout}train_col11_rocky_{year}_v{version_out}'
    
    # Check if the asset already exists in the directory to prevent redundant processing
    if asset_exists(asset_id):
        print(f'--> Asset already exists: {asset_id} — skipping export.')
        continue

    # Configure the Earth Engine batch export task for the extracted training table
    task = ee.batch.Export.table.toAsset(
        collection=training_i,
        description=f'train_col11_rocky_{year}_v{version_out}',
        assetId=asset_id
    )

    # Submit the export task to the Earth Engine servers
    task.start()
    
    print('============================================')

# Print completion message
print('✅ All tasks have been started. Now wait a few hours and have fun :)')
