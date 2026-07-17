# --- --- --- 05) Random Forest Land Cover Classification
# This script performs Land Use and Land Cover (LULC) classification for the 
# Brazilian Cerrado using a Random Forest (RF) algorithm. It dynamically 
# reconstructs the annual Sentinel-based mosaics and geomorphometric covariates, 
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
# Define the input version for the training samples
samples_version = '4'

# Define the output version for the final classification assets
output_version  = '4'

# Define the base output folder path for storing the classification assets in GEE
output_asset = 'projects/ee-ipam/assets/MAPBIOMAS/LULC/CERRADO_DEV/COL_11/SENTINEL/C04_GENERAL-MAP-PROBABILITY/'

# Define the base directory path where the input training samples are stored
training_dir = 'projects/ee-ipam/assets/MAPBIOMAS/LULC/CERRADO_DEV/COL_11/SENTINEL/trainings/'

# Define the list of years to be processed
years = list(range(2017, 2026))

# Load the Cerrado classification regions feature collection
regions_vec = ee.FeatureCollection('projects/ee-ipam-cerrado/assets/ancillary/collection_11_classification_regions_vector')

# Extract a sorted list of unique region IDs from the feature collection
regions_list = sorted(regions_vec.aggregate_array('mapb').distinct().getInfo())

# Retrieve the list of all existing assets currently saved in the output directory
files = ee.data.listAssets({'parent': output_asset})

# Extract only the asset name strings from the API response
files = [asset['name'] for asset in files['assets']]

# Strip the legacy prefix from the asset names to standardize the format for comparison
files = [file.replace('projects/earthengine-legacy/assets/', '') for file in files]

# Generate a comprehensive list of all expected output asset names
expected = [
    f"{output_asset}CERRADO_{region}_{year}_v{output_version}"
    for region, year in itertools.product(regions_list, years)
]

# Compare expected assets against existing files to identify only the missing tasks
missing = [entry for entry in expected if entry not in files]

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

# Define the Earth Engine asset ID for the Google Satellite Embedding dataset
# Source: https://developers.google.com/earth-engine/datasets/catalog/GOOGLE_SATELLITE_EMBEDDING_V1_ANNUAL?hl=pt-br
embeddings = 'GOOGLE/SATELLITE_EMBEDDING/V1/ANNUAL'

# Define the target biome to filter the Sentinel mosaics
biomes = ['CERRADO'];

# Initialize an empty dictionary to temporarily store computed mosaics by year
mosaic_dict = {}

## Main Processing Loop
# Iterate over each region ID in the extracted list
for region in regions_list:
    # Print a status message indicating the current region being processed
    print(f'Processing region: {region}')

    # Filter the regions feature collection to isolate the current region
    region_i_fc = regions_vec.filter(ee.Filter.eq('mapb', int(region)))

    # Dissolve the geometry of the current region and set a max error margin to optimize rendering
    region_i_geom = region_i_fc.geometry().dissolve(maxError=1)

    # Create a binary raster mask derived exactly from the bounded geometry
    region_i_mask = ee.Image.constant(1).clip(region_i_geom).selfMask()

    ## Covariates and Coordinates
    # Extract pixel latitude and longitude coordinates
    geo_coordinates = ee.Image.pixelLonLat().clip(region_i_geom)

    # Compute auxiliary coordinates
    coords = ee.Image.pixelLonLat().clip(region_i_geom)
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

    # Identify exactly which expected output files are missing for the current region
    missing_i = [item for item in missing if re.search(rf"CERRADO_{region}_[0-9]{{4}}_v{output_version}$", item)]

    # Iterate through the list of years to reconstruct the mosaic and classify
    for year in years:
        # Print a sub-status message indicating the current year
        print(f'----> Processing: {year}')

        ## Mosaic Assembly
        # Define the start date based on the current iteration year
        dateStart = ee.Date.fromYMD(year, 1, 1)

        # Define the end date exactly one year after the start date
        dateEnd = dateStart.advance(1, 'year')

        # Filter and mosaic the Google Satellite Embeddings for the specific year and region
        emb_mosaic = ee.ImageCollection(embeddings)\
                        .filter(ee.Filter.date(dateStart, dateEnd))\
                        .filterBounds(region_i_geom)\
                        .mosaic()

        # Conditionally process Sentinel mosaics depending on the year
        if year <= 2023:
            # Load, filter, and mosaic the standard Sentinel source up to 2023
            sentinel_source = ee.ImageCollection("projects/mapbiomas-mosaics/assets/SENTINEL/BRAZIL/mosaics-3") \
                                .filter(ee.Filter.inList('biome', biomes))\
                                .filter(ee.Filter.eq('year', year))\
                                .filter(ee.Filter.bounds(region_i_geom))\
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
                                .filter(ee.Filter.bounds(region_i_geom))\
                                .mosaic()\
                                .select(ref_bands)

        # print(f"Number of Images ", (sentinel_source).aggregate_array('year').size().getInfo())

        # Assign the computed Sentinel source to the main mosaic variable
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
        mosaic = mosaic.clip(region_i_geom)

        ## Random Forest Training and Classification
        # Load the specific training samples feature collection for the current region and year
        training_ij = ee.FeatureCollection(training_dir + f'v{samples_version}/train_col04_reg{region}_{year}_v{samples_version}')\

        # Extract the list of all band names present in the mosaic to serve as predictors
        bandNames_list = mosaic.bandNames().getInfo()
        print("Total bands:", mosaic.bandNames().size().getInfo())

        # Initialize the SmileRandomForest classifier requesting MULTIPROBABILITY output
        classifier = ee.Classifier.smileRandomForest(
            # Set the number of decision trees
            numberOfTrees = 300, 
            # Set the number of variables per split
            variablesPerSplit = int(math.floor(math.sqrt(len(bandNames_list)))) 
            ).setOutputMode('MULTIPROBABILITY') \
            .train(training_ij, 'reference', bandNames_list)

        # Apply the trained classifier to the mosaic and mask the result strictly to the region boundary
        predicted = mosaic.classify(classifier).updateMask(region_i_mask)

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
        ).rename('classification')

        # Concatenate the discrete classification band with all the continuous probability bands
        toExport = classificationImage.addBands(probabilities)

        # Set metadata attributes into the final image before exporting
        toExport = toExport.set('collection', '04')\
            .set('version', output_version)\
            .set('biome', 'CERRADO')\
            .set('mapb', int(region))\
            .set('year', int(year))

        # Define the strict filename template for the output asset
        file_name = f'CERRADO_{region}_{year}_v{output_version}'

        # Configure the Earth Engine batch export task for the classified image
        task = ee.batch.Export.image.toAsset(
            image = toExport,
            description = file_name,
            assetId = output_asset + file_name,
            scale = 10,
            maxPixels = 1e13,
            pyramidingPolicy = {'.default': 'mode'},
            region = region_i_geom,
            overwrite = True
        )

        # Submit the classification export task to the Earth Engine servers
        task.start()

    print ('------------> NEXT REGION --------->')

print('✅ All tasks have been started. Now wait a few hours and have fun :)')
