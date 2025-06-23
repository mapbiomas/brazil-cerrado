// --- --- --- 08_spatial
// Apply spatial filter to remove small patches (minimum area filter)
// Author: barbara.silva@ipam.org.br

// Set input/output versions
var input_version = '4';
var output_version = '6';

// Define asset paths
var input = 'projects/ee-barbarasilvaipam/assets/collection-10_rocky-outcrop/post-classification/CERRADO_col9_rocky_gapfill_frequency_v' + input_version;
var dirout = 'projects/ee-barbarasilvaipam/assets/collection-10_rocky-outcrop/post-classification/';

// Load classification image
var classification = ee.Image(input);
print("Input classification", classification);

// Import MapBiomas color palette
var vis = {
  min: 0,
  max: 62,
  palette: require('users/mapbiomas/modules:Palettes.js').get('classification8')
};

// Display example year
Map.addLayer(classification.select('classification_2010'), vis, 'Input 2010');

// Initialize image for filtered result (round 1)
var filtered = ee.Image([]);

// Define minimum mappable area in number of pixels
var filter_size = 15;

// Apply first round of spatial filtering
ee.List.sequence(1985, 2024).getInfo().forEach(function(year_i) {
  
  // Calculate focal mode (majority in 10-pixel neighborhood)
  var focal_mode = classification.select('classification_' + year_i)
    .unmask(0)
    .focal_mode({radius: 10, kernelType: 'square', units: 'pixels'});

  // Calculate number of connected pixels in each patch
  var connections = classification.select('classification_' + year_i)
    .unmask(0)
    .connectedPixelCount({maxSize: 120, eightConnected: false});

  // Mask patches with fewer than the minimum required pixels
  var to_mask = focal_mode.updateMask(connections.lte(filter_size));

  // Replace small patches with neighborhood majority
  var classification_i = classification.select('classification_' + year_i)
    .blend(to_mask)
    .reproject('EPSG:4326', null, 30);

  // Add to filtered image stack
  filtered = filtered.addBands(classification_i.updateMask(classification_i.neq(0)));
});

// Display result of first round
Map.addLayer(filtered.select('classification_2010'), vis, 'Filtered 2010 - Round 1');

// Second round of filtering for stabilization
var recipe = ee.Image([]);

ee.List.sequence(1985, 2024).getInfo().forEach(function(year_i) {

  var focal_mode = filtered.select('classification_' + year_i)
    .unmask(0)
    .focal_mode({radius: 10, kernelType: 'square', units: 'pixels'});

  var connections = filtered.select('classification_' + year_i)
    .unmask(0)
    .connectedPixelCount({maxSize: 120, eightConnected: false});

  var to_mask = focal_mode.updateMask(connections.lte(filter_size));

  var classification_i = filtered.select('classification_' + year_i)
    .blend(to_mask)
    .reproject('EPSG:4326', null, 30);

  recipe = recipe.addBands(classification_i.updateMask(classification_i.neq(0)));
});

// Display result of second round
Map.addLayer(recipe.select('classification_2010'), vis, 'Filtered 2010 - Round 2');
print('Output (spatially filtered)', recipe);

// Export filtered image as GEE asset
Export.image.toAsset({
    'image': recipe,
    'description': 'CERRADO_C10_rocky_gapfill_frequency_spatial_v' + output_version,
    'assetId': dirout + 'CERRADO_C10_rocky_gapfill_frequency_spatial_v' + output_version,
    'pyramidingPolicy': {
        '.default': 'mode'
    },
    'region': classification.geometry(),
    'scale': 30,
    'maxPixels': 1e13
});
