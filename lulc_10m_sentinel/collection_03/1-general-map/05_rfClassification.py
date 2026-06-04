## -- -- -- -- 06_rfClassification
# Perform land use and land cover classification using Random Forest (RF) with multiprobability output
# Applies trained RF model to annual Landsat mosaics and exports classification and class probabilities
# Authors: barbara.silva@ipam.org.br, dhemerson.costa@ipam.org.br, and ana.souza@ipam.org.br

## Read libraries
import ee
import sys
import os
import re
import math
import itertools

# Authenticate and initialize Earth Engine
ee.Authenticate()
ee.Initialize(project = 'ee-ipam-cerrado') # chose your own project

# Clone the GitHub repository with helper functions
!rm -rf /content/mapbiomas-mosaic
!git clone https://github.com/costa-barbara/mapbiomas-mosaic.git
sys.path.append("/content/mapbiomas-mosaic")

# Import custom modules for mosaicking and spectral metrics
from modules.SpectralIndexes import *

# Set input and output version
samples_version = '9'
output_version  = '9'

# Define output folder path
output_asset = 'projects/ee-ipam/assets/MAPBIOMAS/LULC/CERRADO_DEV/COL_10/SENTINEL/C03_GENERAL-MAP-PROBABILITY/'

# Define the range of years to be processed
years = list(range(2017, 2025))

# Load classification regions
regions_vec = ee.FeatureCollection('users/dh-conciani/collection7/classification_regions/vector_v2')
regions_ic = 'users/dh-conciani/collection7/classification_regions/eachRegion_v2_10m/'
regions_list = sorted(regions_vec.aggregate_array('mapb').distinct().getInfo())

# List existing output assets
files = ee.data.listAssets({'parent': output_asset})
files = [asset['name'] for asset in files['assets']]

# Remove the prefix from asset name
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
training_dir = 'projects/mapbiomas-workspace/COLECAO_DEV/COLECAO10_DEV/CERRADO/SENTINEL/trainings/'

# Google Satellite Embedding
embeddings = 'GOOGLE/SATELLITE_EMBEDDING/V1/ANNUAL'

# List for Cerrado biome
biomes = ['CERRADO'];

# Initialize dictionary to store mosaics by year
mosaic_dict = {}

# Generate and export classification per year and region
for region in regions_list:
    print(f'Processing region [{region}]')
    importance_region_list = []

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

    # Iterate over missing assets to generate and export them
    missing_i = [
    item for item in missing
    if re.search(rf"CERRADO_{region}_[0-9]{{4}}_v{output_version}$", item)
  ]

    for year in years:
        print(f'----> {year}')

## -- -- -- Start of mosaic production
        # Set time range for mosaic generation
        dateStart = ee.Date.fromYMD(year, 1, 1)
        dateEnd = dateStart.advance(1, 'year')

        # Filter image collection by date and region
        emb_mosaic = ee.ImageCollection(embeddings)\
                        .filter(ee.Filter.date(dateStart, dateEnd))\
                        .filterBounds(region_i_vec)\
                        .mosaic()
        
        # Select the appropriate Sentinel mosaic collection based on the year
        if year <= 2023:
            sentinel_source = ee.ImageCollection("projects/mapbiomas-mosaics/assets/SENTINEL/BRAZIL/mosaics-3") \
                                .filter(ee.Filter.inList('biome', biomes))\
                                .filter(ee.Filter.eq('year', year))\
                                .filter(ee.Filter.bounds(region_i_vec))\
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
                                .filter(ee.Filter.bounds(region_i_vec))\
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
           
        # Function to apply a series of spectral index calculations for each temporal suffix
        def apply_indices_all_suffixes(image):
          all_suffix_images = []
          for suffix in suffixes:
           
              # Get the image subset for the current suffix and rename bands
              img_suffix = rename_bands_for_suffix(image, suffix)

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

        # This includes satellite embedding data, and calculated latitude/longitude sine/cosine
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
        mosaic = mosaic.clip(region_i_vec)

## -- -- -- End of mosaic production
           
        # Filter the global training sample points to include only those within the current classification region.
        training_ij = ee.FeatureCollection(
            training_dir + f'v{samples_version}/train_col03_reg{region}_{year}_v{samples_version}')\

        # Train RF - Random Forest classifier
        bandNames_list = mosaic.bandNames().getInfo()
        print("Total bands:", mosaic.bandNames().size().getInfo())
        print("Band names:", mosaic.bandNames().getInfo())

        classifier = ee.Classifier.smileRandomForest(
        numberOfTrees=300,
        variablesPerSplit=int(math.floor(math.sqrt(len(bandNames_list))))
        ).setOutputMode('MULTIPROBABILITY') \
        .train(training_ij, 'reference', bandNames_list)

        # Get feature importance from the trained classifier
        importance = ee.Dictionary(classifier.explain().get('importance'))

        # Create a feature with importance values and region/year attributes
        importance_feat = ee.Feature(None, importance)\
            .set('region', region)\
            .set('year', year)

        # Add the importance feature to the list for the current region
        importance_region_list.append(importance_feat)

        # Classify the mosaic image using the trained classifier
        predicted = mosaic.classify(classifier).updateMask(region_i_ras)

        # Format probability output from the classified image
        # Get sorted list of class IDs from training data
        classes = sorted(training_ij.aggregate_array('reference').distinct().getInfo())
        probabilities = predicted.arrayFlatten([list(map(str, classes))])
        new_names = [classDict[int(c)] for c in classes if int(c) in classDict]
        probabilities = probabilities.select(list(map(str, classes)), new_names)
        probabilities = probabilities.multiply(100).round().toInt8()

        # Get classification band from the highest probability class
        probabilitiesArray = probabilities.toArray() \
            .arrayArgmax() \
            .arrayGet([0])

        classificationImage = probabilitiesArray.remap(
            list(range(len(classes))),
            classes
        ).rename('classification')

        # Combine the classification band with individual class probability bands
        toExport = classificationImage.addBands(probabilities)

        # Set metadata
        toExport = toExport.set('collection', '03')\
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
            scale=10,
            maxPixels=1e13,
            pyramidingPolicy={'.default': 'mode'},
            region=region_i_ras.geometry()
        )

        # Create a FeatureCollection from the list of importance features
        importance_fc = ee.FeatureCollection(importance_region_list)

        # Start the export task
        task.start()

    print ('------------> NEXT REGION --------->')

print('✅ All tasks have been started. Now wait a few hours and have fun :)')           
