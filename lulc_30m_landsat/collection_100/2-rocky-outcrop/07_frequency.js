// --- --- --- 07_frequency
// Apply a frequency filter to reinforce stable rocky outcrop areas
// Description: This script applies a temporal frequency filter to the classification series (1985–2024),
// marking as rocky outcrop (class 29) only the pixels where class 29 appears in at least 90% of the years. 

// Author: barbara.silva@ipam.org.br

// Set input/output versions
var input_version = '4';
var output_version = '4';

// Set asset paths
var input = 'projects/ee-barbarasilvaipam/assets/collection-10_rocky-outcrop/post-classification/CERRADO_C10_rocky_gapfill_v' + input_version;
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

// Function to calculate frequency of class 29 (rocky outcrop)
var filterFreq = function(image) {
  // Calculate frequency as a percentage of years classified as rocky outcrop (29)
  var rocky = image.eq(29).expression(
    '100 * ((b(0)+b(1)+b(2)+b(3)+b(4)+b(5)+b(6)+b(7)+b(8)+b(9)+b(10)' +
    '+b(11)+b(12)+b(13)+b(14)+b(15)+b(16)+b(17)+b(18)+b(19)+b(20)' +
    '+b(21)+b(22)+b(23)+b(24)+b(25)+b(26)+b(27)+b(28)+b(29)+b(30)' +
    '+b(31)+b(32)+b(33)+b(34)+b(35)+b(36)+b(37)+b(38)+b(39)) / 40)'
  );

  // Visualize rocky frequency map
  Map.addLayer(rocky, {
    palette: ['purple', 'red', 'orange', 'yellow', 'green', 'darkgreen'],
    min: 20,
    max: 70
  }, 'Rocky Frequency');

  // Create a mask for stable rocky outcrop pixels (>= 90%)
  var filtered = ee.Image(0)
    .where(rocky.gte(90), 29)  // keep rocky outcrop
    .where(rocky.lt(90), 99);  // mark as to be ignored

  filtered = filtered.updateMask(filtered.neq(0));

  // Replace original values with filtered ones where condition is met
  return image.where(filtered, filtered);
};

// Apply frequency filter
var classification_filtered = filterFreq(classification);

// Visual comparison: before and after filter
Map.addLayer(classification.select('classification_2021'), vis, 'Original 2021');
Map.addLayer(classification_filtered.select('classification_2021'), vis, 'Filtered 2021');
print('Output classification (filtered)', classification_filtered);

// Display training points
var trainings = ee.FeatureCollection("projects/ee-barbarasilvaipam/assets/collection-10_rocky-outcrop/C10_rocky-outcrop-collected-v3");
Map.addLayer(trainings, {}, 'Training Samples');

// Export filtered classification as GEE asset
Export.image.toAsset({
  image: classification_filtered,
  description: 'CERRADO_col9_rocky_gapfill_frequency_v' + output_version,
  assetId: dirout + 'CERRADO_col9_rocky_gapfill_frequency_v' + output_version,
  pyramidingPolicy: { '.default': 'mode' },
  region: classification.geometry(),
  scale: 30,
  maxPixels: 1e13
});
