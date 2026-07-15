// -- -- -- -- 02_computeProportion
// compute area by class to be used as reference to estimate samples of rocky outcrop
// barbara.silva@ipam.org.br

// Output version
var output_version = '1';
var input_version = '1';

// Define classes to be assessed
var classes = [1, 2, 3, 4, 5, 29];

// Output directory
var dirout = 'projects/ee-barbarasilvaipam/assets/collection-03_rocky-outcrop/sample/area/';

// Read area of interest
var aoi_vec = ee.FeatureCollection('projects/ee-barbarasilvaipam/assets/collection-03_rocky-outcrop/masks/aoi_v1');
var aoi_img = ee.Image(1).clip(aoi_vec);
Map.addLayer(aoi_img, {palette:['red']}, 'Area of Interest');

// Stable pixels from collection 10.0 (2016-2024)
var stable = ee.Image('projects/ee-barbarasilvaipam/assets/collection-03_rocky-outcrop/masks/cerrado_rockyTrainingMask_2016_2024_v'+input_version);

var pixel_values = stable.reduceRegion({
    reducer: ee.Reducer.frequencyHistogram(),
    geometry: aoi_vec.geometry(),
    scale: 10,
    maxPixels: 1e14
});
print('Stable pixels Histogram:', pixel_values);

// Random color schema  
var vis = {
    'min': 1,
    'max': 29,
    'palette': ["32a65e","2532e4", "d6bc74", "edde8e", "ffaa5f"]
};

Map.addLayer(stable, vis, 'stable pixels');
print ('stable', stable);

// Define function to compute area (skm)
var pixelArea = ee.Image.pixelArea().divide(1000000); //km²

// Define a function to get the class area 
// For AOI region 
var getArea = function(feature) {

  // Get classification for the region [i]
  var mapbiomas_i = stable.clip(feature);
  
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
                                      maxPixels: 1e13,
                                      tileScale: 4}
                                    ).get('area'))
                                    .multiply(10000)
                                    .round()
                                    .divide(10000)
                              ); // End of set
                          }); // End of class_j function
  // Return feature
  return feature;
}; 

var computed_obj = aoi_vec.map(getArea);
print ('Result: ', computed_obj);

// Export computation as GEE asset
Export.table.toAsset({'collection': computed_obj, 
                      'description': 'stable_v' + output_version,
                      'assetId': dirout + 'stable_v' + output_version});
