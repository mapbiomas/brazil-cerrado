// -- -- -- -- 01_trainingMask
// generate training mask based in stable pixels from mapbiomas collection 10.0
// barbara.silva@ipam.org.br

// Output version
var version = '1';

// Set directory for the output file
var dirout = 'projects/ee-barbarasilvaipam/assets/collection-03_rocky-outcrop/masks/';

// Set area of interest (AOI)
var aoi_vec = ee.FeatureCollection("projects/ee-barbarasilvaipam/assets/collection-03_rocky-outcrop/masks/aoi_v1");

// Transform AOI into image
var aoi_img = ee.Image(1).clip(aoi_vec);
Map.addLayer(aoi_vec, {palette:['red']}, 'Area of Interest');

// Random color schema   
var palettes = require('users/mapbiomas/modules:Palettes.js');
var vis = {
    'min': 1,
    'max': 29,
    'palette': ["32a65e","FFFFB2", "ffaa5f"]
};

// Load mapbiomas collection 10.0
var collection = ee.Image('projects/mapbiomas-public/assets/brazil/lulc/collection10/mapbiomas_brazil_collection10_integration_v2')
                   .updateMask(aoi_img);

// Set function to reclassify collection by native vegetation (1), non‑vegetation (2) and rocky outcrop (29)
var reclassify = function(image) {
  return image.remap({
        'from': [3, 4, 5, 6, 49, 11, 12, 32, 50, 15, 19, 39, 20, 40, 62, 41, 36, 46, 47, 35, 48, 23, 24, 30, 33, 31],
          'to': [1, 1, 1, 1,  1,  3,  2,  2,  2,  4,  4,  4,  4,  4,  4,  4,  4,  4,  4,  4,  4,  5,  5,  5,  3,  3],
    }
  );
};

// Set function to compute the number of classes over a given time-series 
var numberOfClasses = function(image) {
    return image.reduce(ee.Reducer.countDistinctNonNull()).rename('number_of_classes');
};

// Set years to be processed 
var years = [ 2016, 2017, 2018, 2019, 
              2020, 2021, 2022, 2023,
              2024];

// Remap collection to  native vegetation and non‑vegetation classes 
var recipe = ee.Image([]);      // build an empty container

// For each year
years.forEach(function(i) {
  
  // Select classification for the year i
  var yi = reclassify(collection.select('classification_' + i)).rename('classification_' + i);
  
  // Store into a container
  recipe = recipe.addBands(yi);
});

// Get the number of classes 
var nClass = numberOfClasses(recipe);

// Now, get only the stable pixels (nClass equals to one)
var stable = recipe.select(0).updateMask(nClass.eq(1));

// Plot stable pixels
Map.addLayer(stable, vis, 'MB stable pixels');
print ('MB stable pixels', stable);

// Export as GEE asset
Export.image.toAsset({
    "image": stable,
    "description": 'cerrado_rockyTrainingMask_2016_2024_v' + version,
    "assetId": dirout + 'cerrado_rockyTrainingMask_2016_2024_v'+ version,
    "scale": 10,
    "pyramidingPolicy": {'.default': 'mode'},
    "maxPixels": 1e13,
    "region": aoi_vec.geometry()
});
