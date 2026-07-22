// --- --- --- 01) Export to MapBiomas Workspace
// This script prepares and exports the final Cerrado LULC classification for 
// integration into the general MapBiomas workspace. It iterates over the time 
// series, formatting metadata attributes. Crucially, it applies a spatial-thematic 
//  correction within the Alto Paraguai Watershed (BAP) boundary, using the Pantanal 
//  biome's classification, ensuring ecological harmony across biome borders.

// Define the base input path and filename for the Cerrado classification
var assetInput = 'projects/ee-ipam/assets/MAPBIOMAS/LULC/CERRADO_DEV/COL_11/LANDSAT/C11-POST-CLASSIFICATION/';
var fileName = 'CERRADO_C11_native_spt5_rocky_spt10';

// Define the target output directory in the MapBiomas general workspace
var assetOutput = 'projects/mapbiomas-brazil/assets/LAND-COVER/COLLECTION-11/GENERAL/classification-cer-ft';

// Define the output version 
var outputVersion = '6';

// Set the official MapBiomas collection launch ID
var collectionId = 11.0;

// Define the biome context for metadata mapping
var theme = {type: 'biome', name: 'CERRADO'};

// Define the source institution for metadata tracking
var source = 'ipam';

// Define the sequential list of years to be processed and exported
var years = [    
    '1985', '1986', '1987', '1988',
    '1989', '1990', '1991', '1992',
    '1993', '1994', '1995', '1996',
    '1997', '1998', '1999', '2000',
    '2001', '2002', '2003', '2004',
    '2005', '2006', '2007', '2008',
    '2009', '2010', '2011', '2012',
    '2013', '2014', '2015', '2016',
    '2017', '2018', '2019', '2020',
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
var assetPantanal = ee.Image('projects/mapbiomas-brazil/assets/LAND-COVER/COLLECTION-11/GENERAL/classification-pan-ft/PANT_col11_Anual_v17');

// Load the Alto Paraguai Watershed (BAP) boundary and convert it into a binary mask
var bapBoundaries = ee.Image(1).clip(ee.FeatureCollection('projects/ee-ipam-cerrado/assets/ancillary/c11_limit_pantanal_cerrado'));

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

  // Extract the specific annual band from the Pantanal classification for boundary correction
  var pantanalYear = assetPantanal.select('classification_' + year);

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

  // Configure and execute the Earth Engine batch task to export the annual image to the workspace
  Export.image.toAsset({
    image: imageYear,
    description: name,
    assetId: assetOutput + '/' + name,
    pyramidingPolicy: {'.default': 'mode'},
    region: geometry,
    scale: 30,
    maxPixels: 1e13
  });
});

// Load the official IBGE 2025 Cerrado biome boundary vector
var cerrado = ee.FeatureCollection('projects/ee-ipam-cerrado/assets/ancillary/IBGE_2025_limite-cerrado');

// Paint the boundary onto an empty image for fast rendering (thickness: 3, red palette)
var line = ee.Image().paint(cerrado, 'empty', 3).visualize({palette: 'FF0000'});

// Render the Cerrado boundary line on the map
Map.addLayer(line, {}, 'Cerrado limit');
