// -- -- -- -- 03b) Complementary Sample Points Generation
// This script merges the automated stratified sample points (generated in Step 3a)
// with complementary samples collected manually and stored as GEE assets.

// Define the input version for the automated samples
var inputVersion = '13';

// Define the output version for the final samples
var outputVersion = '14';

// Define the output directory
var output = 'projects/ee-ipam-cerrado/assets/Collection_11/sample/points/';

// Load the Cerrado classification regions feature collection to extract region IDs
var regionsCollection = ee.FeatureCollection("projects/ee-ipam-cerrado/assets/ancillary/collection_11_classification_regions_vector");

var periods = ['1985_1996', '1994_2005', '2003_2014', '2012_2024'];

// Load Complementary Sample Assets
var manualPoints = ee.FeatureCollection('projects/ee-ipam-cerrado/assets/Collection_11/sample/manual/comp_samples_agriculture')
  .merge(ee.FeatureCollection("projects/ee-ipam-cerrado/assets/Collection_11/sample/manual/comp_samples_forest"))
  .merge(ee.FeatureCollection("projects/ee-ipam-cerrado/assets/Collection_11/sample/manual/comp_samples_grassland"))
  .merge(ee.FeatureCollection("projects/ee-ipam-cerrado/assets/Collection_11/sample/manual/comp_samples_nonveg"))
  .merge(ee.FeatureCollection("projects/ee-ipam-cerrado/assets/Collection_11/sample/manual/comp_samples_savanna"))
  .merge(ee.FeatureCollection("projects/ee-ipam-cerrado/assets/Collection_11/sample/manual/comp_samples_pasture"))
  .merge(ee.FeatureCollection("projects/ee-ipam-cerrado/assets/Collection_11/sample/manual/comp_samples_wetland"))
  .merge(ee.FeatureCollection("projects/ee-ipam-cerrado/assets/Collection_11/sample/manual/comp_samples_water"));
  
// Load known error points 
var bad_points_fc = ee.FeatureCollection('projects/ee-ipam-cerrado/assets/Collection_11/sample/manual/points_to_remove');
var bad_points_buffered = bad_points_fc.map(function(feature) {
  return feature.buffer(30);
});

// Iterative Processing over Temporal Windows
periods.forEach(function(period) {
  print('Processing complementary points for period:', period);

  // Load the stratified samples generated in 3a
  var samplePoints = ee.FeatureCollection(output + 'samplePoints_' + period + '_v' + inputVersion);
  Map.addLayer(samplePoints, {}, 'Stratified Points ' + period, false);

  // Format and assign regional metadata to manual points
  var prepareManualPoints = function(f) {
    var point = f.geometry();
    var region = regionsCollection.filterBounds(point).first();
    var ref = ee.Number(f.get('reference'));
    var mapbValue = ee.Algorithms.If(region, ee.Feature(region).get('mapb'), null);

    return ee.Feature(point).set({'reference': ref, 'mapb': mapbValue, 'period': period, 'source': 'manual'});
  };

  // Keep only manual points inside valid classification regions
  var manualPointsPrepared = manualPoints.map(prepareManualPoints).filter(ee.Filter.notNull(['mapb']));
  print('Total manual points ' + period, manualPointsPrepared.size());
  Map.addLayer(manualPointsPrepared, {color: 'red'}, 'Manual Points ' + period, false);

  // Merge the integrated manual points with the original automated sample points
  var allPoints = samplePoints.merge(manualPointsPrepared);
  print('Total merged points ' + period, allPoints.size());

  // Spatial Exclusion (Point Removal)
  var points_clean = allPoints.filter(ee.Filter.bounds(bad_points_buffered).not());
  print('Total cleaned points ' + period, points_clean.size());
  Map.addLayer(points_clean, {}, 'Final Points ' + period, false);

  // Export as GEE asset
  Export.table.toAsset({
    collection: points_clean,
    description: 'samplePoints_' + period + '_v' + outputVersion,
    assetId: output + 'samplePoints_' + period + '_v' + outputVersion
  });
});
