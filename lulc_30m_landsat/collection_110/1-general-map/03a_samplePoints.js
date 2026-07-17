// -- -- -- -- 03a) Sample Points Generation
// Generates stratified random spatial points used for land-use and land-cover classification. 
// It dynamically calculates the optimal sample size per class for each ecoregion based on area 
// proportions (step 2) and distributes these points exclusively over stable pixels (step 1).
 
// Define isualization parameters
var vis = {
    min: 0,
    max: 75,
    palette:require('users/mapbiomas/modules:Palettes.js').get('brazil')
};

// Define the version string
var version = '13'; 

// Define the output directory
var output = 'projects/ee-ipam-cerrado/assets/Collection_11/sample/points/';

// Temporal periods configurations referencing outputs from scripts 01 and 02
var periods = [
  {
    name: '1985_1996',
    maskAsset: 'projects/ee-ipam-cerrado/assets/Collection_11/masks/cerrado_trainingMask_1985_1996_v9',
    areaAsset: 'projects/ee-ipam-cerrado/assets/Collection_11/sample/area/1985_1996_v6'
  },
  {
    name: '1994_2005',
    maskAsset: 'projects/ee-ipam-cerrado/assets/Collection_11/masks/cerrado_trainingMask_1994_2005_v9',
    areaAsset: 'projects/ee-ipam-cerrado/assets/Collection_11/sample/area/1994_2005_v6'
  },
  {
    name: '2003_2014',
    maskAsset: 'projects/ee-ipam-cerrado/assets/Collection_11/masks/cerrado_trainingMask_2003_2014_v9',
    areaAsset: 'projects/ee-ipam-cerrado/assets/Collection_11/sample/area/2003_2014_v6'
  },
  {
    name: '2012_2024',
    maskAsset: 'projects/ee-ipam-cerrado/assets/Collection_11/masks/cerrado_trainingMask_2012_2024_v9',
    areaAsset: 'projects/ee-ipam-cerrado/assets/Collection_11/sample/area/2012_2024_v6'
  }
];

// Define an array with the classes for sampling
var classes = [3, 4, 11, 12, 15, 18, 25, 33];

// Define sample size
var sampleSize = 4800;     // by region
var nSamplesMin = 480;     // minimum sample size by class

// Define a helper function to calculate the proportional sample size for a given class area dynamically
var computeSize = function(area, totalArea) {
  area = ee.Number(area);
  totalArea = ee.Number(totalArea);

  return ee.Number(
    ee.Algorithms.If(
      area.gt(0).and(totalArea.gt(0)),
      area.divide(totalArea)
          .multiply(sampleSize)
          .round()
          .max(nSamplesMin),
      0
    )
  ).int16();
};


// Iterative Processing over Temporal Windows
// Define a function to calculate sample sizes and generate points for a given region feature
periods.forEach(function(period) {
  print('Processing stratified points for period:', period.name);

  var trainingMask = ee.Image(period.maskAsset).rename('reference');
  var regionsCollection = ee.FeatureCollection(period.areaAsset);

  Map.addLayer(trainingMask, vis, 'Training Mask ' + period.name, false);

  var getTrainingSamples = function(feature) {
    // Extract the region identifier property from the current feature
    var regionId = feature.get('mapb');
    
    // Read the area for each class
    var forest       = ee.Number.parse(feature.get('3'));
    var savanna      = ee.Number.parse(feature.get('4'));
    var wetland      = ee.Number.parse(feature.get('11'));
    var grassland    = ee.Number.parse(feature.get('12'));
    var pasture      = ee.Number.parse(feature.get('15'));
    var agriculture  = ee.Number.parse(feature.get('18'));
    var nonVegetated = ee.Number.parse(feature.get('25'));
    var water        = ee.Number.parse(feature.get('33'));
    
  // Sum all individual class areas to compute the total area of the region
    var totalArea = forest.add(savanna)
                          .add(wetland)
                          .add(grassland)
                          .add(pasture)
                          .add(agriculture)
                          .add(nonVegetated)
                          .add(water);

    // Apply the equation to compute the number of samples for each class
    var nForest       = computeSize(forest, totalArea);
    var nSavanna      = computeSize(savanna, totalArea);
    var nWetland      = computeSize(wetland, totalArea);
    var nGrassland    = computeSize(grassland, totalArea);
    var nPasture      = computeSize(pasture, totalArea);
    var nAgriculture  = computeSize(agriculture, totalArea);
    var nNonVegetated = computeSize(nonVegetated, totalArea);
    var nWater        = computeSize(water, totalArea);
    
    // Extract the spatial geometry boundary of the current region feature
    var geometry = feature.geometry();
    var clippedMask = trainingMask.clip(geometry);
    
    // Generate a stratified random sample points
    var samples = clippedMask.stratifiedSample({
      scale: 30,
      classBand: 'reference',
      numPoints: 0,
      region: geometry,
      seed: 1,
      geometries: true,
      classValues: classes,
      classPoints: [nForest, nSavanna, nWetland, nGrassland, nPasture, nAgriculture, nNonVegetated, nWater]
    });

    
    // Map over the generated points to append the region id ('mapb') as a property
    return samples.map(function(f) {
      return f.set({'mapb': regionId, 'period': period.name, 'source': 'stratified'});
    });
  };
  
  // Apply the sampling function over all regions and merge the results
  var samplePoints = regionsCollection.map(getTrainingSamples).flatten();
  
  // Print diagnosis for each period
  print('Total stratified points ' + period.name, samplePoints.size());
 
  // Print diagnosis for each class
  print('forest ' + period, samplePoints.filterMetadata('reference', 'equals', 3).size());
  print('savanna ' + period, samplePoints.filterMetadata('reference', 'equals', 4).size());
  print('wetland ' + period, samplePoints.filterMetadata('reference', 'equals', 11).size());
  print('grassland ' + period, samplePoints.filterMetadata('reference', 'equals', 12).size());
  print('pasture ' + period, samplePoints.filterMetadata('reference', 'equals', 15).size());
  print('agriculture ' + period, samplePoints.filterMetadata('reference', 'equals', 18).size());
  print('nonVegetated ' + period, samplePoints.filterMetadata('reference', 'equals', 25).size());
  print('water ' + period, samplePoints.filterMetadata('reference', 'equals', 33).size());
 
  Map.addLayer(samplePoints, {}, 'Stratified Points ' + period.name, false);

  // Export as GEE asset
  Export.table.toAsset({
    collection: samplePoints,
    description: 'samplePoints_' + period.name + '_v' + version,
    assetId: output + 'samplePoints_' + period.name + '_v' + version
  });
});
