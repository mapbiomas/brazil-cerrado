// -- -- -- -- 03) Sample Points Generation
// This script generates stratified random spatial points for training the Rocky 
// Outcrop classification model. It dynamically calculates the sample size per 
// broad LULC class based on area proportions (computed in Step 02) within the AOI. 
// Finally, it merges these automated samples with the manually curated Rocky 
// Outcrop sample collection to create the unified training dataset.

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

// Define the output directory path 
var output = 'projects/ee-barbarasilvaipam/assets/collection-11_rocky-outcrop/sample/points/';

// Define the target total number of automated samples to be distributed across the AOI
var sampleSize = 4800;    

// Define an array with the numeric values of the stable target classes for sampling
var classes = [1, 2, 3, 4, 5];

// Load the feature collection containing the computed area proportions (from Step 2)
var file_in = ee.FeatureCollection('projects/ee-barbarasilvaipam/assets/collection-11_rocky-outcrop/sample/area/stable_v'+input_version);

// Load the Area of Interest (AOI)
var aoi_vec = ee.FeatureCollection('projects/ee-barbarasilvaipam/assets/collection-11_rocky-outcrop/masks/aoi_v1').geometry();

// Convert the AOI geometry into a binary image mask
var aoi_img = ee.Image(1).clip(aoi_vec);

// Load the stable pixels mask from Collection 10.1 (from Step 1)
var stablePixels = ee.Image('projects/ee-barbarasilvaipam/assets/collection-11_rocky-outcrop/masks/cerrado_rockyTrainingMask_1985_2024_v3').rename('class');

// Load the manually Rocky Outcrop samples
var rocky_samples = ee.FeatureCollection('projects/ee-barbarasilvaipam/assets/collection-11_rocky-outcrop/C11_rocky-outcrop-collected-v1')
  // Map over the features to append the official MapBiomas class ID (29) and retain only that property
  .map(function(feature) {
    return feature.set({'class': '29'}).select(['class']);
  });
  
// Render the Area of Interest to the map display
Map.addLayer(aoi_img, {palette: ['red']}, 'Area of Interest');

// Render the loaded stable pixels image to the map
Map.addLayer(stablePixels, vis, 'Stable Pixels');

// Read the area for each class (from Step 2)
var forest = ee.Number(file_in.first().get('1'));
var grassland = ee.Number(file_in.first().get('2'));
var water = ee.Number(file_in.first().get('3'));
var farming = ee.Number(file_in.first().get('4'));
var nonvegetated = ee.Number(file_in.first().get('5'));

// Sum the individual areas to calculate the total valid stable area within the AOI
var total = forest
          .add(water)
          .add(grassland)
          .add(farming)
          .add(nonvegetated);

// Define a helper function to compute the proportional sample size for a given class
var computeSize = function (number) {
  // Set a minimum threshold guaranteeing that each class gets at least 2% of the total sample pool
  var minSamples = sampleSize * 0.02;
  // Divide class area by total area, multiply by the base sample size, round, and apply the minimum threshold
  return number.divide(total).multiply(sampleSize).round().int16().max(minSamples);
};

// Calculate the final target number of samples for each class
var n_forest = computeSize(ee.Number(forest));
var n_water = computeSize(ee.Number(water));
var n_grassland = computeSize(ee.Number(grassland));
var n_farming = computeSize(ee.Number(farming));
var n_nonvegetated = computeSize(ee.Number(nonvegetated));

// Generate a stratified random sample of points based on the computed class allocations
var training = stablePixels.stratifiedSample({
                           'scale': 30,
                           'classBand': 'class', 
                           'numPoints': 0,
                           'region': aoi_img.geometry(),
                           'seed': 1,
                           'geometries': true,
                           'classValues': classes,
                           'classPoints': [n_forest, n_water, n_grassland, n_farming, n_nonvegetated]
                          });

// Merge the newly generated automated samples with the manually collected Rocky Outcrop samples
training = ee.FeatureCollection(training).merge(rocky_samples);

// Map over the merged collection to ensure the 'class' property is strictly stored as a numeric integer (not string)
var trainingSamplesFixed = training.map(function(feature) {
  // Parse the class attribute string into a numeric Earth Engine Number
  var classValue = ee.Number.parse(feature.get('class'));
  // Overwrite the property with the numeric value
  return feature.set('class', classValue);
});

// Render the final unified sample points to the map display
Map.addLayer(trainingSamplesFixed, {}, 'Sample Points');

// Print the total size of the final merged training collection to the console
print("Total training samples generated:", trainingSamplesFixed.size());

// Print diagnosis for each class
print('forest', trainingSamplesFixed.filterMetadata('class', 'equals', 1).size());
print('grassland', trainingSamplesFixed.filterMetadata('class', 'equals', 2).size());
print('water', trainingSamplesFixed.filterMetadata('class', 'equals', 3).size());
print('farming', trainingSamplesFixed.filterMetadata('class', 'equals', 4).size());
print('nonvegetated', trainingSamplesFixed.filterMetadata('class', 'equals', 5).size());
print('rocky', trainingSamplesFixed.filterMetadata('class', 'equals', 29).size());

// Export as GEE asset
Export.table.toAsset({'collection': trainingSamplesFixed,
                      'description': 'samplePoints_v' + output_version,
                      'assetId':  output + 'samplePoints_v' + output_version
                      }
                    );

