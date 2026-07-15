# --- --- --- 04) Training Samples Generation
# This script extracts spectral and geomorphometric signatures for spatial 
# sample points across the Cerrado biome. It uses Sentinel mosaics, 
# Google Satellite Embeddings, and Geomorpho90m covariates to create the 
# final training datasets for the Land Use and Land Cover classification model.


## Initialization and Imports
import ee            # Import the Earth Engine API
import math          # Import math for trigonometric functions
import pandas as pd  # Import pandas for data manipulation 
import sys           # Import system-specific parameters and functions
import os            # Import operating system functionalities
import re            # Import regular expression operations for string parsing
import time          # Import time-related functions

# Authenticate the Earth Engine account (required in new environments)
ee.Authenticate()

# Initialize the Earth Engine session with the specified project
ee.Initialize(project = 'ee-ipam')

## Environment and Custom Module Setup
# Define the repository URL containing the custom mapbiomas mosaic scripts
REPO_URL = "https://github.com/costa-barbara/mapbiomas-mosaic.git"

# Define the local directory path to clone the repository into
REPO_DIR = "/content/mapbiomas-mosaic-10m"

# Define the specific Git branch to be used
BRANCH = "mapbiomas-mosaics-10m"

# Iterate through loaded Python modules to remove previously cached custom modules
for module_name in list(sys.modules.keys()):
    if module_name == "modules" or module_name.startswith("modules."):
        del sys.modules[module_name]

# Remove any previous instances of the repository path from the system path
sys.path = [p for p in sys.path if p != REPO_DIR]

# Force remove the old local copy of the repository
!rm -rf /content/mapbiomas-mosaic-10m

# Clone the specific branch of the repository into the defined local folder
!git clone --branch mapbiomas-mosaics-10m --single-branch https://github.com/costa-barbara/mapbiomas-mosaic.git /content/mapbiomas-mosaic-10m

# Confirm the active branch in the cloned repository
!git -C /content/mapbiomas-mosaic-10m branch --show-current
!git -C /content/mapbiomas-mosaic-10m status
!git -C /content/mapbiomas-mosaic-10m log -1 --oneline

# Add the cloned repository directory to the top of the Python system path
sys.path.insert(0, REPO_DIR)

# Import custom spectral index functions from the downloaded module
from modules.SpectralIndexes import *

## Parameters and Asset Management
# Define the input version for the sample points
version_in = '4'

# Define the output version for the generated training data
version_out  = '5'

# Define the base output folder path for storing the generated training assets in GEE
dirout = f'projects/ee-ipam/assets/MAPBIOMAS/LULC/CERRADO_DEV/COL_11/SENTINEL/trainings/'

# Define the list of years to be processed
years = list(range(2017, 2026))

# Define the list of classification regions (IDs) to be processed.
regions = list(range(1, 39))

# Define specific regions where the number of samples must be downsampled to prevent memory limits
# This is often done to mitigate memory issues during Earth Engine computations for large regions
reduced_regions  = [8, 10, 14, 15, 20, 21, 32]

# Retrieve the list of all existing assets currently saved in the output directory
files = ee.data.listAssets({'parent': dirout})

# Extract only the asset name strings from the API response
files = [asset['name'] for asset in files['assets']]

# Strip the legacy prefix from the asset names to standardize the format for comparison
files = [file.replace('projects/earthengine-legacy/assets/', '') for file in files]

# Generate a comprehensive list of all expected asset names based on regions and years
expected = [
    f'projects/ee-ipam/assets/MAPBIOMAS/LULC/CERRADO_DEV/COL_11/SENTINEL/trainings/v{version_out}/train_col04_reg{region}_{year}_v{version_out}'
    for region in regions for year in years
]

# Compare expected assets against existing files to identify only the missing tasks
# These are the assets that still need to be generated.
missing = [entry for entry in expected if entry not in files]

# Load the Cerrado classification regions feature collection
regionsCollection = ee.FeatureCollection('projects/ee-ipam-cerrado/assets/ancillary/collection_11_classification_regions_vector')

# Load the unified sample points generated in the previous step
# The version of sample points is determined by `version_in`.
samples = ee.FeatureCollection('projects/ee-ipam-cerrado/assets/Collection_04/sample/points/samplePoints_v' + version_in)

# Define the Earth Engine asset ID for the Google Satellite Embedding dataset
# Source: https://developers.google.com/earth-engine/datasets/catalog/GOOGLE_SATELLITE_EMBEDDING_V1_ANNUAL?hl=pt-br
embeddings = 'GOOGLE/SATELLITE_EMBEDDING/V1/ANNUAL'

# Define the target biome to filter the Sentinel mosaics
biomes = ['CERRADO'];

# Initialize an empty dictionary to temporarily store computed mosaics by year
mosaic_dict = {}

## Main Processing Loop
# Iterate over each missing asset that needs to be generated
for obj in missing:
    # Print the name of the asset currently being processed
    print(obj)

    # Use regular expressions to extract the region ID from the expected asset name
    match = re.search(r"(?<=reg)\d+", obj)
    if match:
        region_list = int(match.group())

    # Use regular expressions to extract the year from the expected asset name
    match = re.search(r"\d{4}", obj)
    if match:
        year = int(match.group())

    # Filter the regions collection to isolate the geometry of the current region
    region_i = regionsCollection.filterMetadata('mapb', "equals", region_list).geometry()

    # Print a status message indicating the current region and year
    print(f'Processing region [{region_list}] - year [{year}]')

    # Load the region raster and mask it to keep only the pixels of the current region
    region_i_img = ee.Image('projects/barbaracosta-ipam/assets/base/CERRADO_CLASSIFICATION_REGIONS').eq(region_list).selfMask()

    ## Covariates and Coordinates
    # Extract pixel latitude and longitude coordinates
    geo_coordinates = ee.Image.pixelLonLat().clip(region_i)

    # Compute auxiliary coordinates
    coords = ee.Image.pixelLonLat().clip(region_i)
    lat = coords.select('latitude').add(5).multiply(-1).multiply(1000).toInt16()
    lon_sin = coords.select('longitude').multiply(math.pi).divide(180).sin().multiply(-1).multiply(10000).toInt16().rename('longitude_sin')
    lon_cos = coords.select('longitude').multiply(math.pi).divide(180).cos().multiply(-1).multiply(10000).toInt16().rename('longitude_cos')

    # Construct a dictionary containing Geomorpho90m topographic covariates and MERIT DEM
    # Source: Amatulli et al. 2019 - https://www.nature.com/articles/s41597-020-0479-6
    geomorpho = {
        'dem': ee.Image('MERIT/DEM/v1_0_3').select('dem').toInt64().rename('merit_dem'),
        'aspect': ee.ImageCollection("projects/sat-io/open-datasets/Geomorpho90m/aspect").mosaic().multiply(10000).round().rename('aspect').toInt64(),
        'convergence': ee.ImageCollection("projects/sat-io/open-datasets/Geomorpho90m/convergence").mosaic().multiply(10000).round().rename('convergence').toInt64(),
        'pcurv': ee.ImageCollection("projects/sat-io/open-datasets/Geomorpho90m/pcurv").mosaic().multiply(10000).round().rename('pcurv').toInt64(),
        'tcurv': ee.ImageCollection("projects/sat-io/open-datasets/Geomorpho90m/tcurv").mosaic().multiply(10000).round().rename('tcurv').toInt64(),
        'roughness': ee.ImageCollection("projects/sat-io/open-datasets/Geomorpho90m/roughness").mosaic().multiply(10000).round().rename('roughness').toInt64(),
        'eastness': ee.ImageCollection("projects/sat-io/open-datasets/Geomorpho90m/eastness").mosaic().multiply(10000).round().rename('eastness').toInt64(),
        'northness': ee.ImageCollection("projects/sat-io/open-datasets/Geomorpho90m/northness").mosaic().multiply(10000).round().rename('northness').toInt64(),
        'dxx': ee.ImageCollection("projects/sat-io/open-datasets/Geomorpho90m/dxx").mosaic().multiply(10000).round().rename('dxx').toInt64(),
        'cti': ee.ImageCollection("projects/sat-io/open-datasets/Geomorpho90m/cti").mosaic().multiply(10000).round().rename('cti').toInt64(),
    }

    ## Mosaic Assembly
    # Define the start date based on the current iteration year
    dateStart = ee.Date.fromYMD(year, 1, 1)

    # Define the end date exactly one year after the start date
    dateEnd = dateStart.advance(1, 'year')

    # Filter and mosaic the Google Satellite Embeddings for the specific year and region
    emb_mosaic = ee.ImageCollection(embeddings)\
                    .filter(ee.Filter.date(dateStart, dateEnd))\
                    .filterBounds(region_i)\
                    .mosaic()

    # Conditionally process Sentinel mosaics depending on the year
    if year <= 2023:
        # Load, filter, and mosaic the standard Sentinel source up to 2023
        sentinel_source = ee.ImageCollection("projects/mapbiomas-mosaics/assets/SENTINEL/BRAZIL/mosaics-3") \
                            .filter(ee.Filter.inList('biome', biomes))\
                            .filter(ee.Filter.eq('year', year))\
                            .filter(ee.Filter.bounds(region_i))\
                            .mosaic()
    else:
        # Extract the band names from the 2023 baseline to standardize the newer collection
        ref_bands = (
                ee.ImageCollection("projects/mapbiomas-mosaics/assets/SENTINEL/BRAZIL/mosaics-3")
                .filter(ee.Filter.inList('biome', biomes))
                .filter(ee.Filter.eq('year', 2023))
                .first()
                .bandNames()
            )

        # Load, filter, and mosaic the new MapBiomas2 Sentinel source and force band selection consistency
        sentinel_source = ee.ImageCollection("projects/nexgenmap/MapBiomas2/SENTINEL/mosaics-3") \
                            .filter(ee.Filter.inList('biome', biomes))\
                            .filter(ee.Filter.eq('year', year))\
                            .filter(ee.Filter.bounds(region_i))\
                            .mosaic()\
                            .select(ref_bands)

    # print(f"Number of Images ", (sentinel_source).aggregate_array('year').size().getInfo())

    # Initialize the mosaic using the computed Sentinel source
    mosaic = sentinel_source

    # Define the list of suffixes used in the Sentinel mosaic bands representing different temporal aggregates
    suffixes = ['median', 'median_dry', 'median_wet', 'stdDev']

    # Define a helper function to isolate and strip suffixes for index calculation
    def rename_bands_for_suffix(image, suffix):
      bands = image.bandNames()
      bands_with_suffix = bands.map(lambda b: ee.String(b)).filter(ee.Filter.stringEndsWith('item', f'_{suffix}'))
      renamed_bands = bands_with_suffix.map(lambda b: ee.String(b).replace(f'_{suffix}', ''))
      image = image.select(bands_with_suffix, renamed_bands)
      return image

    # Define a helper function to compute all spectral indices across all suffixes
    def apply_indices_all_suffixes(image):
      all_suffix_images = []
      for suffix in suffixes:
          img_suffix = rename_bands_for_suffix(image, suffix)

          # Apply all custom spectral index functions imported from the MapBiomas module
          img_suffix = getNDVI(img_suffix)
          img_suffix = getMNDWI(img_suffix)
          img_suffix = getPRI(img_suffix)
          img_suffix = getCAI(img_suffix)
          img_suffix = getEVI2(img_suffix)
          img_suffix = getGCVI(img_suffix)
          img_suffix = getGRND(img_suffix)
          img_suffix = getMSI(img_suffix)
          img_suffix = getGARI(img_suffix)
          img_suffix = getGNDVI(img_suffix)
          img_suffix = getMSAVI(img_suffix)
          img_suffix = getHallCover(img_suffix)
          img_suffix = getHallHeigth(img_suffix)
          img_suffix = getTGSI(img_suffix)
          img_suffix = getNDVIRED(img_suffix)
          img_suffix = getVI700(img_suffix)
          img_suffix = getIRECI(img_suffix)
          img_suffix = getCIRE(img_suffix)
          img_suffix = getTCARI(img_suffix)
          img_suffix = getSFDVI(img_suffix)
          img_suffix = getNDRE(img_suffix)

          # Re-attach the suffix to the newly calculated index bands to avoid name conflicts
          img_suffix = img_suffix.rename(img_suffix.bandNames().map(lambda b: ee.String(b).cat(f'_{suffix}')))
          all_suffix_images.append(img_suffix)

      # Concatenate all processed suffix image bands into a single image
      return ee.Image.cat(all_suffix_images)
  
    # Apply the indices calculation function to the base mosaic 
    mosaic = apply_indices_all_suffixes(mosaic)

    # Append the Google Embeddings and coordinate bands to the main mosaic
    mosaic = mosaic.addBands(emb_mosaic).addBands(lat).addBands(lon_sin).addBands(lon_cos)

    # Iterate through the geomorphology dictionary and append each band to the mosaic
    for key in geomorpho:
        mosaic = mosaic.addBands(geomorpho[key])

    # Store the fully assembled mosaic in the tracking dictionary
    mosaic_dict[year] = mosaic

    # Convert to int64 to minimize storage size
    mosaic = mosaic.multiply(100000).round().unmask(0)

    # Append a constant band representing the processing year
    mosaic = mosaic.addBands(ee.Image(year).int16().rename('year'))

    # Clip the final multi-band composite to the boundaries of the current region
    mosaic = mosaic.clip(region_i)

    # print(f"Avaiable bands: ", mosaic.bandNames().getInfo())

    ## Sampling and Export
    # Filter the input sample points to retain only those falling within the current region
    training_samples = samples.filterBounds(regionsCollection.filterMetadata('mapb', "equals", region_list))

    # Apply a 70% random downsample strictly if the region is listed in the 'reduced_regions' list
    if region_list in reduced_regions:
        training_samples = training_samples.randomColumn("random")
        training_samples = training_samples.filter(ee.Filter.lt("random", 0.70))

    # Extract the mosaic pixel values at the locations of the training points
    training_i =mosaic.sampleRegions(
        collection=training_samples,
        scale= 10,
        geometries= True,
        tileScale= 8
      )

    # Print the total number of points for this region
    print('Number of training points: ' + str(training_samples.size().getInfo()))

    # point = ee.Geometry.Point([-42.7989, -4.5429])
    # print(
    #     mosaic.reduceRegion(
    #         reducer=ee.Reducer.first(),
    #         geometry=point,
    #         scale=10
    #       ).getInfo()
    #     )

    # Filter the extracted collection to remove points that returned null values for any band
    training_i = training_i.filter(ee.Filter.notNull(mosaic.bandNames()))

    # Export to Earth Engine
    task = ee.batch.Export.table.toAsset(
        collection=training_i,
        description='train_col04_reg' + str(region_list) + '_' + str(year) + '_v' + version_out,
        assetId=dirout + 'train_col04_reg' + str(region_list) + '_' + str(year) + '_v' + version_out
    )

    # Submit the export task to the Earth Engine servers
    task.start()
    print ('------------> NEXT REGION --------->')

print('✅ All tasks have been started. Now wait a few hours and have fun :)')
