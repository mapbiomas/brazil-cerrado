// --- --- --- 00_aoiArea

/* 
Define the Area of Interest (AOI) for mapping the rocky outcrop class
Description: This script defines the Area of Interest (AOI) for mapping the rocky outcrop class. 
It creates a 50 km buffer around reference samples and exports the resulting geometry as a GEE asset. 
*/

// Author: barbara.silva@ipam.org.br

// Set the output version and asset directory
var version = '4';
var dirout = 'projects/ee-barbarasilvaipam/assets/collection-10_rocky-outcrop/masks/';

// Load rocky outcrop reference samples (Collection 10)
var rocky_samples = ee.FeatureCollection(
  'projects/ee-barbarasilvaipam/assets/collection-10_rocky-outcrop/C10_rocky-outcrop-collected-v3'
).geometry();
Map.addLayer(rocky_samples, {color: 'black'}, 'Rocky Samples');

// Create a 50 km buffer around the samples
var buffer = rocky_samples.buffer(50000);
Map.addLayer(buffer, {color: 'green'}, 'Buffer');

// Wrap buffer geometry into a FeatureCollection
var featureCollection = ee.FeatureCollection([buffer]);
print('AOI', featureCollection);
Map.addLayer(featureCollection, {color: 'blue'}, 'AOI Area');

// Export the AOI as a GEE asset
Export.table.toAsset({
  collection: featureCollection,
  description: 'aoi_v' + version,
  assetId: dirout + 'aoi_v' + version
});
