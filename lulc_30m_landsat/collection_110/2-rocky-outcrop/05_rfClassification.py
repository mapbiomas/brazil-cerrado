# --- --- --- 05) Random Forest Classification
# This script performs Land Use and Land Cover (LULC) classification focused 
# on mapping Rocky Outcrop. It rebuilds the annual Landsat mosaics and other terrain 
# and spatial-context covariates, trains a Random Forest (RF) model using the 
# previously extracted samples (Step 04), and outputs both the discrete 
# classification map and continuous class probability bands.

## Initialization and Imports
import ee            # Import the Earth Engine API
import math          # Import math for trigonometric functions
import sys           # Import system-specific parameters and functions
import os            # Import operating system functionalities
import re            # Import regular expression operations for string parsing
import itertools     # Import itertools for generating combinations

# Authenticate the Earth Engine account (required in new environments)
ee.Authenticate()

# Initialize the Earth Engine session with the specified project
ee.Initialize(project = 'ee-barbarasilvaipam')

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

## Parameters and Asset Management
# Define the input version for the training samples
samples_version = '3'

# Define the output version for the final classification assets
output_version  = '4'

# Define the base output folder path for storing the classification assets in GEE
output_asset = 'projects/ee-ipam/assets/MAPBIOMAS/LULC/CERRADO_DEV/COL_11/LANDSAT/C11-ROCKY-GENERAL-MAP-PROBABILITY/'

# Define the list of years to be processed
years = list(range(1985, 2026))

# Define a dictionary mapping numeric class IDs to descriptive labels for the probability bands
classDict = {
     1: 'Forest',
     2: 'Shrubby',
     3: 'Farming',
     4: 'NonVegetated',
     5: 'WaterWetland',
    29: 'RockyOutcrop'
}

# Load the Area of Interest (AOI) feature
aoi_vec = ee.FeatureCollection('projects/ee-barbarasilvaipam/assets/collection-11_rocky-outcrop/masks/aoi_v1').geometry()

# Convert the AOI geometry into a binary image mask
aoi_img = ee.Image(1).clip(aoi_vec)

## Load Base Datasets
# Landsat mosaic parameters
collectionId = 'LANDSAT/COMPOSITES/C02/T1_L2_32DAY'
spectralBands = ['blue', 'red', 'green', 'nir', 'swir1', 'swir2']

# Initialize an empty dictionary to store computed mosaics by year temporarily
mosaic_dict = {}

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

    ## Random Forest Training and Classification 
    # Construct the exact path to load the corresponding training sample asset for the current year
    training_path = f'projects/ee-ipam/assets/MAPBIOMAS/LULC/CERRADO_DEV/COL_11/LANDSAT/trainings_rocky/v{samples_version}/train_col11_rocky_{year}_v{samples_version}'
    
    # Load the training samples feature collection
    training = ee.FeatureCollection(training_path)

    # Extract the list of all band names present in the mosaic to serve as predictors
    band_names = mosaic.bandNames().getInfo()
    
    # Print diagnostic information regarding the predictor bands
    print("Total bands:", mosaic.bandNames().size().getInfo())

    # Initialize the SmileRandomForest classifier requesting MULTIPROBABILITY output
    classifier = ee.Classifier.smileRandomForest(
        # Set the number of decision trees 
        numberOfTrees = 300,
        # Set the number of variables per split to the square root of total predictors
        variablesPerSplit = int(math.floor(math.sqrt(len(band_names))))
    ).setOutputMode('MULTIPROBABILITY').train(training, 'class', band_names)

    # Apply the trained classifier to the mosaic and mask the result strictly to the AOI boundary
    predicted = mosaic.classify(classifier).updateMask(aoi_img)

    ## Probability Formatting
    # Retrieve an ordered list of all unique class IDs present in the training data
    classes = sorted(training.aggregate_array('class').distinct().getInfo())

    # Flatten the multiprobability array output into individual bands named after the numeric class IDs
    probabilities = predicted.arrayFlatten([list(map(str, classes))])
    
    # Look up the descriptive string names for the present class IDs using the dictionary
    new_names = [classDict[int(c)] for c in classes if int(c) in classDict]

    # Rename the numeric probability bands to their corresponding descriptive names
    probabilities = probabilities.select(list(map(str, classes)), new_names)

    # Rescale the 0-1 probability floats to 0-100 integers and cast to Int8 for storage optimization
    probabilities = probabilities.multiply(100).round().toInt8()

    # Convert the individual probability bands back to an array to extract the maximum probability index
    probabilitiesArray = probabilities.toArray().arrayArgmax().arrayGet([0])

    # Remap the zero-indexed argmax result back to the original numeric class IDs to form the final discrete map
    classificationImage = probabilitiesArray.remap(list(range(len(classes))), classes).rename('classification')

    # Concatenate the discrete classification band with all the continuous probability bands
    toExport = classificationImage.addBands(probabilities)

    # Inject categorical and temporal metadata attributes into the final image before exporting
    toExport = toExport.set('collection', '11') \
        .set('version', output_version) \
        .set('biome', 'CERRADO') \
        .set('year', int(year)) \

    # Define the strict filename template for the output asset
    file_name = f'CERRADO_ROCKY_{year}_v{output_version}'

    # Configure the Earth Engine batch export task for the classified image
    task = ee.batch.Export.image.toAsset(
        image = toExport,
        description = file_name,
        assetId = output_asset + file_name,
        scale = 30,
        maxPixels = 1e13,
        pyramidingPolicy = {'.default': 'mode'},
        region = aoi_img.geometry()
    )
    
    # Submit the classification export task to the Earth Engine servers
    task.start()

print('✅ All classification export tasks started. Now wait a few hours and have fun :)')
