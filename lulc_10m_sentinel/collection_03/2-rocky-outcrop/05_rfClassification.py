# --- --- --- 05_rfClassification
# Perform land use and land cover classification using Random Forest (RF) with multiprobability output
# Applies trained RF model to annual Satellite Embedding mosaics and exports classification and class probabilities

# barbara.silva@ipam.org.br

# Read libraries
import ee
import sys
import os
import re
import math
import itertools

# Authenticate and initialize Earth Engine
ee.Authenticate()
ee.Initialize(project = 'ee-barbaracostamapbiomas') # choose your own project

# Set input and output version
samples_version = '1'
output_version  = '1'

# Define output folder path
output_asset = 'projects/mapbiomas-workspace/COLECAO_DEV/COLECAO10_DEV/CERRADO/SENTINEL/C03_ROCKY-MAP-PROBABILITY/'

# Define the range of years to be processed
years = list(range(2017, 2025))

# Define class label dictionary
classDict = {
    1: 'Forest',
    2: 'Shrubby',
    3: 'Water',
    4: 'Anthropic',
    5: 'NonVegetated',
    29: 'RockyOutcrop'
}

# Load AOI
aoi_vec = ee.FeatureCollection('projects/ee-barbarasilvaipam/assets/collection-03_rocky-outcrop/masks/aoi_v1').geometry()
aoi_img = ee.Image(1).clip(aoi_vec)

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

    # Filter Emebedding image collection by date and region
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

    # Load training data
    training_path = f'projects/ee-barbarasilvaipam/assets/collection-03_rocky-outcrop/trainings/v{samples_version}/train_col03_rocky_{year}_v{samples_version}'
    training = ee.FeatureCollection(training_path)

    # Train Random Forest classifier
    band_names = mosaic.bandNames().getInfo()
    print("Total bands:", mosaic.bandNames().size().getInfo())
    print("Band names:", mosaic.bandNames().getInfo())

    classifier = ee.Classifier.smileRandomForest(
        numberOfTrees= 300,
        variablesPerSplit= int(math.floor(math.sqrt(len(band_names))))
    ).setOutputMode('MULTIPROBABILITY') \
        .train(training, 'class', band_names)

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
        scale= 10,
        maxPixels= 1e13,
        pyramidingPolicy= {'.default': 'mode'},
        region= aoi_img.geometry()
    )
    task.start()

print('✅ All classification export tasks started. Now wait a few hours and have fun :)')
