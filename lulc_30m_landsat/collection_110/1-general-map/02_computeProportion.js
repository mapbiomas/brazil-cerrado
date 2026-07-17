// -- -- -- -- 02) Compute Area Proportion by Ecoregion
// Computes the area of specific land-use and land-cover (LULC) classes per ecoregion.
// This data serves as a reference to estimate and distribute training samples
// for the classification model.

// Define visualization parameters
var vis = {
    min: 0,
    max: 62,
    palette:require('users/mapbiomas/modules:Palettes.js').get('classification8')
};

// Define the string version for the output file
var version = '1';

// Define an array with the classes to be assessed
var classes = [3, 4, 11, 12, 15, 18, 25, 33];

// Define the output directory
var dirout = 'projects/ee-ipam-cerrado/assets/Collection_04/sample/area';

// Define the reference year (default: mid of the time-series [nYear/2])
var year = '2020';

// Load the Cerrado classification regions 
var regionsCollection = ee.FeatureCollection('projects/ee-ipam-cerrado/assets/ancillary/collection_11_classification_regions_vector');
  
// Load the MapBiomas 10m LULC Collection 3.0 and select the band for the reference year
var mapbiomas = ee.Image('projects/mapbiomas-public/assets/brazil/lulc_10m/collection3/mapbiomas_10m_collection3_integration_v1')
                  .select('classification_' + year);

// Reclassify the selected MapBiomas image based on the IPAM workflow classes
mapbiomas = mapbiomas.remap({
    'from': [3, 4, 5, 6, 49, 11, 12, 32, 29, 50, 15, 19, 36, 23, 24, 30, 33, 31],
    'to':   [3, 4, 3, 3,  3, 11, 12, 12, 12, 12, 15, 18, 18, 25, 25, 25, 33, 33]
  }
);

// Create an image representing the area of each pixel in square kilometers
var pixelArea = ee.Image.pixelArea().divide(1000000); //km²

// Add the reclassified MapBiomas image to the map
Map.addLayer(mapbiomas, vis, 'Collection ' + year, true);

// Define a function to calculate the area of each class for a single region [i]
var getArea = function(feature) {
  
  // Clip the clssification image to the boundaries of the current region
  var mapbiomas_i = mapbiomas.clip(feature);
  
  // Iterate over each predefined class value [j]
  classes.forEach(function(class_j) {
    
    // Mask the pixel area image to keep only pixels matching the current class
    var reference_ij = pixelArea.mask(mapbiomas_i.eq(class_j));
    
    // Reduce the masked area image to sum the total area within the feature's geometry
    feature = feature.set(String(class_j),
                         ee.Number(reference_ij.reduceRegion({
                                      reducer: ee.Reducer.sum(),
                                      geometry: feature.geometry(),
                                      scale: 10,
                                      maxPixels: 1e13}
                                    ).get('area'))
                                    .multiply(10000)
                                    .round()
                                    .divide(10000) // Divide to restore the value to 4 decimal places
                              );
                          });
                          
  // Return the updated feature containing the class area properties
  return feature;
}; 

// Map the getArea function over all features in the regions collection
var computed_obj = regionsCollection.map(getArea);
print ('Result: ', computed_obj);

Map.addLayer(computed_obj, {}, 'Result Regions', false);

// Export as GEE asset
Export.table.toAsset({'collection': computed_obj, 
                      'description': year + '_v' + version,
                      'assetId': dirout + '/' + year + '_v' + version});
                      
