// --- --- --- 03_samplePoints
// Generate stratified sample points using stable pixels and class proportions
// Description: This script generates stratified random sample points by land cover class using stable pixels as reference. 
// It uses class area proportions to determine sample size and merges the resulting points with pre-collected rocky outcrop samples. 

// Author: barbara.silva@ipam.org.br

// Set script version
var version = '4';

// Load reference area proportions (computed previously)
var file_in = ee.FeatureCollection(
  'projects/ee-barbarasilvaipam/assets/collection-10_rocky-outcrop/sample/area/stable_v4'
);

// Load Area of Interest (AOI)
var aoi_vec = ee.FeatureCollection(
  'projects/ee-barbarasilvaipam/assets/collection-10_rocky-outcrop/masks/aoi_v4'
).geometry();
var aoi_img = ee.Image(1).clip(aoi_vec);
Map.addLayer(aoi_img, {palette: ['red']}, 'Area of Interest');

// Define output path
var output = 'projects/ee-barbarasilvaipam/assets/collection-10_rocky-outcrop/sample/points/';

// Define land cover classes for sample generation
var classes = [1, 2, 3, 4];

// Load rocky outcrop samples and assign class value 29
var rocky_samples = ee.FeatureCollection(
  'projects/ee-barbarasilvaipam/assets/collection-10_rocky-outcrop/C10_rocky-outcrop-collected-v3'
).map(function(feature) {
  return feature.set({'class': '29'}).select(['class']);
});

// Set desired total sample size and minimum for rocky outcrop
var sampleSize = 4480;
var nSamplesMin = rocky_samples.size().round();

// Load stable pixels classified by class
var stablePixels = ee.Image(
  'projects/ee-barbarasilvaipam/assets/collection-10_rocky-outcrop/masks/cerrado_rockyTrainingMask_1985_2023_v4'
).rename('class');

// Load Cerrado biome mask
var regionsCollection = ee.FeatureCollection(
  'projects/mapbiomas-workspace/AUXILIAR/biomas-2019'
).filterMetadata('Bioma', 'equals', 'Cerrado');

// Visualize stable pixels
var vis = {
  min: 1,
  max: 29,
  palette: ["32a65e", "FFFFB2", "2532e4", "ffaa5f"]
};
Map.addLayer(stablePixels, vis, 'Stable Pixels');

// Extract area (km²) per class from input reference
var vegetation = ee.Number(file_in.first().get('1'));
var water = ee.Number(file_in.first().get('2'));
var grassland = ee.Number(file_in.first().get('3'));
var nonvegetation = ee.Number(file_in.first().get('4'));

// Compute total area of all classes
var total = vegetation
  .add(water)
  .add(grassland)
  .add(nonvegetation);

// Function to compute sample size based on area proportion
var computeSize = function(area) {
  return area.divide(total).multiply(sampleSize).round().int16().max(nSamplesMin);
};

// Compute number of samples per class
var n_vegetation = computeSize(vegetation);
var n_water = computeSize(water);
var n_grassland = computeSize(grassland);
var n_nonvegetation = computeSize(nonvegetation);

// Generate stratified sample points
var training = stablePixels.stratifiedSample({
  scale: 30,
  classBand: 'class',
  numPoints: 0,
  region: aoi_img.geometry(),
  seed: 1,
  geometries: true,
  classValues: classes,
  classPoints: [n_vegetation, n_water, n_grassland, n_nonvegetation]
});

// Merge stratified samples with rocky outcrop samples
training = ee.FeatureCollection(training).merge(rocky_samples);

// Convert class values to integer type
var trainingSamplesFixed = training.map(function(feature) {
  var classValue = ee.Number.parse(feature.get('class'));
  return feature.set('class', classValue);
});

// Visualize and validate output
Map.addLayer(trainingSamplesFixed, {}, 'Sample Points');
print('Total Sample Points:', trainingSamplesFixed.size());
print('Vegetation:', trainingSamplesFixed.filterMetadata('class', 'equals', 1).size());
print('Water:', trainingSamplesFixed.filterMetadata('class', 'equals', 2).size());
print('Grassland:', trainingSamplesFixed.filterMetadata('class', 'equals', 3).size());
print('Non-vegetation:', trainingSamplesFixed.filterMetadata('class', 'equals', 4).size());
print('Rocky Outcrop:', trainingSamplesFixed.filterMetadata('class', 'equals', 29).size());

// Export the final sample points as GEE asset
Export.table.toAsset({
  collection: trainingSamplesFixed,
  description: 'samplePoints_v' + version,
  assetId: output + 'samplePoints_v' + version
});
