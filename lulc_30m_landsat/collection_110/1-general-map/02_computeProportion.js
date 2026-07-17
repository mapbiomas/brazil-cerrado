// -- -- -- -- 02) Compute Area Proportion by Ecoregion
// This script computes the total area (in square kilometers) for each target
// Land Use and Land Cover (LULC) class within the official classification regions.
// Instead of calculating area variations over every single year, it samples one 
// representative "reference year" per temporal window. The resulting tables are 
// used to define the stratified sample size allocations for training classifiers.
// Temporal References:
//  Window 1985_1996 -> Reference Year: 1990
//  Window 1994_2005 -> Reference Year: 1999
//  Window 2003_2014 -> Reference Year: 2008
//  Window 2012_2024 -> Reference Year: 2018


// Define visualization parameters
var vis = {
    min: 0,
    max: 62,
    palette:require('users/mapbiomas/modules:Palettes.js').get('classification8')
};

// Define the string version for the output file
var version = '6';

// Define the output directory path
var dirout = 'projects/ee-ipam-cerrado/assets/Collection_11/sample/area';

// Define an array with the classes to be assessed
var classes = [3, 4, 11, 12, 15, 18, 25, 33];

// Load the Cerrado classification regions 
var regionsCollection = ee.FeatureCollection('projects/ee-ipam-cerrado/assets/ancillary/collection_11_classification_regions_vector');
  
// Configure temporal windows alongside their respective reference years
var periods = [
  {name: '1985_1996', start: 1985, end: 1996, refYear: 1990},
  {name: '1994_2005', start: 1994, end: 2005, refYear: 1999},
  {name: '2003_2014', start: 2003, end: 2014, refYear: 2008},
  {name: '2012_2024', start: 2012, end: 2024, refYear: 2018}
];

// MapBiomas dynamic coverage data (Collection 10.1)
var mapbiomasFull = ee.Image(
  'projects/mapbiomas-public/assets/brazil/lulc/collection10_1/mapbiomas_brazil_collection10_1_coverage_v1'
);

// Remap MapBiomas collection classes into IPAM targets schema
var remapMapbiomas = function(image) {
  return image.remap({
    from: [3, 4, 5, 6, 49, 11, 12, 32, 29, 50, 13, 15, 19, 39, 20, 40, 62, 41, 36, 46, 47, 35, 48, 23, 24, 30, 33, 31],
    to:   [3, 4, 3, 3,  3, 11, 12, 12, 12, 12, 12, 15, 18, 18, 18, 18, 18, 18, 18, 18, 18, 18, 18, 25, 25, 25, 33, 33]
  });
};

// Continuous area extraction image scaled to square kilometers ($km^2$)
var pixelArea = ee.Image.pixelArea().divide(1e6);

// Extract spatial area for each specific class inside a vector region
var getAreaImage = function(mapbiomas, feature) {
  var geometry = feature.geometry();
  var result = feature;

  classes.forEach(function(classId) {
    // Reduce region to extract the sum of area for the specific class
    var classArea = pixelArea.updateMask(mapbiomas.eq(classId)).reduceRegion({
      reducer: ee.Reducer.sum(),
      geometry: geometry,
      scale: 30,
      maxPixels: 1e13
    }).get('area');

    // Attach area data as standard string attribute to the output feature (rounded to 4 decimals)
    result = result.set(
      String(classId),
      ee.Number(classArea).multiply(10000).round().divide(10000)
    );
  });

  return result;
};

periods.forEach(function(period) {
  var year = period.refYear;

  // Select and remap the specific reference year classification band
  var mapbiomas = remapMapbiomas(
    mapbiomasFull.select('classification_' + year)
  );

  // Map area calculation over all regional polygons
  var computed = regionsCollection.map(function(feature) {
    return getAreaImage(mapbiomas, feature)
      .set('period', period.name)
      .set('year', year);
  });

  // Display the baseline remapped MapBiomas reference year map on canvas
  Map.addLayer(mapbiomas, vis, 'MapBiomas_' + year, false);

  // Export results as a standalone FeatureCollection Asset table
  Export.table.toAsset({
    collection: computed,
    description: period.name + '_v' + version,
    assetId: dirout + period.name + '_v' + version
  });
});

