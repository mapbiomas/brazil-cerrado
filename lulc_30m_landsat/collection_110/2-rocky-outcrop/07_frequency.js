// --- --- --- 07) Frequency
// This script applies a highly restrictive temporal frequency filter to the 
// Rocky Outcrop class. Because rocky outcrops are stable geological features, 
// this filter assumes they should not change over a short time series. Pixels 
// classified as rocky outcrop for >= 99% of the time series are stabilized as 
// 29 across all years. Pixels failing this strict stability threshold 
// are forced to Class 99


// Define visualization parameters
var vis = {
  min: 1,
  max: 29,
  palette: [
    '#1f8d49','#d6bc74','#519799','#ffefc3','#d4271e','#2532e4',
    '#000000','#000000','#000000','#000000','#000000','#000000',
    '#000000','#723d46','#000000','#000000','#000000','#000000',
    '#000000','#000000','#000000','#000000','#000000','#000000',
    '#000000','#000000','#000000','#000000','#000000','#ffaa5f'
  ],
  bands: 'classification_2020'
};

// Define the input version string matching the gap-fill filter output
var input_version = '1';

// Define the output version string for the frequency-corrected asset
var output_version = '1';

// Define the base directory path 
var root = 'projects/ee-ipam/assets/MAPBIOMAS/LULC/CERRADO_DEV/COL_11/SENTINEL/C04-ROCKY-POST-CLASSIFICATION/';
var dirout = 'projects/ee-ipam/assets/MAPBIOMAS/LULC/CERRADO_DEV/COL_11/SENTINEL/C04-ROCKY-POST-CLASSIFICATION/';

// Construct the base name of the input file based on the previous workflow step
var inputFile = 'CERRADO_C04_rocky_gapfill_v' + input_version;

// Load the multi-band classification image
var classification = ee.Image(root + inputFile);

// Add the original input classification layer to the map
Map.addLayer(classification, vis, 'Input classification', false);

// Print the loaded input classification metadata to the console for inspection
print("Input classification", classification);

// Define the core function to calculate and apply the geological stability frequency filter
var filterFreq = function(image) {
  // Create a boolean stack where Class 29 is 1, and all other classes are 0
  var isRocky = image.eq(29);
  
  // Calculate the temporal frequency (%): mean of the boolean stack multiplied by 100
  // This automatically adapts to the number of bands (years) in the image
  var rockyFreq = isRocky.reduce(ee.Reducer.mean()).multiply(100).rename('frequency');
  
  // Render the frequency map to the display for visual diagnostics
  Map.addLayer(rockyFreq, 
    {min: 20, max: 70, palette: ['purple', 'red', 'orange', 'yellow', 'green', 'darkgreen']}, 
    'Frequency of Class 29', false);
  
  // Apply the strict geological stability threshold:
  // If frequency >= 99%, force the pixel to Class 29 (stable rocky outcrop)
  // If frequency < 99%, force the pixel to Class 99 (unstable/non-rocky placeholder)
  var filtered = ee.Image(0)
    .where(rockyFreq.gte(99), 29)
    .where(rockyFreq.lt(99), 99);
  
  // Self-mask to remove any absolute 0 values (though the logic above guarantees 29 or 99)
  filtered = filtered.updateMask(filtered.neq(0));

  // Overwrite the original multi-band image with the stabilized mask (applies to all years)
  return image.where(filtered, filtered);
};

// Apply the frequency stability filter to the entire time series
var classification_filtered = filterFreq(classification);

// Render the final, frequency-filtered classification map to the display
Map.addLayer(classification_filtered, {min: 29, max: 90, palette: ['#ffaa5f','#e5e5e5'], bands: 'classification_2020'}, 'Filtered classification');

// Print the resulting final filtered image structure to the console
print('Filtered classification', classification_filtered);

// Export as GEE asset
Export.image.toAsset({
    'image': classification_filtered,
    'description': 'CERRADO_C04_rocky_gapfill_frequency_v' + output_version,
    'assetId': dirout + 'CERRADO_C04_rocky_gapfill_frequency_v' + output_version,
    'pyramidingPolicy': {
        '.default': 'mode'
    },
    'region': classification.geometry(),
    'scale': 10,
    'maxPixels': 1e13
});

