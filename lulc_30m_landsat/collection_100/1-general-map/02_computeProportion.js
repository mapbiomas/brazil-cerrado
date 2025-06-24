// --- --- --- 02_computeProportion
/* Compute area per class per ecoregion to support proportional sample distribution
This script computes the area (in square kilometers) occupied by selected land use and cover classes within each ecoregion of the Cerrado biome for a given reference year. 
The resulting table is used to estimate the proportional distribution of training samples for classification tasks.
*/
// Author: barbara.silva@ipam.org.br

// Define output path and version
var version = '1';
var dirout = 'projects/mapbiomas-workspace/COLECAO_DEV/COLECAO10_DEV/CERRADO/LANDSAT/sample/area';

// Define target LULC classes to compute
var classes = [3, 4, 11, 12, 15, 18, 25, 33];

// Classification regions of the Cerrado biome
var regionsCollection = ee.FeatureCollection('users/dh-conciani/collection7/classification_regions/vector_v2');

// Set reference year (default = middle of time series)
var year = '2005';

// Load MapBiomas Collection 9.0 and select the reference year
var mapbiomas = ee.Image('projects/mapbiomas-public/assets/brazil/lulc/collection9/mapbiomas_collection90_integration_v1')
                 .select('classification_' + year);

// Reclassify original MapBiomas classes to IPAM workflow schema
mapbiomas = mapbiomas.remap({
  from: [3, 4, 5, 6, 49, 11, 12, 32, 29, 50, 13, 15, 19, 39, 20, 40, 62, 41, 36, 46, 47, 35, 48, 23, 24, 30, 33, 31],
  to:   [3, 4, 3, 3,  3, 11, 12, 12, 12, 12, 12, 15, 18, 18, 18, 18, 18, 18, 18, 18, 18, 18, 18, 25, 25, 25, 33, 33]
});

// Load MapBiomas color palette
var vis = {
  min: 0,
  max: 62,
  palette: require('users/mapbiomas/modules:Palettes.js').get('classification8')
};

// Plot the reference map
Map.addLayer(mapbiomas, vis, 'MapBiomas ' + year, true);

// Image with pixel area in square kilometers
var pixelArea = ee.Image.pixelArea().divide(1e6);

// Function to compute class areas per region
var getArea = function(feature) {
  // Clip classification to the region
  var clipped = mapbiomas.clip(feature);

  // Loop over target classes
  classes.forEach(function(classId) {
    // Mask pixels of the given class
    var classMask = pixelArea.mask(clipped.eq(classId));

    // Compute area (km²) and set as property
    var area_km2 = classMask.reduceRegion({
      reducer: ee.Reducer.sum(),
      geometry: feature.geometry(),
      scale: 30,
      maxPixels: 1e13
    }).get('area');

    // Store rounded value in feature
    feature = feature.set(
      String(classId),
      ee.Number(area_km2).multiply(10000).round().divide(10000) // 4 decimal precision
    );
  });

  return feature;
};

// Apply area computation to all regions
var computed = regionsCollection.map(getArea);
print('Computed area per class and region:', computed);
Map.addLayer(computed, {}, 'Area by region', false);

// Export as GEE asset
Export.table.toAsset({
  collection: computed,
  description: year + '_v' + version,
  assetId: dirout + '/' + year + '_v' + version
});
