// -- -- -- -- 03_samplePoints
// sort stratified spatialPoints by region using stable pixels
// dhemerson.costa@ipam.org.br and barbara.silva@ipam.org.br

// Define string to use as metadata
var version = '4';  // label string

// Define output
var output = 'users/dh-conciani/collection9/sample/points/';

// Define classes to generate samples
var classes = [3, 4, 11, 12, 15, 18, 25, 33];

// Define sample size
var sampleSize = 7000;     // by region
var nSamplesMin = 700;     // minimum sample size by class

// Get trainingMask (generated by step 1)
var trainingMask = ee.Image('users/dh-conciani/collection9/masks/cerrado_trainingMask_1985_2022_v4')
  .rename('reference');

// Get class area per region (generated by step 2)
var regionsCollection = ee.FeatureCollection('users/dh-conciani/collection9/sample/area/2005_v1');

// Import mapbiomas color schema 
var vis = {
    min: 0,
    max: 62,
    palette:require('users/mapbiomas/modules:Palettes.js').get('classification8')
};

// Plot stable pixels
Map.addLayer(trainingMask, vis, 'trainingMask', true);

// Define function to get trainng samples
var getTrainingSamples = function (feature) {
  
  // For each region 
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

  // Compute the total area 
  var total = forest
              .add(savanna)
              .add(wetland)
              .add(grassland)
              .add(pasture)
              .add(agriculture)
              .add(non_vegetated)
              .add(water);
              
  // Define the equation to compute the n of samples
  var computeSize = function (number) {
    return number.divide(total).multiply(sampleSize).round().int16().max(nSamplesMin);
  };
  
  // Apply the equation to compute the number of samples
  var n_forest = computeSize(ee.Number(forest));
  var n_savanna = computeSize(ee.Number(savanna));
  var n_wetland = computeSize(ee.Number(wetland));
  var n_grassland = computeSize(ee.Number(grassland));
  var n_pasture = computeSize(ee.Number(pasture));
  var n_agriculture = computeSize(ee.Number(agriculture));
  var n_non_vegetated = computeSize(ee.Number(non_vegetated));
  var n_water = computeSize(ee.Number(water));

  // Get the geometry of the regionclass
  var region_i_geometry = ee.Feature(feature).geometry();
  
  // Clip stablePixels only to the region 
  var referenceMap =  trainingMask.clip(region_i_geometry);
                      
  // Generate the sample points
  var training = referenceMap.stratifiedSample(
                            {'scale': 30,
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
  
  // Insert the region_id as metadata
  training = training.map(function(doneFeature) {
                return doneFeature.set({'mapb': region_i});
              });
    
  return training;
 };

// Apply function and get sample points
var samplePoints = regionsCollection.map(getTrainingSamples)
                                    .flatten(); // flatten all regions
print ('samplePoints', samplePoints.first())

// Plot points
Map.addLayer(samplePoints, vis, 'samplePoints');

// Print diagnosis for each class
print('forest', samplePoints.filterMetadata('reference', 'equals', 3).size());
print('savanna', samplePoints.filterMetadata('reference', 'equals', 4).size());
print('wetland', samplePoints.filterMetadata('reference', 'equals', 11).size());
print('grassland', samplePoints.filterMetadata('reference', 'equals', 12).size());
print('agriculture', samplePoints.filterMetadata('reference', 'equals', 19).size());

// Export as GEE asset
Export.table.toAsset({'collection': samplePoints,
                      'description': 'samplePoints_v' + version,
                      'assetId':  output + 'samplePoints_v' + version
                      }
                    );