# --- --- --- 05) Random Forest Land Cover Classification
# This script performs Land Use and Land Cover (LULC) classification for the 
# Brazilian Cerrado using a Random Forest (RF) algorithm. It dynamically 
# reconstructs the annual Landsat-based mosaics and geomorphometric covariates, 
# trains the RF model using the previously extracted samples (Step 4), and outputs 
# both the discrete classification and continuous class probability bands.


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
ee.Initialize(project = 'ee-ipam')

# Clone the GitHub repository with helper functions
!rm -rf /content/mapbiomas-mosaic
!git clone https://github.com/costa-barbara/mapbiomas-mosaic.git
sys.path.append("/content/mapbiomas-mosaic")

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
# Define the input version for the sample points
samples_version = '17'

# Define the output version for the generated training data
output_version  = '17'

# Define output folder path
output_asset = 'projects/ee-ipam/assets/MAPBIOMAS/LULC/CERRADO_DEV/COL_11/LANDSAT/C11-GENERAL-MAP-PROBABILITY/'

# Training samples path
training_dir = 'projects/mapbiomas-brazil/assets/LAND-COVER/COLLECTION-11/GENERAL/SAMPLES/CERRADO/'

# Define the years to classify
years = list(range(1985, 2026))

# Load the Cerrado classification regions feature collection
regionsCollection = ee.FeatureCollection('projects/ee-ipam-cerrado/assets/ancillary/collection_11_classification_regions_vector')
regions_list = sorted(regionsCollection.aggregate_array('mapb').distinct().getInfo())
regions_ic = 'users/dh-conciani/collection7/classification_regions/eachRegion_v2_10m/'

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
missing_set = set(missing)

print('Total missing assets:', len(missing))

# Define a dictionary mapping numeric class IDs to descriptive labels
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

# Landsat mosaic parameters
collectionId = 'LANDSAT/COMPOSITES/C02/T1_L2_32DAY'
spectralBands = ['blue', 'red', 'green', 'nir', 'swir1', 'swir2']

# Define spectral endmembers for SMA analysis
endmembers = ENDMEMBERS['landsat-8']

# Load ancillary layers
# Load fire age data from MapBiomas Fire (collection 5)
fire_age = ee.Image('projects/ee-ipam-cerrado/assets/Collection_11/masks/col5_fire_age')

# Construct a dictionary containing Geomorpho90m topographic covariates and MERIT DEM
# Source: Amatulli et al. 2019 - https://www.nature.com/articles/s41597-020-0479-6
geomorpho = {
    'dem': ee.Image('MERIT/DEM/v1_0_3').select('dem').toInt64().rename('merit_dem'),
    'aspect': ee.ImageCollection("projects/sat-io/open-datasets/Geomorpho90m/aspect").mosaic().rename('aspect').toInt64(),
    'convergence': ee.ImageCollection("projects/sat-io/open-datasets/Geomorpho90m/convergence").mosaic().rename('convergence').toInt64(),
    'roughness': ee.ImageCollection("projects/sat-io/open-datasets/Geomorpho90m/roughness").mosaic().rename('roughness').toInt64(),
    'eastness': ee.ImageCollection("projects/sat-io/open-datasets/Geomorpho90m/eastness").mosaic().rename('eastness').toInt64(),
    'northness': ee.ImageCollection("projects/sat-io/open-datasets/Geomorpho90m/northness").mosaic().round().rename('northness').toInt64(),
    'dxx': ee.ImageCollection("projects/sat-io/open-datasets/Geomorpho90m/dxx").mosaic().rename('dxx').toInt64(),
    'cti': ee.ImageCollection("projects/sat-io/open-datasets/Geomorpho90m/cti").mosaic().rename('cti').toInt64(),
}

## Helper Functions
# Builds the annual Landsat mosaic with SMA and selected spectral indices.
def buildAnnualMosaic(year, region_i):
    # Set the best temporal window for the Cerrado biome
    dateStart = ee.Date.fromYMD(year, 4, 1)
    dateEnd = ee.Date.fromYMD(year, 10, 1)

    # Filter the Landsat composites collection
    collection = ee.ImageCollection(collectionId) \
        .filter(ee.Filter.date(dateStart, dateEnd)) \
        .filter(ee.Filter.bounds(region_i)) \
        .select(spectralBands)

    collection = collection.map(
        lambda image: image.multiply(10000)
        .copyProperties(image, ['system:time_start', 'system:time_end'])
    )

    # Apply Spectral Mixture Analysis and indices
    collection = collection.map(lambda image: getFractions(image, endmembers))
    collection = collection.map(getNDFI).map(getSEFI).map(getWEFI).map(getFNS)

    # Selected spectral indices
    collection = collection\
        .map(getNDVI).map(getNBR).map(getMNDWI).map(getPRI).map(getCAI).map(getEVI2)\
        .map(getGCVI).map(getGRND).map(getMSI).map(getGARI).map(getGNDVI).map(getMSAVI)\
        .map(getHallCover).map(getHallHeigth)

    # Build the final reduced mosaic using percentile combinations
    # NDVI is used as the target band for dry/wet seasonal percentiles
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

    return mosaic

# Keeps only the two previous years required for trailing three-year metrics
# Manages memory for trailing three-year metrics by removing years older than (current_year - 2) 
def cleanThreeYearDict(mosaic_dict_3yr, year):
    # Identify keys (years) that fall outside the 3-year trailing window
    years_to_remove = [
        y for y in mosaic_dict_3yr.keys()
        if y < year - 2
    ]

    # Delete the obsolete years from the dictionary
    for y in years_to_remove:
        del mosaic_dict_3yr[y]

    return mosaic_dict_3yr

# Return the annual training sample asset corresponding to region and year.
def getTrainingAsset(region, year):
    return (
        training_dir
        + f'v{samples_version}/'
        + f'train_col11_reg{region}_{year}_v{samples_version}'
    )

# Applies balancing to the Water class (33) to minimize false positives.
def balanceTrainingSamples(training_fc):

    # Filter and limit valid water samples based on topographic rules
    water_samples = (
        training_fc
        .filter(ee.Filter.eq('reference', 33))
        .filter(ee.Filter.eq('hand', 0))
        .limit(240)
    )

    non_water_samples = training_fc.filter(
        ee.Filter.neq('reference', 33)
    )

    # Merge the balanced water subset back into the main sample pool
    return non_water_samples.merge(water_samples)

## Main Processing Loop
# Iterate over each unique classification region
for region in regions_list:
    print('--------------------------------')
    print(f'Processing region [{region}]')

    # Filter the global missing list to find missing assets specific to this region
    region_missing = [
        item for item in missing
        if re.search(
            rf"CERRADO_{region}_[0-9]{{4}}_v{output_version}$",
            item
        )
    ]

    if len(region_missing) == 0:
        print(f'Region {region}: all assets already exist. Skipping region.')
        continue

    print('Missing assets in region:', len(region_missing))

    region_i_vec = (regionsCollection.filter(ee.Filter.eq('mapb', region)).first().geometry())
    region_i_ras = ee.Image(regions_ic + 'reg_' + str(region))

    # Extract pixel latitude and longitude coordinates
    coords = ee.Image.pixelLonLat().clip(region_i_vec)

    # Compute auxiliary coordinates
    lat = coords.select('latitude').add(5).multiply(-1).multiply(1000).toInt16().rename('latitude')
    lon_sin = coords.select('longitude').multiply(math.pi).divide(180).sin().multiply(-1).multiply(10000).toInt16().rename('longitude_sin')
    lon_cos = coords.select('longitude').multiply(math.pi).divide(180).cos().multiply(-1).multiply(10000).toInt16().rename('longitude_cos')
    hand = ee.ImageCollection("users/gena/global-hand/hand-100").mosaic().toInt16().clip(region_i_vec).rename('hand')

    # Reduced dictionary for trailing 3-year metrics
    mosaic_dict_3yr = {}

    # Iterate over each year
    for year in years:
        # Define the strict filename template for the output asset
        file_name = f'CERRADO_{region}_{year}_v{output_version}'
        asset_id = output_asset + file_name

        print(f'----> {year}')

        # Build Base Mosaic & Context Metrics
        mosaic = buildAnnualMosaic(
            year = year,
            region_i = region_i_vec
        )

        mosaic = getStructuralContext(mosaic)

        # Add trailing three-year temporal metrics
        mosaic = addThreeYearMetrics(
            year=year,
            mosaic=mosaic,
            mosaic_dict_3yr=mosaic_dict_3yr
        )

        # Store reduced annual image for subsequent years only
        mosaic_dict_3yr[year] = getThreeYearReducedImage(mosaic)
        mosaic_dict_3yr = cleanThreeYearDict(mosaic_dict_3yr, year)

        # Skip export if asset already exists (but we had to process the image for the 3-year temporal lag)
        if asset_id not in missing_set:
            print('Asset already exists. Temporal image stored, export skipped.')
            continue

        # Append the Coordinates bands and other ancillary to the main mosaic
        mosaic = getSlope(mosaic)

        mosaic = mosaic.addBands(lat).addBands(lon_sin).addBands(lon_cos).addBands(hand) \
                        .addBands(fire_age.select(f'classification_{year}').rename('fire_age').clip(region_i_vec))

        # Iterate through the geomorphology dictionary and append each band to the mosaic
        for key in geomorpho:
            mosaic = mosaic.addBands(geomorpho[key])
        
        # Final Formatting
        mosaic = mosaic.multiply(100).round().toInt32()
        mosaic = mosaic.addBands(ee.Image(year).int16().rename('year'))
        mosaic = mosaic.clip(region_i_vec)

        # Fetch the previously created training FeatureCollection for a specific region
        training_asset = getTrainingAsset(region, year)
        training_fc = ee.FeatureCollection(training_asset)

        # Apply the balancing for the water class
        training_ij = balanceTrainingSamples(training_fc)

        ## Random Forest Training and Classification
        # Extract the list of all band names present in the mosaic to serve as predictors
        bandNames_list = mosaic.bandNames().getInfo()
        print('Total bands:', len(bandNames_list))

        # Initialize the SmileRandomForest classifier requesting MULTIPROBABILITY output
        classifier = ee.Classifier.smileRandomForest(
                # Set the number of decision trees
                numberOfTrees=300,
                # Set the number of variables per split
                variablesPerSplit=int( math.floor(math.sqrt(len(bandNames_list))))
                ).setOutputMode('MULTIPROBABILITY') \
                .train(training_ij, 'reference', bandNames_list)
        
        # Apply the trained classifier to the mosaic and mask the result strictly to the region boundary
        predicted = (mosaic.classify(classifier).updateMask(region_i_ras))

        ## Probability Flattening and Discrete Class Mapping
        # Retrieve an ordered list of all unique class IDs present in the training data
        classes = sorted(training_ij.aggregate_array('reference').distinct().getInfo())

        # Flatten the multiprobability array output into individual bands named after the numeric class IDs        
        probabilities = predicted.arrayFlatten([list(map(str, classes))])

        # Look up the descriptive string names for the present class IDs using the dictionary
        new_names = [classDict[int(c)] for c in classes if int(c) in classDict]

        # Rename the numeric probability bands to their corresponding descriptive names
        probabilities = probabilities.select(list(map(str, classes)), new_names)

        # Rescale the 0-1 probability floats to 0-100 integers and cast to Int8 for storage optimization
        probabilities = probabilities.multiply(100).round().toInt8()

        # Convert the individual probability bands back to an array to extract the maximum probability index
        probabilitiesArray = probabilities.toArray() \
            .arrayArgmax() \
            .arrayGet([0])

        # Remap the zero-indexed argmax result back to the original numeric class IDs to form the final map
        classificationImage = probabilitiesArray.remap(
            list(range(len(classes))),
            classes
        ).rename('classification').toInt8()
        
        # Concatenate the discrete classification band with all the continuous probability bands
        toExport = classificationImage.addBands(probabilities)

        # Set metadata attributes into the final image before exporting
        toExport = (
            toExport
            .set('collection', '11')
            .set('version', output_version)
            .set('biome', 'CERRADO')
            .set('mapb', int(region))
            .set('year', int(year))
            .set('samples_version', samples_version)
        )

        # Define the strict filename template for the output asset
        file_name = f'CERRADO_{region}_{year}_v{output_version}'

        task = ee.batch.Export.image.toAsset(
            image = toExport,
            description = file_name,
            assetId = asset_id,
            scale = 30,
            maxPixels = 1e13,
            pyramidingPolicy = {'.default': 'mode'},
            region = region_i_ras.geometry()
        )

        # Submit the classification export task to the Earth Engine servers
        task.start()

    print('------------> NEXT REGION --------->')

print('✅ All tasks have been started. Now wait a few hours and have fun :)')


print('✅ All tasks have been started. Now wait a few hours and have fun :)')

