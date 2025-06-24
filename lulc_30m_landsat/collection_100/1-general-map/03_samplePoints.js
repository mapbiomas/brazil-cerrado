// --- --- --- 03_samplePoints
/* Generate spatially stratified training points per region based on stable pixels
This script generates spatially stratified sample points by ecoregion using stable pixels from MapBiomas Collection 9.0. 
It allocates samples proportionally to the area of each land cover class per region, while enforcing a minimum number of samples per class.
*/
// Author: barbara.silva@ipam.org.br

// Define output path and version
var version = '1';
var output = 'projects/mapbiomas-workspace/COLECAO_DEV/COLECAO10_DEV/CERRADO/LANDSAT/sample/points/';

// Target classes for sampling
var classes = [3, 4, 11, 12, 15, 18, 25, 33];

// Sampling configuration
var sampleSize = 4800;   // Total points per region
var nSamplesMin = 480;   // Minimum points per class

// Load stable pixel mask (generated in step 01)
var trainingMask = ee.Image('projects/mapbiomas-workspace/COLECAO_DEV/COLECAO10_DEV/CERRADO/LANDSAT/masks/cerrado_trainingMask_1985_2023_v1')
                   .rename('reference');

// Load class area table per region (from step 02)
var regionsCollection = ee.FeatureCollection('projects/mapbiomas-workspace/COLECAO_DEV/COLECAO10_DEV/CERRADO/LANDSAT/sample/area/2005_v1');

// MapBiomas color palette for visualization
var vis = {
  min: 0,
  max: 62,
  palette: require('users/mapbiomas/modules:Palettes.js').get('classification8')
};

// Plot stable pixels
Map.addLayer(trainingMask, vis, 'Training Mask');

// Function to generate stratified points per region
var getTrainingSamples = function (feature) {
  var regionId = feature.get('mapb');

  // Read per-class areas
  var forest        = ee.Number.parse(feature.get('3'));
  var savanna       = ee.Number.parse(feature.get('4'));
  var wetland       = ee.Number.parse(feature.get('11'));
  var grassland     = ee.Number.parse(feature.get('12'));
  var pasture       = ee.Number.parse(feature.get('15'));
  var agriculture   = ee.Number.parse(feature.get('18'));
  var nonVegetated  = ee.Number.parse(feature.get('25'));
  var water         = ee.Number.parse(feature.get('33'));

  // Compute total area in region
  var totalArea = forest.add(savanna)
                        .add(wetland)
                        .add(grassland)
                        .add(pasture)
                        .add(agriculture)
                        .add(nonVegetated)
                        .add(water);

  // Function to compute proportional sample size per class
  var computeSize = function(area) {
    return area.divide(totalArea)
               .multiply(sampleSize)
               .round()
               .int16()
               .max(nSamplesMin);
  };

  // Calculate per-class sample size
  var nForest        = computeSize(forest);
  var nSavanna       = computeSize(savanna);
  var nWetland       = computeSize(wetland);
  var nGrassland     = computeSize(grassland);
  var nPasture       = computeSize(pasture);
  var nAgriculture   = computeSize(agriculture);
  var nNonVegetated  = computeSize(nonVegetated);
  var nWater         = computeSize(water);

  // Get region geometry and clip training mask
  var geometry = feature.geometry();
  var clippedMask = trainingMask.clip(geometry);

  // Perform stratified sampling
  var samples = clippedMask.stratifiedSample({
    scale: 30,
    classBand: 'reference',
    numPoints: 0,  // will use classPoints instead
    region: geometry,
    seed: 1,
    geometries: true,
    classValues: classes,
    classPoints: [
      nForest, nSavanna, nWetland, nGrassland, nPasture,
      nAgriculture, nNonVegetated, nWater
    ]
  });

  // Attach region ID as property
  return samples.map(function(f) {
    return f.set({'mapb': regionId});
  });
};

// Generate and merge all points
var samplePoints = regionsCollection.map(getTrainingSamples).flatten();

print('Total sample points:', samplePoints.size());

// Plot samples
Map.addLayer(samplePoints, {}, 'Sample Points');

// Class-level diagnostics
print('forest', samplePoints.filterMetadata('reference', 'equals', 3).size());
print('savanna', samplePoints.filterMetadata('reference', 'equals', 4).size());
print('wetland', samplePoints.filterMetadata('reference', 'equals', 11).size());
print('grassland', samplePoints.filterMetadata('reference', 'equals', 12).size());
print('agriculture', samplePoints.filterMetadata('reference', 'equals', 18).size());

// Export as GEE Asset
Export.table.toAsset({
  collection: samplePoints,
  description: 'samplePoints_v' + version,
  assetId: output + 'samplePoints_v' + version
});
