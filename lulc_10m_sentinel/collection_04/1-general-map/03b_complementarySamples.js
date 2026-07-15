// -- -- -- -- 03b) Complementary Sample Points Generation
// This script merges the automated stratified sample points (generated in Step 3a)
// with complementary samples collected manually and stored as GEE assets.

// Define the input version for the automated samples
var inputVersion = '3';

// Define the output version for the final samples
var outputVersion = '4';

// Define the output directory
var output = 'projects/ee-ipam-cerrado/assets/Collection_04/sample/points/';

// Define the standardized property name used to store the LULC class value
var classProperty = 'reference';

// Define the standardized property name used to store the ecoregion ID
var regionProperty = 'mapb';

// Load the Cerrado classification regions feature collection to extract region IDs
var regionTable = ee.FeatureCollection("projects/ee-ipam-cerrado/assets/ancillary/collection_11_classification_regions_vector");

// Add the region table to the map display for visual reference
Map.addLayer(regionTable, {}, 'Region Table', false);

// Load the sample points (from Step 3a)
var automatedSamples = ee.FeatureCollection(output + 'samplePoints_v' + inputVersion);

// Load Complementary Sample Assets
var manualForest = ee.FeatureCollection('projects/ee-ipam-cerrado/assets/Collection_04/sample/manual/comp_samples_forest');
var manualSavanna = ee.FeatureCollection('projects/ee-ipam-cerrado/assets/Collection_04/sample/manual/comp_samples_savanna');
var manualWetland = ee.FeatureCollection('projects/ee-ipam-cerrado/assets/Collection_04/sample/manual/comp_samples_wetland');
var manualGrassland = ee.FeatureCollection('projects/ee-ipam-cerrado/assets/Collection_04/sample/manual/comp_samples_grassland');
var manualAgriculture = ee.FeatureCollection('projects/ee-ipam-cerrado/assets/Collection_04/sample/manual/comp_samples_agriculture');
var manualNonVegetated = ee.FeatureCollection('projects/ee-ipam-cerrado/assets/Collection_04/sample/manual/comp_samples_non-vegetated');

// Define a function to standardize manual points by appending class and spatial region data
var formatManualSamples = function(collection, classValue) {
  
  // Map over each point feature in the provided collection
  return collection.map(function(feature) {
    
    // Filter the region table to isolate the specific polygon that intersects the point
    var intersectingRegion = regionTable.filterBounds(feature.geometry()).first();
    
    // Extract the region ID value from the intersecting polygon
    var regionId = intersectingRegion.get(regionProperty);
    
    // Rebuild the feature using only its geometry to strip away arbitrary legacy properties
    var cleanFeature = ee.Feature(feature.geometry());
    
    // Set the standardized reference class property to the specified class value
    cleanFeature = cleanFeature.set(classProperty, classValue);
    
    // Set the standardized region ID property to match the format of the automated samples
    cleanFeature = cleanFeature.set(regionProperty, regionId);
    
    // Return the clean and fully standardized feature
    return cleanFeature;
  });
};

// Apply the standardization function to the manual samples
var stdForest = formatManualSamples(manualForest, 3);
var stdSavanna = formatManualSamples(manualSavanna, 4);
var stdWetland = formatManualSamples(manualWetland, 11);
var stdGrassland = formatManualSamples(manualGrassland, 12);
var stdAgriculture = formatManualSamples(manualAgriculture, 18);
var stdNonVegetated = formatManualSamples(manualNonVegetated, 25);

// Create an empty feature collection and systematically merge all manual points
var allManualSamples = ee.FeatureCollection([])
  .merge(stdForest)
  .merge(stdSavanna)
  .merge(stdWetland)
  .merge(stdGrassland)
  .merge(stdAgriculture)
  .merge(stdNonVegetated);

// Merge the integrated manual points with the original automated sample points
var unifiedSamples = automatedSamples.merge(allManualSamples);

// Spatial Exclusion (Point Removal)
var pointsToRemove = ee.FeatureCollection ("projects/ee-ipam-cerrado/assets/Collection_04/sample/manual/points_to_remove");

// Create a combined 30-meter buffer around all removal points to account for slight spatial offsets
var exclusionZone = pointsToRemove.geometry().buffer(30);

// Filter the unified collection to retain only points that do NOT intersect the exclusion zone
var finalSamples = unifiedSamples.filter(ee.Filter.bounds(exclusionZone).not());

// Print the total count of the imported automated points to the console
print('Existing automated points:', automatedSamples.size());

// Print the total count of the processed manual points to the console
print('New manual points:', allManualSamples.size());

// Print the count of points targeted for removal
print('Points targeted for removal:', pointsToRemove.size());

// Print the total count of the unified collection to the console
print('Total unified points:', unifiedSamples.size());
print('Sample of unified collection:', unifiedSamples.limit(10));

// Removed points on the map 
Map.addLayer(pointsToRemove, {color: 'black'}, 'Points Removed');

// New manual points on the map
Map.addLayer(allManualSamples, {color: 'yellow'}, 'New Manual Points');

// Final unified points on the map 
Map.addLayer(unifiedSamples, {color: 'red'}, 'Unified samplePoints');

// Export as GEE asset
Export.table.toAsset({
  collection: unifiedSamples,
  description: 'samplePoints_v' + outputVersion,
  assetId: output + 'samplePoints_v' + outputVersion
});
