# --- --- --- 04) Training Samples Generation
# This script extracts temporal and geomorphometric signatures for the Rocky 
# Outcrop classification. It generates annual mosaics (2017–2024) using Google 
# Satellite Embeddings and Geomorpho90m topographic covariates. It then 
# samples these mosaics at the pre-defined stratified training point locations 
# (using a 70% random split) and exports the datasets as GEE Table Assets.

## Initialization and Imports
import ee            # Import the Earth Engine API
import math          # Import math for trigonometric functions

# Authenticate the Earth Engine account (required in new environments)
ee.Authenticate()

# Initialize the Earth Engine session with the specified project
ee.Initialize(project = 'ee-ipam')

## Parameters and Asset Paths
# Define the input version for the sample points
version_in = '1'

# Define the output version for the generated training data
version_out = '1'

# Define the base output folder path for storing the generated training assets in GEE
dirout = f'projects/ee-barbarasilvaipam/assets/collection-04_rocky-outcrop/trainings/v{version_out}/'

# Define the list of years to be processed
years = list(range(2017, 2026))

# Define the Earth Engine asset ID for the Google Satellite Embedding dataset
# Source: https://developers.google.com/earth-engine/datasets/catalog/GOOGLE_SATELLITE_EMBEDDING_V1_ANNUAL?hl=pt-br
collectionId = 'GOOGLE/SATELLITE_EMBEDDING/V1/ANNUAL'

## Load Base Datasets
# Load the Area of Interest (AOI) feature
aoi_vec = ee.FeatureCollection('projects/ee-barbarasilvaipam/assets/collection-04_rocky-outcrop/masks/aoi_v1').geometry()

# Convert the AOI geometry into a binary image mask
aoi_img = ee.Image(1).clip(aoi_vec)

# Load the unified sample points generated in the previous step
samples = ee.FeatureCollection('projects/ee-barbarasilvaipam/assets/collection-04_rocky-outcrop/sample/points/samplePoints_v' + version_in)

## Geomorphometric Covariates
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


    ## Mosaic Assembly 

    # Define the start date based on the current iteration year
    dateStart = ee.Date.fromYMD(year, 1, 1)

    # Define the end date
    dateEnd = dateStart.advance(1, 'year')

    # Filter the Google Satellite Embeddings collection by date 
    collection = ee.ImageCollection(collectionId).filter(ee.Filter.date(dateStart, dateEnd)).filter(ee.Filter.bounds(aoi_vec)).mosaic()

    # Assign the embedded mosaic as the base image for the final composition
    mosaic = collection

    # Append the processed geographic coordinate bands to the mosaic
    mosaic = mosaic.addBands(lat).addBands(lon_sin).addBands(lon_cos)
    
    # Iterate through the geomorphology dictionary and append each topographic band to the mosaic
    for key in geomorpho:
        mosaic = mosaic.addBands(geomorpho[key])

    # Store the assembled multi-band composite in the tracking dictionary
    mosaic_dict[year] = mosaic

    # Clip the final mosaic to the boundaries of the AOI
    mosaic = mosaic.clip(aoi_vec)

    # Scale the mosaic values and round them to prepare for extraction
    mosaic = mosaic.multiply(100000).round()

    # Append a constant band representing the processing year cast as Int16
    mosaic = mosaic.addBands(ee.Image(year).int16().rename('year'))


    ## Sampling and Export

    # Assign a random column to the samples and filter out 70% of them for training purposes
    training_samples = samples.randomColumn("random").filter(ee.Filter.lt('random', 0.70))

    # Extract the mosaic pixel values at the locations of the training points
    training_i = mosaic.sampleRegions(
        collection=training_samples,
        scale=10,
        geometries=True,
        tileScale=4
    )

    # Print the total number of points submitted for extraction to the console
    print('Number of training points: ' + str(training_samples.size().getInfo()))

    # Filter the extracted collection to strictly remove points that returned null values for any band
    training_i = training_i.filter(ee.Filter.notNull(mosaic.bandNames().getInfo()))

    # Construct the exact expected asset ID for the current year's export
    asset_id = f'{dirout}train_col04_rocky_{year}_v{version_out}'
    
    # Check if the asset already exists in the directory to prevent redundant processing
    if asset_exists(asset_id):
        print(f'--> Asset already exists: {asset_id} — skipping export.')
        continue

    # Configure the Earth Engine batch export task for the extracted training table
    task = ee.batch.Export.table.toAsset(
        collection=training_i,
        description=f'train_col04_rocky_{year}_v{version_out}',
        assetId=asset_id
    )

    # Submit the export task to the Earth Engine servers
    task.start()
    
    print('============================================')

# Print completion message
print('✅ All tasks have been started. Now wait a few hours and have fun :)')
