// -- -- -- -- 02) Compute Area Proportion 
// This script computes the total area for each LULC class within the stable 
// pixels mask. The calculated proportions serve as a reference to distribute 
// and estimate the number of training samples required for the Rocky Outcrop 
// classification model.

// Define visualization parameters 
var vis = {
  min: 1,
  max: 29,
  palette: [
    '#1f8d49','#d6bc74','#ffefc3','#d4271e','#2532e4','#000000',
    '#000000','#000000','#000000','#000000','#000000','#000000',
    '#000000','#000000','#000000','#000000','#000000','#000000',
    '#000000','#000000','#000000','#000000','#000000','#000000',
    '#000000','#000000','#000000','#000000','#000000','#ffaa5f'
  ],
};

// Define the output version
var output_version = '3';

// Define the input version
var input_version = '3';

// Define an array with the numeric values of the classes to be assessed
var classes = [1, 2, 3, 4, 5, 29];

// Define the base output directory path for the area table asset
var dirout = 'projects/ee-barbarasilvaipam/assets/collection-11_rocky-outcrop/sample/area/';

// Load the Area of Interest (AOI) 
var aoi_vec = ee.FeatureCollection('projects/ee-barbarasilvaipam/assets/collection-11_rocky-outcrop/masks/aoi_v1');

// Convert the AOI feature into a binary image mask 
var aoi_img = ee.Image(1).clip(aoi_vec);

// Add the AOI binary mask to the map
Map.addLayer(aoi_img, {palette: ['red']}, 'Area of Interest', false);

// Load the stable pixels training mask generated in the previous step
var stable = ee.Image('projects/ee-barbarasilvaipam/assets/collection-11_rocky-outcrop/masks/cerrado_rockyTrainingMask_1985_2024_v' + input_version);

// Compute a frequency histogram of the stable pixels within the AOI to evaluate class distribution
var pixel_values = stable.reduceRegion({ 
                    reducer: ee.Reducer.frequencyHistogram(), 
                    geometry: aoi_vec.geometry(), 
                    scale: 30, 
                    maxPixels: 1e14 });

// Print the calculated frequency histogram to the console
print('Stable pixels Histogram:', pixel_values);

// Render the loaded stable pixels image to the map display
Map.addLayer(stable, vis, 'Stable pixels');

// Print the stable pixels image metadata to the console
print('Stable pixels', stable);

// Create an image representing the area of each pixel in square kilometers (km²)
var pixelArea = ee.Image.pixelArea().divide(1000000);

// Define a function to calculate the area of each target class for a given region feature
var getArea = function(feature) {
  // Clip the stable pixels image to the boundary of the current feature
  var mapbiomas_i = stable.clip(feature);
  
  // Iterate over each predefined class value to compute its specific area
  classes.forEach(function(class_j) {
    // Mask the pixel area image to retain only pixels matching the current target class
    var reference_ij = pixelArea.mask(mapbiomas_i.eq(class_j));
    
    // Reduce the masked area image to calculate the total sum within the feature geometry
    var area = ee.Number(reference_ij.reduceRegion({
      reducer: ee.Reducer.sum(),
      geometry: feature.geometry(),
      scale: 30,
      maxPixels: 1e13,
      tileScale: 4
    // Extract the numeric area value, scale it, round it, and descale to preserve 4 decimal places
    }).get('area')).multiply(10000).round().divide(10000);
    
    // Add the calculated class area as a new property to the feature, keyed by the class ID string
    feature = feature.set(String(class_j), area);
  });
  
  // Return the fully updated feature containing the area properties
  return feature;
};

// Map the area calculation function over the AOI feature collection
var computed_obj = aoi_vec.map(getArea);

// Print the final feature collection containing the computed areas to the console
print('Result:', computed_obj);

// Export as GEE asset
Export.table.toAsset({
  'collection': computed_obj, 
  'description': 'stable_v' + output_version,
  'assetId': dirout + 'stable_v' + output_version
});
