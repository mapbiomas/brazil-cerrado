# --- --- --- 04) Training Samples Generation
# This script builds annual Landsat mosaics (1985–2024) enriched with a deep 
# feature space including Spectral Indices, SMA (Spectral Mixture Analysis), 
# fire history, geomorphometric covariates, and 3-year trailing metrics.
# It then extracts these pixel values at the sample points, 
# generating the final tabular datasets required for 
# training the Random Forest classifiers.


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

## Parameters and Asset Management
# Define the input version for the sample points
version_in = '14'

# Define the output version for the generated training data
version_out  = '17'

# Define output folder path
dirout = f'projects/mapbiomas-brazil/assets/LAND-COVER/COLLECTION-11/GENERAL/SAMPLES/CERRADO/v{version_out}/'

# Define the range of years to be processed
years = list(range(1985, 2026))

# Define the list of regions to be processed
regions = list(range(1, 39))

# Regions requiring sample reduction to prevent memory/computation limits in GEE
reduced_regions = [8, 10, 14, 15, 20, 21, 29, 32]

# List existing assets in the output folder
files = ee.data.listAssets({'parent': dirout})
files = [asset['name'] for asset in files['assets']]

# Remove the prefix from asset names
files = [file.replace('projects/earthengine-legacy/assets/', '') for file in files]

# Generate expected asset list
expected = [
    (
        f'projects/mapbiomas-brazil/assets/LAND-COVER/COLLECTION-11/GENERAL/SAMPLES/CERRADO/v{version_out}/'
        f'train_col11_reg{region}_{year}_v{version_out}'
    )
    for region in regions
    for year in years
]

# Identify missing assets
missing = [entry for entry in expected if entry not in files]
missing_set = set(missing)

# Load biome layer raster data
biomes = ee.Image('projects/mapbiomas-workspace/AUXILIAR/biomas-2019-raster')
cerrado = biomes.updateMask(biomes.eq(4))

# Load the Cerrado classification regions feature collection
regionsCollection = ee.FeatureCollection('projects/ee-ipam-cerrado/assets/ancillary/collection_11_classification_regions_vector')

# Load the sample points generated in the previous step
# The version of sample points is determined by `version_in`.
sample_assets_by_period = {
    '1985_1996': 'projects/ee-ipam-cerrado/assets/Collection_11/sample/points/samplePoints_1985_1996_v' + version_in,
    '1994_2005': 'projects/ee-ipam-cerrado/assets/Collection_11/sample/points/samplePoints_1994_2005_v' + version_in,
    '2003_2014': 'projects/ee-ipam-cerrado/assets/Collection_11/sample/points/samplePoints_2003_2014_v' + version_in,
    '2012_2024': 'projects/ee-ipam-cerrado/assets/Collection_11/sample/points/samplePoints_2012_2024_v' + version_in,
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
# Assigns the correct training sample points asset based on the processing year.
def get_sample_asset_by_year(year):
    if 1985 <= year <= 1993:
        return sample_assets_by_period['1985_1996']
    elif 1994 <= year <= 2002:
        return sample_assets_by_period['1994_2005']
    elif 2003 <= year <= 2011:
        return sample_assets_by_period['2003_2014']
    elif 2012 <= year <= 2025:
        return sample_assets_by_period['2012_2024']
    else:
        raise ValueError(f'Year outside expected range: {year}')

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
    collection = collection.map(getNDVI).map(getNBR).map(getNDTI).map(getMNDWI) \
                              .map(getEVI2).map(getGCVI).map(getMSI).map(getMSAVI) \
                              .map(getTCW).map(getTCA)

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
        if y < year - 2]
    
    # Delete the obsolete years from the dictionary
    for y in years_to_remove:
        del mosaic_dict_3yr[y]

    return mosaic_dict_3yr

## Main Processing Loop
# Iterate over each unique classification region
for region_list in regions:
    # Check if region is fully processed
    region_missing = [
        asset for asset in missing
        if f'_reg{region_list}_' in asset
    ]

    if len(region_missing) == 0:
        print(f'Region {region_list}: all assets already exist. Skipping region.')
        continue

    print('--------------------------------')
    print('Processing region [', region_list, ']')
    print('Missing assets in region:', len(region_missing))

    # Filter spatial geometry
    region_i = regionsCollection.filterMetadata('mapb','equals',region_list).geometry()
    region_fc = regionsCollection.filterMetadata('mapb','equals',region_list)
    region_i_img = ee.Image('projects/barbaracosta-ipam/assets/base/CERRADO_CLASSIFICATION_REGIONS').eq(region_list).selfMask()

    # Extract pixel latitude and longitude coordinates
    coords = ee.Image.pixelLonLat().clip(region_i)

    # Compute auxiliary coordinates
    coords = ee.Image.pixelLonLat().clip(region_i)
    lat = coords.select('latitude').add(5).multiply(-1).multiply(1000).toInt16().rename('latitude')
    lon_sin = coords.select('longitude').multiply(math.pi).divide(180).sin().multiply(-1).multiply(10000).toInt16().rename('longitude_sin')
    lon_cos = coords.select('longitude').multiply(math.pi).divide(180).cos().multiply(-1).multiply(10000).toInt16().rename('longitude_cos')
    hand = ee.ImageCollection("users/gena/global-hand/hand-100").mosaic().toInt16().clip(region_i).rename('hand')

    # Reduced dictionary for trailing 3-year metrics
    mosaic_dict_3yr = {}

    # Iterate over each year
    for year in years:
        asset_id = (dirout +'train_col11_reg' + str(region_list) + '_' + str(year) + '_v' + version_out)
        print('Processing year [', year, ']')

        # Build Base Mosaic & Context Metrics
        mosaic = buildAnnualMosaic(
            year=year,
            region_i=region_i
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
                        .addBands(fire_age.select(f'classification_{year}').rename('fire_age').clip(region_i))

        # Iterate through the geomorphology dictionary and append each band to the mosaic
        for key in geomorpho:
            mosaic = mosaic.addBands(geomorpho[key])

        # Final Formatting
        mosaic = mosaic.multiply(100).round().toInt32()
        mosaic = mosaic.addBands(ee.Image(year).int16().rename('year'))
        mosaic = mosaic.clip(region_i)

        ## Sampling and Export
        # Extract Feature Space from Points
        samples = ee.FeatureCollection(get_sample_asset_by_year(year))
        training_samples = samples.filterBounds(region_fc)

        # Sample reduction for large/problematic regions
        if region_list in reduced_regions:
            training_samples = training_samples.randomColumn("random")
            training_samples = training_samples.filter(
                ee.Filter.lt("random", 0.70)
            )

        # Extract the mosaic pixel values at the locations of the training points
        training_i = mosaic.sampleRegions(
            collection = training_samples,
            scale = 30,
            geometries = True,
            tileScale = 8
        )

        # Filter the extracted collection to remove points that returned null values for any band
        band_names = mosaic.bandNames().getInfo()
        training_i = training_i.filter(ee.Filter.notNull(band_names))

        # Export to Earth Engine
        task = ee.batch.Export.table.toAsset(
            collection=training_i,
            description=('train_col11_reg' + str(region_list) + '_' + str(year) + '_v' + version_out),
            assetId=asset_id
        )

        # Submit the export task to the Earth Engine servers
        task.start()
        print('------------> NEXT YEAR --------->')

print('✅ All tasks have been started. Now wait a few hours and have fun :)')
