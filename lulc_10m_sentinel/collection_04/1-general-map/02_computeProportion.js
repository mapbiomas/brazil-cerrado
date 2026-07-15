// -- -- -- -- 02_computeProportion
// compute area by ecoregion to be used as a reference to estimate the samples distribution 
// barbara.silva@ipam.org.br, dhemerson.costa@ipam.org.br and ana.souza@ipam.org.br

// Input metadata
var version = '2';

// Define classes to be assessed
var classes = [3, 4, 11, 12, 15, 18, 25, 33];

// Output directory
var dirout = 'projects/mapbiomas-workspace/COLECAO_DEV/COLECAO10_DEV/CERRADO/SENTINEL/sample/area';

// Cerrado classification regions
var regionsCollection = ee.FeatureCollection('users/dh-conciani/collection7/classification_regions/vector_v2');
  
// Define year to be used as reference (default: mid of the time-series [nYear/2])
var year = '2020';

// Load MapBiomas 10m LULC -- Collection 2.0
var mapbiomas = ee.Image('projects/mapbiomas-public/assets/brazil/lulc_10m/collection2/mapbiomas_10m_collection2_integration_v1')
                  .select('classification_' + year);

// Define function to compute area (skm)
var pixelArea = ee.Image.pixelArea().divide(1000000); //km²

// Reclassify collection by ipam-workflow classes 
mapbiomas = mapbiomas.remap({
    'from': [3, 4, 5, 6, 49, 11, 12, 32, 29, 50, 15, 19,  9, 36, 23, 24, 30, 33, 31],
    'to':   [3, 4, 3, 3,  3, 11, 12, 12, 12, 12, 15, 18,  9, 18, 25, 25, 25, 33, 33]
  }
);

// Import Mapbiomas color schema 
var vis = {
    min: 0,
    max: 62,
    palette:require('users/mapbiomas/modules:Palettes.js').get('classification8')
};

// Plot 
Map.addLayer(mapbiomas, vis, 'Collection ' + year, true);

// Define a function to get the class area 
// For each region 
var getArea = function(feature) {
  
  // Get classification for the region [i]
  var mapbiomas_i = mapbiomas.clip(feature);
  
  // For each class [j]
  classes.forEach(function(class_j) {
    
    // Create the reference area
    var reference_ij = pixelArea.mask(mapbiomas_i.eq(class_j));
    
    // Compute area and insert as metadata into the feature 
    feature = feature.set(String(class_j),
                         ee.Number(reference_ij.reduceRegion({
                                      reducer: ee.Reducer.sum(),
                                      geometry: feature.geometry(),
                                      scale: 10,
                                      maxPixels: 1e13}
                                    ).get('area'))
                                    .multiply(10000)
                                    .round()
                                    .divide(10000)
                              ); // end of set
                          }); // end of class_j function
  // return feature
  return feature;
}; 

var computed_obj = regionsCollection.map(getArea);
print ('Result: ', computed_obj);
Map.addLayer(computed_obj, {}, 'Result', false);

// Export computation as GEE asset
Export.table.toAsset({'collection': computed_obj, 
                      'description': year + '_v' + version,
                      'assetId': dirout + '/' + year + '_v' + version});
