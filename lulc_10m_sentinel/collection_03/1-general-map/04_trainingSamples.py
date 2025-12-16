# --- --- --- 04_trainingSamples
# Generate annual training samples for land cover classification
# Using sentinel mosaics, satellite embedding, and geomorphometry data for the Cerrado biome (2017–2024)
# barbara.silva@ipam.org.br, dhemerson.costa@ipam.org.br and ana.souza@ipam.org.br

## Read libraries
import ee
import math
import pandas as pd
import sys
import os
import re
import time

# Authenticate and initialize Earth Engine
ee.Authenticate()
ee.Initialize(project = 'ee-ipam-cerrado') # change for your own project

# Clone the GitHub repository with helper functions
!rm -rf /content/mapbiomas-mosaic
!git clone https://github.com/costa-barbara/mapbiomas-mosaic.git
sys.path.append("/content/mapbiomas-mosaic")

# Import custom modules for mosaicking and spectral metrics
from modules.SpectralIndexes import *

# Define input and output versions for processing
version_in = '3'
version_out  = '9'

# Define output folder path
dirout = f'projects/mapbiomas-workspace/COLECAO_DEV/COLECAO10_DEV/CERRADO/SENTINEL/trainings/v{version_out}/'

# Define the range of years to be processed
years = list(range(2017, 2025))

# Define the list of regions to be processed
regions = list(range(1, 39))

# Regions where it is necessary to reduce the number of samples due to their size and memory excess errors
reduced_regions  = [8, 10, 14, 15, 20, 21, 32]

# List existing assets in the output folder
files = ee.data.listAssets({'parent': dirout})
files = [asset['name'] for asset in files['assets']]

# Remove the prefix from asset name
files = [file.replace('projects/earthengine-legacy/assets/', '') for file in files]

# Identify missing assets
expected = [
    f'projects/mapbiomas-workspace/COLECAO_DEV/COLECAO10_DEV/CERRADO/SENTINEL/trainings/v{version_out}/train_col03_reg{region}_{year}_v{version_out}'
    for region in regions for year in years
]

# Identify missing assets
missing = [entry for entry in expected if entry not in files]

# Load biome layer raster data
biomes = ee.Image('projects/mapbiomas-workspace/AUXILIAR/biomas-2019-raster')
biome_mask = biomes.updateMask(biomes.eq(4))

# Load classification region boundaries
regionsCollection = ee.FeatureCollection('users/dh-conciani/collection7/classification_regions/vector_v2')

# Load sample points for training
samples = ee.FeatureCollection('projects/mapbiomas-workspace/COLECAO_DEV/COLECAO10_DEV/CERRADO/SENTINEL/sample/points/samplePoints_v' + version_in)

# Google Satellite Embedding (Source: https://developers.google.com/earth-engine/datasets/catalog/GOOGLE_SATELLITE_EMBEDDING_V1_ANNUAL?hl=pt-br)
embeddings = 'GOOGLE/SATELLITE_EMBEDDING/V1/ANNUAL'

# List for Cerrado biome
biomes = ['CERRADO'];

# Initialize dictionary to store mosaics by year
mosaic_dict = {}

 Generate and export training samples per year and region
for obj in missing:
    print(obj)

    # Extract region ID from asset name using regex
    match = re.search(r"(?<=reg)\d+", obj)
    if match:
        region_list = int(match.group())

    # Extract year from asset name using regex
    match = re.search(r"\d{4}", obj)
    if match:
        year = int(match.group())

    # Subset the region from the classification collection
    region_i = regionsCollection.filterMetadata('mapb', "equals", region_list).geometry()
    print(f'Processing region [{region_list}] - year [{year}]')

    region_i_img = ee.Image('projects/barbaracosta-ipam/assets/base/CERRADO_CLASSIFICATION_REGIONS').eq(region_list).selfMask()

    # Compute additional bands
    # Generate geographic coordinates for modeling
    geo_coordinates = ee.Image.pixelLonLat().clip(region_i)

    # Compute auxiliary coordinates
    coords = ee.Image.pixelLonLat().clip(region_i)
    lat = coords.select('latitude').add(5).multiply(-1).multiply(1000).toInt16()
    lon_sin = coords.select('longitude').multiply(math.pi).divide(180).sin().multiply(-1).multiply(10000).toInt16().rename('longitude_sin')
    lon_cos = coords.select('longitude').multiply(math.pi).divide(180).cos().multiply(-1).multiply(10000).toInt16().rename('longitude_cos')

    # Load geomorphometric covariates (Geomorpho 90m - Amatulli et al. 2019)
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

## -- -- -- Start of mosaic production
    # Set time range for mosaic generation
    dateStart = ee.Date.fromYMD(year, 1, 1)
    dateEnd = dateStart.advance(1, 'year')

    # Filter image collection by date and region
    emb_mosaic = ee.ImageCollection(embeddings)\
                    .filter(ee.Filter.date(dateStart, dateEnd))\
                    .filterBounds(region_i)\
                    .mosaic()
  
    # Select the appropriate Sentinel mosaic collection based on the year
    if year <= 2023:
        sentinel_source = ee.ImageCollection("projects/mapbiomas-mosaics/assets/SENTINEL/BRAZIL/mosaics-3") \
                            .filter(ee.Filter.inList('biome', biomes))\
                            .filter(ee.Filter.eq('year', year))\
                            .filter(ee.Filter.bounds(region_i))\
                            .mosaic()
    else:
        ref_bands = (
                ee.ImageCollection("projects/mapbiomas-mosaics/assets/SENTINEL/BRAZIL/mosaics-3")
                .filter(ee.Filter.inList('biome', biomes))
                .filter(ee.Filter.eq('year', 2023))
                .first()
                .bandNames()
            )
      
        # It also ensures band consistency with previous years by selecting reference bands.
        sentinel_source = ee.ImageCollection("projects/nexgenmap/MapBiomas2/SENTINEL/mosaics-3") \
                            .filter(ee.Filter.inList('biome', biomes))\
                            .filter(ee.Filter.eq('year', year))\
                            .filter(ee.Filter.bounds(region_i))\
                            .mosaic()\
                            .select(ref_bands)
      
    # The main image collection for processing is the sentinel_source
    collection = sentinel_source
    mosaic = collection
  
    # Define suffixes for different temporal metrics
    suffixes = ['median', 'median_dry', 'median_wet', 'stdDev']
  
    # Helper function to rename bands by removing a specific suffix
    def rename_bands_for_suffix(image, suffix):
      bands = image.bandNames()
      bands_with_suffix = bands.map(lambda b: ee.String(b)).filter(ee.Filter.stringEndsWith('item', f'_{suffix}'))

      renamed_bands = bands_with_suffix.map(lambda b: ee.String(b).replace(f'_{suffix}', ''))

      image = image.select(bands_with_suffix, renamed_bands)
      return image
      
    # Function to apply a series of spectral index calculations for each temporal suffix.
    def apply_indices_all_suffixes(image):
      all_suffix_images = []
      for suffix in suffixes:
          # Get the image subset for the current suffix and rename bands
          img_suffix = rename_bands_for_suffix(image, suffix)
        
          # Apply various spectral index calculations
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
        
          # Re-append the suffix to the newly calculated index bands
          img_suffix = img_suffix.rename(
              img_suffix.bandNames().map(lambda b: ee.String(b).cat(f'_{suffix}'))
          )
          all_suffix_images.append(img_suffix)
        
      # Concatenate all images (original bands + all calculated indices with suffixes)
      return ee.Image.cat(all_suffix_images)
      
    # Apply the spectral index calculations to the mosaic
    mosaic = apply_indices_all_suffixes(mosaic)

    # # This includes satellite embedding data, and calculated latitude/longitude sine/cosine
    mosaic = mosaic.addBands(emb_mosaic).addBands(lat).addBands(lon_sin).addBands(lon_cos)

    for key in geomorpho:
        mosaic = mosaic.addBands(geomorpho[key])

    # Store the complete mosaic (with all bands) in the dictionary, keyed by year
    mosaic_dict[year] = mosaic

    # Convert mosaic pixel values to Int64 to ensure compatibility and reduce precision if needed.
    # Values are multiplied by 100000 and rounded, then unmasked (setting masked pixels to 0).
    mosaic = mosaic.multiply(100000).round().unmask(0)

    # Add a 'year' band to the mosaic, representing the current processing year
    mosaic = mosaic.addBands(ee.Image(year).int16().rename('year'))
    mosaic = mosaic.clip(region_i)
  
## -- -- -- End of mosaic production

    # Filter the global training sample points to include only those within the current classification region.
    training_samples = samples.filterBounds(regionsCollection.filterMetadata('mapb', "equals", region_list
    
    # For specific 'reduced_regions', apply stratified sampling to reduce the number of training points by 70%.
    if region_list in reduced_regions:
        training_samples = training_samples.randomColumn("random") # Add a random column for sampling
        training_samples = training_samples.filter(ee.Filter.lt("random", 0.70)) # Keep 70% of samples
    
    # Extract training samples from the mosaic
    training_i =mosaic.sampleRegions(
                collection=training_samples,
                scale=10,
                geometries= True,
                tileScale= 8
    )

    print('number of points: ' + str(training_samples.size().getInfo()))

    # point = ee.Geometry.Point([-42.7989, -4.5429])
    # print(
    #     mosaic.reduceRegion(
    #         reducer=ee.Reducer.first(),
    #         geometry=point,
    #         scale=10
    #       ).getInfo()
    #     )

    # Remove null values
    training_i = training_i.filter(ee.Filter.notNull(mosaic.bandNames()))

    #print(f"number of points exported: ", training_i.size().getInfo())

    # Export to Earth Engine Asset
    task = ee.batch.Export.table.toAsset(
        collection=training_i,
        description='train_col03_reg' + str(region_list) + '_' + str(year) + '_v' + version_out,
        assetId=dirout + 'train_col03_reg' + str(region_list) + '_' + str(year) + '_v' + version_out
    )

    # Start the export task
    task.start()
    print ('------------> NEXT REGION --------->')

print('✅ All tasks have been started. Now wait a few hours and have fun :)')
  
