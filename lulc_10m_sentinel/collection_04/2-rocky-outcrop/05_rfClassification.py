# --- --- --- 05) Random Forest Classification
# This script performs Land Use and Land Cover (LULC) classification focused 
# on mapping Rocky Outcrop. It rebuilds the annual Google Satellite Embedding 
# and geomorphometric mosaics, trains a Random Forest (RF) model using the 
# previously extracted samples (Step 04), and outputs both the discrete 
# classification map and continuous class probability bands.

## Initialization and Imports
import ee            # Import the Earth Engine API
import math          # Import math for trigonometric functions

# Authenticate the Earth Engine account (required in new environments)
ee.Authenticate()

# Initialize the Earth Engine session with the specified project
ee.Initialize(project = 'ee-barbarasilvaipam')

## Parameters and Asset Management
# Define the input version for the training samples
samples_version = '1'

# Define the output version for the final classification assets
output_version  = '1'

# Define the base output folder path for storing the classification assets in GEE
output_asset = 'projects/ee-ipam/assets/MAPBIOMAS/LULC/CERRADO_DEV/COL_11/SENTINEL/C04_ROCKY-GENERAL-MAP-PROBABILITY/'

# Define the list of years to be processed
years = list(range(2017, 2026))

# Define a dictionary mapping numeric class IDs to descriptive labels for the probability bands
classDict = {
     1: 'Forest',
     2: 'Shrubby',
     3: 'Water',
     4: 'Anthropic',
     5: 'NonVegetated',
    29: 'RockyOutcrop'
}

# Load the Area of Interest (AOI) feature
aoi_vec = ee.FeatureCollection('projects/ee-barbarasilvaipam/assets/collection-04_rocky-outcrop/masks/aoi_v1').geometry()

# Convert the AOI geometry into a binary image mask
aoi_img = ee.Image(1).clip(aoi_vec)

## Load Base Datasets
# Define the Earth Engine asset ID for the Google Satellite Embedding dataset
# Source: https://developers.google.com/earth-engine/datasets/catalog/GOOGLE_SATELLITE_EMBEDDING_V1_ANNUAL?hl=pt-br
collectionId = 'GOOGLE/SATELLITE_EMBEDDING/V1/ANNUAL'

# Construct a dictionary containing Geomorpho90m topographic covariates and MERIT DEM
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

# Initialize an empty dictionary to temporarily store computed mosaics by year
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


    ## Mosaic Assembly

    # Define the start date based on the current iteration year
    dateStart = ee.Date.fromYMD(year, 1, 1)

    # Define the end date
    dateEnd = dateStart.advance(1, 'year')

    # Filter the Google Satellite Embeddings collection by date
    collection = ee.ImageCollection(collectionId).filter(ee.Filter.date(dateStart, dateEnd)).filter(ee.Filter.bounds(aoi_vec)).mosaic()

    # Assign the embedded mosaic as the base image for classification
    mosaic = collection

    # Append the processed geographic coordinate bands to the mosaic
    mosaic = mosaic.addBands(lat).addBands(lon_sin).addBands(lon_cos)
    
    # Iterate through the geomorphology dictionary and append each topographic band to the mosaic
    for key in geomorpho:
        mosaic = mosaic.addBands(geomorpho[key])

    # Store the assembled multi-band composite in the tracking dictionary
    mosaic_dict[year] = mosaic

    # Clip the final mosaic to the strict boundaries of the AOI
    mosaic = mosaic.clip(aoi_vec)

    # Scale the mosaic values and round them to ensure numeric consistency
    mosaic = mosaic.multiply(100000).round()

    # Append a constant band representing the processing year cast as Int16
    mosaic = mosaic.addBands(ee.Image(year).int16().rename('year'))


    ## Random Forest Training and Classification 
    # Construct the exact path to load the corresponding training sample asset for the current year
    training_path = f'projects/ee-barbarasilvaipam/assets/collection-04_rocky-outcrop/trainings/v{samples_version}/train_col04_rocky_{year}_v{samples_version}'
    
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
    toExport = toExport.set('collection', '04') \
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
        scale = 10,
        maxPixels = 1e13,
        pyramidingPolicy = {'.default': 'mode'},
        region = aoi_img.geometry()
    )
    
    # Submit the classification export task to the Earth Engine servers
    task.start()

print('✅ All classification export tasks started. Now wait a few hours and have fun :)')
