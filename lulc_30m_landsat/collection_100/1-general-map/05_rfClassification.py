# --- --- --- 05_rfClassification

# Perform land use and land cover classification using Random Forest (RF) with multiprobability output
# Applies trained RF model to annual Landsat mosaics and exports classification and class probabilities

# Author: barbara.silva@ipam.org.br

## Read libraries
import ee
import sys
import os
import re
import math
import itertools

# Authenticate and initialize Earth Engine
ee.Authenticate()
ee.Initialize(project = 'ee-ipam')

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
samples_version = '11'
output_version  = '11'

# Define output folder path
output_asset = 'projects/mapbiomas-workspace/COLECAO_DEV/COLECAO10_DEV/CERRADO/LANDSAT/C10-GENERAL-MAP-PROBABILITY/'

# Define the range of years to be processed
years = list(range(1985, 2025))

# Load classification regions
regions_vec = ee.FeatureCollection('users/dh-conciani/collection7/classification_regions/vector_v2')
regions_ic = 'users/dh-conciani/collection7/classification_regions/eachRegion_v2_10m/'
regions_list = sorted(regions_vec.aggregate_array('mapb').distinct().getInfo())

# List existing output assets
files = ee.data.listAssets({'parent': output_asset})
files = [asset['name'] for asset in files['assets']]

# Remove the prefix from asset names
files = [file.replace('projects/earthengine-legacy/assets/', '') for file in files]

# Generate expected asset list
expected = [
    f"{output_asset}CERRADO_{region}_{year}_v{output_version}"
    for region, year in itertools.product(regions_list, years)
]

# Identify missing assets
missing = [entry for entry in expected if entry not in files]

# Define class label dictionary
classDict = {
     3: 'Forest',
     4: 'Savanna',
    11: 'Wetland',
    12: 'Grassland',
    15: 'Pasture',
    18: 'Agriculture',
    25: 'Non-Vegetated',
    33: 'Water'
}

# Training samples path
training_dir = 'projects/mapbiomas-workspace/COLECAO_DEV/COLECAO10_DEV/CERRADO/LANDSAT/trainings/'

# Landsat mosaic settings
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

# Generate and export classification per year and region
for region in regions_list:
    print(f'Processing region [{region}]')

    region_i_vec = regions_vec.filter(ee.Filter.eq('mapb', region)).first().geometry()
    region_i_ras = ee.Image(regions_ic + 'reg_' + str(region))

    # Compute additional bands
    # Generate geographic coordinates for modeling
    geo_coordinates = ee.Image.pixelLonLat().clip(region_i_vec)

    # Compute auxiliary coordinates
    coords = ee.Image.pixelLonLat().clip(region_i_vec)
    lat = coords.select('latitude').add(5).multiply(-1).multiply(1000).toInt16()
    lon_sin = coords.select('longitude').multiply(math.pi).divide(180).sin().multiply(-1).multiply(10000).toInt16().rename('longitude_sin')
    lon_cos = coords.select('longitude').multiply(math.pi).divide(180).cos().multiply(-1).multiply(10000).toInt16().rename('longitude_cos')

    # Load HAND data (height above nearest drainage)
    hand = ee.ImageCollection("users/gena/global-hand/hand-100").mosaic().toInt16().clip(region_i_vec).rename('hand')

    # Iterate over missing assets to generate and export them
    missing_i = [
    item for item in missing
    if re.search(rf"CERRADO_{region}_[0-9]{{4}}_v{output_version}$", item)
  ]

    for year in years:
        print(f'----> {year}')

## -- -- -- Start of mosaic production
        # Set time range for mosaic generation
        dateStart = ee.Date.fromYMD(year, 4, 1)
        dateEnd = ee.Date.fromYMD(year, 10, 1)

        # Filter Landsat image collection by date and region
        collection = ee.ImageCollection(collectionId)\
                .filter(ee.Filter.date(dateStart, dateEnd))\
                .filter(ee.Filter.bounds(region_i_vec))\
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
                        .addBands(fire_age.select('classification_' + str(year)).rename('fire_age').clip(region_i_vec))

        for key in geomorpho:
            mosaic = mosaic.addBands(geomorpho[key])

        # Store mosaic in dictionary
        mosaic_dict[year] = mosaic

        # Convert to int64 to ensure compatibility
        mosaic = mosaic.clip(region_i_vec)
        mosaic = mosaic.multiply(10000).round().divide(1000).int64()

        # Add year
        mosaic = mosaic.addBands(ee.Image(year).int16().rename('year'))

## -- -- -- End of mosaic production

        # Sample balancing for water class (avoid superestimation)
        water_samples = ee.FeatureCollection(
            training_dir + f'v{samples_version}/train_col10_reg{region}_{year}_v{samples_version}')\
            .filter(ee.Filter.eq("reference", 33)) \
            .filter(ee.Filter.eq("hand", 0)) \
            .limit(240)

        training_ij = ee.FeatureCollection(
            training_dir + f'v{samples_version}/train_col10_reg{region}_{year}_v{samples_version}')\
            .filter(ee.Filter.neq("reference", 33)) \
            .merge(water_samples)

        # Train RF - Random Forest classifier
        bandNames_list = mosaic.bandNames().getInfo()
        print("Total bands:", mosaic.bandNames().size().getInfo())
        print("Band names:", mosaic.bandNames().getInfo())

        classifier = ee.Classifier.smileRandomForest(
        numberOfTrees=300,
        variablesPerSplit=int(math.floor(math.sqrt(len(bandNames_list))))
        ).setOutputMode('MULTIPROBABILITY') \
        .train(training_ij, 'reference', bandNames_list)

        # Classify the image
        predicted = mosaic.classify(classifier).updateMask(region_i_ras)

        # Format probability output
        classes = sorted(training_ij.aggregate_array('reference').distinct().getInfo())
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
        toExport = toExport.set('collection', '10')\
            .set('version', output_version)\
            .set('biome', 'CERRADO')\
            .set('mapb', int(region))\
            .set('year', int(year))

        # Define export parameters
        file_name = f'CERRADO_{region}_{year}_v{output_version}'

        # Export to Earth Engine Asset
        task = ee.batch.Export.image.toAsset(
            image=toExport,
            description=file_name,
            assetId=output_asset + file_name,
            scale=30,
            maxPixels=1e13,
            pyramidingPolicy={'.default': 'mode'},
            region=region_i_ras.geometry()
        )

        # Start the export task
        task.start()

    print ('------------> NEXT REGION --------->')

print('✅ All tasks have been started. Now wait a few hours and have fun :)')
