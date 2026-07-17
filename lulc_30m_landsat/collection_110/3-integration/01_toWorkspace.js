// --- --- --- 01) Export to MapBiomas Workspace
// This script prepares and exports the final Cerrado LULC classification for 
// integration into the general MapBiomas workspace. It iterates over the time 
// series, formatting metadata attributes. Crucially, it applies a spatial-thematic 
//  correction within the Alto Paraguai Watershed (BAP) boundary, using the Pantanal 
//  biome's classification ensuring ecological harmony across biome borders.

// Define the base input path and filename for the Cerrado classification
var assetInput = 'projects/ee-ipam/assets/MAPBIOMAS/LULC/CERRADO_DEV/COL_11/LANDSAT/C11-POST-CLASSIFICATION/';
var fileName = 'CERRADO_C04_native_spt1_rocky_spt1_v2';

// Define the target output directory in the MapBiomas general workspace
var assetOutput = 'projects/mapbiomas-brazil/assets/LAND-COVER-10M/COLLECTION-4/GENERAL/classification-cer-ft';

// Define the output version 
var outputVersion = '2';

// Set the official MapBiomas collection launch ID
var collectionId = 4.0;

// Define the biome context for metadata mapping
var theme = {type: 'biome', name: 'CERRADO'};

// Define the source institution for metadata tracking
var source = 'ipam';

// Define the sequential list of years to be processed and exported
var years = ['2017', '2018', '2019', '2020', 
             '2021', '2022', '2023', '2024', 
             '2025'
             ];

// Import the official MapBiomas color palette mapped to 62 classes
var palette = require('users/mapbiomas/modules:Palettes.js').get('brazil');

// Define a general bounding box covering the extent of Brazil to standardize export geometry
var geometry = ee.Geometry.Polygon([[
  [-75.46319738935682, 6.627809464162168], 
  [-75.46319738935682, -34.62753178950752],
  [-32.92413488935683, -34.62753178950752], 
  [-32.92413488935683, 6.627809464162168]
]], null, false);


// Load the multi-band Cerrado classification image
var collection = ee.Image(assetInput + fileName);

// Print processing information to the console
print('Processing file', fileName);
print('Input collection', collection);

// Add the full multi-band collection to the map (default visualization)
Map.addLayer(collection, {}, 'Input data', false);

// Load the Pantanal classification asset used as a reference for boundary correction
var assetPantanal = ee.Image('projects/mapbiomas-workspace/AMOSTRAS/S2_EMBEDDING/PANTANAL/PANT_colS2Emb_Anual_12');

// Load the Alto Paraguai Watershed (BAP) boundary and convert it into a binary mask
var bapBoundaries = ee.Image(1).clip(ee.FeatureCollection('projects/barbaracosta-ipam/assets/collection-9/BAP_limit'));

// Iterate through each year in the defined time series
years.forEach(function(year) {

  // Select the Cerrado classification band for the current processing year
  var imageYear = collection.select('classification_' + year);
  
  // Rename the band to the standard 'classification' nomenclature required by MapBiomas
  imageYear = imageYear.rename('classification');

  // Embed standardized metadata properties directly into the annual image
  imageYear = imageYear.set('territory', 'BRAZIL')
    .set('biome', 'CERRADO')
    .set('collection_id', collectionId)
    .set('version', outputVersion)
    .set('source', source)
    .set('year', parseInt(year, 10))
    .set('description', fileName);

  // Define standardized visualization parameters for map rendering and export
  var vis = { min: 0, max: 75, palette: palette, format: 'png' };

  // Construct the standardized export filename (e.g., CERRADO-2017-1)
  var name = year + '-' + outputVersion;
  if (theme.type === 'biome') { name = theme.name + '-' + name; }

  // Pantanal 2024 is used as the reference for 2025
  var pantanalReferenceYear = year === '2025' ? '2024' : year;

  // Extract the specific annual band from the Pantanal classification for boundary correction
  var pantanalYear = assetPantanal.select('classification_' + pantanalReferenceYear);

  // Alto Paraguai Watershed (BAP) Correction Logic

  imageYear = imageYear.where(
    imageYear.eq(21).and(pantanalYear.eq(3)).and(bapBoundaries.eq(1)), 4);

  imageYear = imageYear.where(
    imageYear.eq(21).and(pantanalYear.eq(4)).and(bapBoundaries.eq(1)), 4);
    
  imageYear = imageYear.where(
    imageYear.eq(21).and(pantanalYear.eq(11)).and(bapBoundaries.eq(1)), 11);
    
  imageYear = imageYear.where(
    imageYear.eq(21).and(pantanalYear.eq(12)).and(bapBoundaries.eq(1)), 12);

  // Render the corrected annual classification on the map
  Map.addLayer(imageYear, vis, theme.name + ' ' + year, false);
  
  // Print diagnostic tracking to the console
  print('Output year: ' + year, imageYear);
  print('Pantanal reference year used for correction: ' + pantanalReferenceYear);

  // Configure and execute the Earth Engine batch task to export the annual image to the workspace
  Export.image.toAsset({
    image: imageYear,
    description: name,
    assetId: assetOutput + '/' + name,
    pyramidingPolicy: {'.default': 'mode'},
    region: geometry,
    scale: 10,
    maxPixels: 1e13
  });
});

// Load the official IBGE 2025 Cerrado biome boundary vector
var cerrado = ee.FeatureCollection('projects/ee-ipam-cerrado/assets/ancillary/IBGE_2025_limite-cerrado');

// Paint the boundary onto an empty image for fast rendering (thickness: 3, red palette)
var line = ee.Image().paint(cerrado, 'empty', 3).visualize({palette: 'FF0000'});

// Render the Cerrado boundary line on the map
Map.addLayer(line, {}, 'Cerrado limit');
