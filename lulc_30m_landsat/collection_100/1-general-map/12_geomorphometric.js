// -- -- -- -- 12_geomorphometric
// Applies a geomorphological filter to remove areas classified as wetlands (class 11) that occur in regions with a 
// slope greater than 9% (approximately >5°), using data from the MERIT DEM.

// Author: barbara.silva@ipam.org.br

// Import MapBiomas color palette
var vis = {
    min: 0,
    max: 62,
    palette:require('users/mapbiomas/modules:Palettes.js').get('classification8'),
    bands: 'classification_1985'
};

// Set root directory 
var root = 'projects/mapbiomas-workspace/COLECAO_DEV/COLECAO10_DEV/CERRADO/LANDSAT/C10-POST-CLASSIFICATION/';
var out = 'projects/mapbiomas-workspace/COLECAO_DEV/COLECAO10_DEV/CERRADO/LANDSAT/C10-POST-CLASSIFICATION/';

// Define input/output metadata
var inputVersion = '29';
var outputVersion = '11';

// Define input file 
var inputFile = 'CERRADO_C10_gapfill_v11_incidence_v4_sandVeg_v3_freq_v7_temp_v16_falseReg_v' + inputVersion;

// Load classification image
var classificationInput = ee.Image(root + inputFile);
print('Input classification', classificationInput);
Map.addLayer(classificationInput, vis, 'Input classification');

// Load classification regions (mask for slope calculation)
var regions_img = ee.Image(1).clip(ee.FeatureCollection('users/dh-conciani/collection7/classification_regions/vector_v2'));

// Load MERIT DEM data
var dem = ee.Image("MERIT/DEM/v1_0_3").select('dem').updateMask(regions_img);

// Calculates slope in degrees using the 4-connected neighbors of each pixel
var slope = ee.Terrain.slope(dem);  

// Calculate slope in percent
var slopePercent = slope.expression(
  'tan(3.141593/180 * degrees)*100', {
    'tan': slope.tan(),
    'degrees': slope
  }).rename('slope').toInt16();
  
Map.addLayer(slopePercent, {
  min: 0,
  max: 15,
  palette: ["577590", "43aa8b", "90be6d", "f9c74f", "f8961e", "f3722c", "f94144"]
}, 'Slope');

// Initialize empty image to store filtered classification
var filtered = ee.Image([]);

// Iterate through each year (1985 to 2024) and apply filter
// Replace wetlands on steep slopes with neighborhood mode
ee.List.sequence({'start': 1985, 'end': 2024}).getInfo()
    .forEach(function(year) {
      
      var collection_i = classificationInput.select(['classification_' + year]);
      
      // Define kernel for neighborhood analysis (Manhattan distance, radius = 8 pixels)
      var kernel = ee.Kernel.manhattan({'radius': 8, 'units': 'pixels'});
      
      // Calculate neighborhood mode for smoothing
      var mode = collection_i.reduceNeighborhood({
        reducer: ee.Reducer.mode(),
        kernel: kernel
      }).reproject('EPSG:4674', null, 30);
      
      // Replace wetlands (class 11) on steep slopes (>= 9%) with mode
      var collection_p = collection_i.blend(collection_i.where(collection_i.eq(11).and(slopePercent.gte(9)), mode));

      filtered = filtered.addBands(collection_p.updateMask(collection_p.neq(0)));
 
  });

Map.addLayer(filtered, vis, 'Output classification');
print('Output classification', filtered);

// Export as GEE asset
Export.image.toAsset({
    'image': filtered,
    'description': inputFile + '_geo_v' + outputVersion,
    'assetId': out +  inputFile + '_geo_v' + outputVersion,
    'pyramidingPolicy': {
        '.default': 'mode'
    },
    'region':filtered.geometry(),
    'scale': 30,
    'maxPixels': 1e13
});
