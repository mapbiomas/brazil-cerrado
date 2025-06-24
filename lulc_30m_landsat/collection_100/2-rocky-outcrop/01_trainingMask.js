// --- --- --- 01_trainingMask

/*
Generate a training mask based on stable pixels from MapBiomas Collection
Description: This script generates a training mask for the rocky outcrop class based on stable pixels from MapBiomas Collection 9.0 (1985–2023). 
It blends classifications from Collection 9.0 and 10.0, detects stable pixels over time, and exports the result as a GEE asset.
*/

// Author: barbara.silva@ipam.org.br

// Define output version and asset directory
var version = '4';
var dirout = 'projects/ee-barbarasilvaipam/assets/collection-10_rocky-outcrop/masks/';

// Load Area of Interest (AOI)
var aoi_vec = ee.FeatureCollection(
  "projects/ee-barbarasilvaipam/assets/collection-10_rocky-outcrop/masks/aoi_v2"
);
var aoi_img = ee.Image(1).clip(aoi_vec);
Map.addLayer(aoi_vec, {palette: ['red']}, 'Area of Interest');

// Set visualization parameters
var palettes = require('users/mapbiomas/modules:Palettes.js');
var vis = {
  min: 1,
  max: 29,
  palette: ["32a65e", "2532e4", "d6bc74", "edde8e", "ffaa5f"]
};

// Load MapBiomas Collection 9.0
var collection = ee.Image(
  'projects/mapbiomas-public/assets/brazil/lulc/collection9/mapbiomas_collection90_integration_v1'
).updateMask(aoi_img);

// Load MapBiomas Collection 10.0 (development version)
var collection_10 = ee.Image(
  'projects/mapbiomas-workspace/COLECAO_DEV/COLECAO10_DEV/CERRADO/LANDSAT/C10-POST-CLASSIFICATION/CERRADO_C10_gapfill_v1_incidence_v2_frequency_v3_temporal_v12_noFalseRegrowth_v7_geomorpho_v1_sp_v1'
).updateMask(aoi_img);

// Remap Collection 9.0 to isolate the rocky outcrop class (29)
var reclassify = function(image) {
  return image.remap({
    from: [29],
    to:   [29]
  });
};

// Remap Collection 10.0 to group native vegetation, non-vegetation, and rocky outcrop
var reclassify_a = function(image) {
  return image.remap({
    from: [3, 4, 11, 12, 15, 18, 25, 33],
    to:   [1, 1,  2,  3,  4,  4,  4,  2]
  });
};

// Compute number of distinct classes per pixel over time
var numberOfClasses = function(image) {
  return image.reduce(ee.Reducer.countDistinctNonNull()).rename('number_of_classes');
};

// List of years to process
var years = [
  1985, 1986, 1987, 1988, 1989, 1990, 
  1991, 1992, 1993, 1994, 1995, 1996, 
  1997, 1998, 1999, 2000, 2001, 2002, 
  2003, 2004, 2005, 2006, 2007, 2008, 
  2009, 2010, 2011, 2012, 2013, 2014,
  2015, 2016, 2017, 2018, 2019, 2020, 
  2021, 2022, 2023
];

// Initialize container to store reclassified images
var container = ee.Image([]);

// For each year, blend the collections and add as a new band
years.forEach(function(year) {
  var band9 = reclassify(collection.select('classification_' + year)).rename('classification_' + year);
  var band10 = reclassify_a(collection_10.select('classification_' + year)).rename('classification_' + year);
  var blended = band10.blend(band9);
  container = container.addBands(blended);
});

// Count how many distinct classes exist over the time series
var nClass = numberOfClasses(container);

// Keep only stable pixels (with the same class throughout the period)
var stable = container.select(0).updateMask(nClass.eq(1));

// Visualize and print the stable mask
Map.addLayer(stable, vis, 'MB Stable Pixels');
print('MB Stable Pixels', stable);

// Export the stable pixels as a GEE asset
Export.image.toAsset({
  image: stable,
  description: 'cerrado_rockyTrainingMask_1985_2023_v' + version,
  assetId: dirout + 'cerrado_rockyTrainingMask_1985_2023_v' + version,
  scale: 30,
  pyramidingPolicy: {'.default': 'mode'},
  maxPixels: 1e13,
  region: aoi_vec.geometry()
});
