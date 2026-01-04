// -- -- -- -- 11_geomorphometric
// post-processing filter: geomorphometric post-classification filters based on slope thresholds to correct wetlands and water classes in annual classifications
// barbara.silva@ipam.org.br, dhemerson.costa@ipam.org.br and ana.souza@ipam.org.br

// Import mapbiomas color schema 
var vis = {
    min: 0,
    max: 62,
    palette:require('users/mapbiomas/modules:Palettes.js').get('classification8'),
    bands: 'classification_2023'
};

// Set root directory
var root = 'projects/mapbiomas-workspace/COLECAO_DEV/COLECAO10_DEV/CERRADO/SENTINEL/C03-POST-CLASSIFICATION/';
var out = 'projects/mapbiomas-workspace/COLECAO_DEV/COLECAO10_DEV/CERRADO/SENTINEL/C03-POST-CLASSIFICATION/';

// Set metadata
var inputVersion = '11';
var outputVersion = '6';

// Define the input file 
var inputFile = 'CERRADO_C03_gapfill_v9_sandveg_v4_frequency_v7_temporal_v10_falseReg_v' + inputVersion;

// Load the land cover classification image
var classification = ee.Image(root + inputFile);
print("Input file:", classification);
Map.addLayer (classification, vis, 'classification');

// Classification regions layer
var regions_img = ee.Image(1).clip(ee.FeatureCollection('users/dh-conciani/collection7/classification_regions/vector_v2'));

// MERIT DEM: Multi-Error-Removed Improved-Terrain data
var dem = ee.Image("MERIT/DEM/v1_0_3").select('dem').updateMask(regions_img);

// Calculates slope in degrees using the 4-connected neighbors of each pixel
var slope = ee.Terrain.slope(dem);  

// Convert slope from degrees to percentage and reproject to 10m
var slopePercent = slope.expression(
  'tan(3.141593/180 * degrees) * 100', {
    'degrees': slope
  })
  .resample('bicubic')
  .reproject({crs: 'EPSG:4674', scale: 10})  
  .rename('slope')
  .toInt16()
  
Map.addLayer(slopePercent, {min: 0, max: 100, palette: ["577590", "43aa8b", "90be6d", "f9c74f", "f8961e", "f3722c", "f94144"]}, 'Slope');

// Initialize an empty image to store the filtered classification data
var filtered = ee.Image([]);

// Loop through each year in the classification and apply the filter
ee.List.sequence({'start': 2017, 'end': 2024}).getInfo()
    .forEach(function(year) {
      
      // Select the classification for the current year
      var collection_i = classification.select(['classification_' + year]);
      
      // Create a kernel for neighborhood analysis (Manhattan distance, 35-pixel radius)
      var kernel = ee.Kernel.manhattan({'radius': 35, 'units': 'pixels'});
      
      // Apply the mode filter to get the most common land cover within the neighborhood
      var mode = collection_i.reduceNeighborhood({
        reducer: ee.Reducer.mode(),
        kernel: kernel
      }).reproject('EPSG:4674', null, 10);
      
      // Rule 1 — Wetland (11) with slope >= 12 → mode of neighborhood
      var collection_p = collection_i.blend(
        collection_i.where(collection_i.eq(11).and(slopePercent.gte(12)), 3)
      );
  
      // Rule 2 — Water (33) with slope >= 20 → class 3
      collection_p = collection_p.blend(
        collection_p.where(collection_p.eq(33).and(slopePercent.gte(20)), 3)
      );
      
      // Rule 3 — Mosaic of Uses (21) with slope >= 45 → class 12
      collection_p = collection_p.blend(
          collection_p.where(collection_p.eq(21).and(slopePercent.gte(40)), 12)
        );
    
      filtered = filtered.addBands(collection_p.updateMask(collection_p.neq(0)));
 
  });

Map.addLayer(filtered, vis, 'Filtered');

print('Output classification', filtered);

// Export to a GEE asset
Export.image.toAsset({
    'image': filtered,
    'description': inputFile + '_geom_v' + outputVersion,
    'assetId': root +  inputFile + '_geom_v' + outputVersion,
    'pyramidingPolicy': {
        '.default': 'mode'
    },
    'region':filtered.geometry(),
    'scale': 10,
    'maxPixels': 1e13
});
