// -- -- -- -- 01) Stable Training Mask
// This script generates a stable training mask specifically for the Rocky Outcrop 
// classification in the Cerrado. It extracts data from the MapBiomas 10m Collection 3.0, 
// groups detailed LULC classes into five broad thematic categories (Forest, Herbaceous, 
// Wetland/Water, Farming, Non-Vegetated), and isolates pixels that remained in the 
// same broad category throughout the entire evaluated time series (2017–2024).

// Define visualization parameters 
var vis = {
  min: 1,
  max: 5,
  palette: [ '#32a65e', '#2532e4', '#d6bc74', '#edde8e', '#d4271e'],
};

// Define the version  for the output asset
var version = '3';

// Define the base output directory path
var dirout = 'projects/ee-barbarasilvaipam/assets/collection-11_rocky-outcrop/masks/';

// Load the Area of Interest (AOI)
var aoi_vec = ee.FeatureCollection("projects/ee-barbarasilvaipam/assets/collection-11_rocky-outcrop/masks/aoi_v1");

// Convert the AOI feature collection into a binary image mask for raster operations
var aoi_img = ee.Image(1).clip(aoi_vec);

// Load the MapBiomas 10m LULC Collection 10.1
var collection = ee.Image('projects/mapbiomas-public/assets/brazil/lulc/collection10_1/mapbiomas_brazil_collection10_1_coverage_v1')
                    .updateMask(aoi_img);

// Define a function to group original LULC classes into broad thematic categories
var reclassify = function(image) {
  // Remap to: forest (1), herbaceous vegetation (2), farming (3), non-vegetated (4) and wetland and water (5)
  return image.remap({
    'from': [3, 4, 5, 6, 49, 11, 12, 32, 29, 50, 15, 19, 39, 20, 40, 62, 41, 36, 46, 47, 35, 48, 23, 24, 30, 33, 31],
      'to': [1, 1, 1, 1,  1,  5,  2,  2, 29,  2,  3,  3,  3,  3,  3,  3,  3,  3,  3,  3,  3,  3,  4,  4,  4,  5,  5]
  });
};

// Define a function to calculate the number of unique classes a pixel experienced over time
var numberOfClasses = function(image) {
  // Apply a count-distinct reducer across all bands (years) for each pixel
  return image.reduce(ee.Reducer.countDistinctNonNull()).rename('number_of_classes');
};

// Define the sequence of years to evaluate for pixel stability
var years = [ 1985, 1986, 1987, 1988, 1989, 1990, 
              1991, 1992, 1993, 1994, 1995, 1996, 
              1997, 1998, 1999, 2000, 2001, 2002, 
              2003, 2004, 2005, 2006, 2007, 2008, 
              2009, 2010, 2011, 2012, 2013, 2014,
              2015, 2016, 2017, 2018, 2019, 2020, 
              2021, 2022, 2023, 2024];

// Initialize an empty Earth Engine image to accumulate the reclassified annual bands
var container = ee.Image([]);

// Iterate over each year in the defined time series
years.forEach(function(i) {
  // Extract, reclassify, and appropriately rename the specific annual band
  var yi = reclassify(collection.select('classification_' + i)).rename('classification_' + i);
  // Append the reclassified annual band to the cumulative multi-band image
  container = container.addBands(yi);
});

// Compute the total number of distinct broad classes each pixel had across all years
var nClass = numberOfClasses(container);

// Isolate pixels that had exactly one class throughout the time series (completely stable pixels)
var stable = container.select(0).updateMask(nClass.eq(1));

// Render the vector AOI boundary 
Map.addLayer(aoi_vec, {palette: ['red']}, 'Area of Interest', false);

// Render the final stable pixels mask on the map
Map.addLayer(stable, vis, 'MB Stable Pixels');

// Print the finalized stable pixels image structure to the console
print('MB Stable Pixels', stable);

// Export as GEE asset
Export.image.toAsset({
    "image": stable,
    "description": 'cerrado_rockyTrainingMask_1985_2024_v' + version,
    "assetId": dirout + 'cerrado_rockyTrainingMask_1985_2024_v'+ version,
    "scale": 30,
    "pyramidingPolicy": {'.default': 'mode'},
    "maxPixels": 1e13,
    "region": aoi_vec.geometry()
});
