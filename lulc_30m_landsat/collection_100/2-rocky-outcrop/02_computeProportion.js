// --- --- --- 02_computeProportion
// Compute class area within the AOI to support rocky outcrop sample estimation
// Description: This script computes the area (in square kilometers) of each land cover class within the AOI based on stable pixels. 
// The resulting statistics are used to guide the sampling strategy for rocky outcrop classification.

// Author: barbara.silva@ipam.org.br

// Define output and input versions
var output_version = '4';
var input_version = '4';

// List of classes to compute area for
var classes = [1, 2, 3, 4, 29];

// Define output asset directory
var dirout = 'projects/ee-barbarasilvaipam/assets/collection-10_rocky-outcrop/sample/area/';

// Load Area of Interest (AOI)
var aoi_vec = ee.FeatureCollection(
  'projects/ee-barbarasilvaipam/assets/collection-10_rocky-outcrop/masks/aoi_v4'
);
var aoi_img = ee.Image(1).clip(aoi_vec);
Map.addLayer(aoi_img, {palette: ['red']}, 'Area of Interest');

// Load stable pixels mask (Collection 9.0 and 10.0)
var stable = ee.Image(
  'projects/ee-barbarasilvaipam/assets/collection-10_rocky-outcrop/masks/cerrado_rockyTrainingMask_1985_2023_v' + input_version
);

// Print pixel count histogram for each class
var pixel_values = stable.reduceRegion({
  reducer: ee.Reducer.frequencyHistogram(),
  geometry: aoi_vec.geometry(),
  scale: 30,
  maxPixels: 1e14
});
print('Stable Pixels Histogram:', pixel_values);

// Visualize stable pixels
var vis = {
  min: 1,
  max: 29,
  palette: ["32a65e", "2532e4", "d6bc74", "edde8e", "ffaa5f"]
};
Map.addLayer(stable, vis, 'Stable Pixels');
print('Stable Image', stable);

// Define pixel area image in square kilometers
var pixelArea = ee.Image.pixelArea().divide(1e6);

// Function to compute area per class for each feature
var getArea = function(feature) {
  var mapbiomas_i = stable.clip(feature);

  classes.forEach(function(class_j) {
    var referenceArea = pixelArea.mask(mapbiomas_i.eq(class_j));

    // Reduce area and add to feature properties
    feature = feature.set(
      String(class_j),
      ee.Number(referenceArea.reduceRegion({
        reducer: ee.Reducer.sum(),
        geometry: feature.geometry(),
        scale: 30,
        maxPixels: 1e13,
        tileScale: 4
      }).get('area'))
      .multiply(10000)
      .round()
      .divide(10000) // Round to 4 decimal places
    );
  });

  return feature;
};

// Apply area computation for AOI
var computed_obj = aoi_vec.map(getArea);
print('Result:', computed_obj);

// Export area statistics as GEE asset
Export.table.toAsset({
  collection: computed_obj,
  description: 'stable_v' + output_version,
  assetId: dirout + 'stable_v' + output_version
});
