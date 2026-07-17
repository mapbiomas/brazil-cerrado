// -- -- -- -- 03a) Sample Points Generation
// Generates stratified random spatial points used for land-use and land-cover classification. 
// It dynamically calculates the optimal sample size per class for each ecoregion based on area 
// proportions (step 2) and distributes these points exclusively over stable pixels (step 1).

// Visualization parameters
var vis = {
    min: 0,
    max: 62,
    palette:require('users/mapbiomas/modules:Palettes.js').get('classification8')
};

// Define the version string
var version = '3'; 

// Define the output directory
var output = 'projects/ee-ipam-cerrado/assets/Collection_04/sample/points/';

// Define an array with the classes for sampling
var classes = [3, 4, 11, 12, 15, 18, 25, 33];

// Define sample size
var sampleSize = 4800;     // by region
var nSamplesMin = 480;     // minimum sample size by class

// Load the stable pixels training mask (from Step 1)
var trainingMask = ee.Image('projects/ee-ipam-cerrado/assets/Collection_04/masks/cerrado_trainingMask_2017_2025_v1')
                      .rename('reference');

// Load the feature collection containing the area computed per class per region (from Step 2)
var regionsCollection = ee.FeatureCollection('projects/ee-ipam-cerrado/assets/Collection_04/sample/area/2020_v1');

// Add the training mask to the map display for visual validation
Map.addLayer(trainingMask, vis, 'trainingMask', true);

// Define a function to calculate sample sizes and generate points for a given region feature
var getTrainingSamples = function (feature) {
  
  // Extract the region identifier property from the current feature
  var region_i = feature.get('mapb');
  
  // Read the area for each class
  var forest = ee.Number.parse(feature.get('3'));
  var savanna = ee.Number.parse(feature.get('4'));
  var wetland = ee.Number.parse(feature.get('11'));
  var grassland = ee.Number.parse(feature.get('12'));
  var pasture = ee.Number.parse(feature.get('15'));
  var agriculture = ee.Number.parse(feature.get('18'));
  var non_vegetated = ee.Number.parse(feature.get('25'));
  var water = ee.Number.parse(feature.get('33'));

  // Sum all individual class areas to compute the total area of the region
  var total = forest
              .add(savanna)
              .add(wetland)
              .add(grassland)
              .add(pasture)
              .add(agriculture)
              .add(non_vegetated)
              .add(water);
              
  // Define a helper function to calculate the proportional sample size for a given class area
  var computeSize = function (number) {
    return number.divide(total).multiply(sampleSize).round().int16().max(nSamplesMin);
  };
  
  // Apply the equation to compute the number of samples for each class
  var n_forest = computeSize(ee.Number(forest));
  var n_savanna = computeSize(ee.Number(savanna));
  var n_wetland = computeSize(ee.Number(wetland));
  var n_grassland = computeSize(ee.Number(grassland));
  var n_pasture = computeSize(ee.Number(pasture));
  var n_agriculture = computeSize(ee.Number(agriculture));
  var n_non_vegetated = computeSize(ee.Number(non_vegetated));
  var n_water = computeSize(ee.Number(water));

  // Extract the spatial geometry boundary of the current region feature
  var region_i_geometry = ee.Feature(feature).geometry();
  
  // Clip the stable pixels reference mask to the boundary of the current region
  var referenceMap =  trainingMask.clip(region_i_geometry);
                      
  // Generate a stratified random sample points
  var training = referenceMap.stratifiedSample(
                            {'scale': 10,
                             'classBand': 'reference', 
                             'numPoints': 0,
                             'region': feature.geometry(),
                             'seed': 1,
                             'geometries': true,
                             'classValues': classes,
                             'classPoints': [n_forest, n_savanna, n_wetland, n_grassland, n_pasture,
                                             n_agriculture, n_non_vegetated, n_water]
                              }
                            );
  
  // Map over the generated points to append the region id ('mapb') as a property
  training = training.map(function(doneFeature) {
                return doneFeature.set({'mapb': region_i});
              });
              
  // Return the fully processed feature collection of sample points
  return training;
 };

// Apply the sampling function over all regions and merge the results
var samplePoints = regionsCollection.map(getTrainingSamples).flatten();
print ('Total samplePoints:', samplePoints.size());

// Add the final sample points collection to the map for visual inspection
Map.addLayer(samplePoints, vis, 'samplePoints');

// Print diagnosis for each class
print('forest', samplePoints.filterMetadata('reference', 'equals', 3).size());
print('savanna', samplePoints.filterMetadata('reference', 'equals', 4).size());
print('wetland', samplePoints.filterMetadata('reference', 'equals', 11).size());
print('grassland', samplePoints.filterMetadata('reference', 'equals', 12).size());
print('agriculture', samplePoints.filterMetadata('reference', 'equals', 18).size());
print('non_vegetated', samplePoints.filterMetadata('reference', 'equals', 25).size());
print('water', samplePoints.filterMetadata('reference', 'equals', 33).size());

// Export as GEE asset
Export.table.toAsset({'collection': samplePoints,
                      'description': 'samplePoints_v' + version,
                      'assetId':  output + 'samplePoints_v' + version
                      }
                    );
