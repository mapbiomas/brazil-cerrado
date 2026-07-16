// -- -- -- -- 00_aoiArea
// This script defines the Area of Interest (AOI) for mapping 
// the Rocky Outcrop class in the Cerrado biome. It calculates a 55 km spatial 
// buffer around a set of collected Rocky Outcrop samples to restrict 
// the subsequent classification processing exclusively to relevant regions.

// Define the version for the output asset
var version = '1';

// Define the base output directory path
var dirout = 'projects/ee-barbarasilvaipam/assets/collection-04_rocky-outcrop/masks/';

// Define the buffer distance in meters (55,000 m = 55 km)
var bufferDistance = 55000;

// Load the Rocky Outcrop sample points 
var rockySamplesGeometry = ee.FeatureCollection('projects/ee-barbarasilvaipam/assets/collection-04_rocky-outcrop/C04_rocky-outcrop-collected-v1').geometry();

// Apply the spatial buffer around the samples
var aoiBuffer = rockySamplesGeometry.buffer(bufferDistance);

// Convert the resulting buffered geometry back into a standard FeatureCollection
var aoiFeatureCollection = ee.FeatureCollection([ee.Feature(aoiBuffer)]);

// Print the generated AOI for inspection
print('Generated AOI:', aoiFeatureCollection);

// Render the original rocky outcrop sample geometries
Map.addLayer(rockySamplesGeometry, {color: 'black'}, 'Rocky Samples');

// Render the generated AOI buffer
Map.addLayer(aoiFeatureCollection, {color: 'blue'}, 'Buffered AOI Area');

// Export as GEE asset
Export.table.toAsset({
  collection: aoiFeatureCollection,
  description: 'aoi_v' + version,
  assetId: dirout + 'aoi_v' + version
  });
