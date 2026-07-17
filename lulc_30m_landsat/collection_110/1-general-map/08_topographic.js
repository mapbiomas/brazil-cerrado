// -- -- -- -- 08) Topographic Filter
// This script applies a topographic consistency filter to the LULC maps. 
// It corrects systematic classification errors caused by terrain shadows or 
// steep slopes. Specifically, it converts anomalous Wetlands and unstable Water 
// (water pixels with historical vegetation cover) on steep slopes into Forest. 
// It also replaces Mosaic class pixels on extremely steep slopes with the 
// local focal mode.


// Define visualization parameters
var vis = {
  min: 0,
  max: 75,
  palette: require('users/mapbiomas/modules:Palettes.js').get('brazil'),
  bands: 'classification_2024'
};

// Define the input version
var inputVersion = '1';

// Define the output version
var outputVersion = '3';

// Define the base directory
var root = 'projects/ee-ipam/assets/MAPBIOMAS/LULC/CERRADO_DEV/COL_11/SENTINEL/C04-POST-CLASSIFICATION/';
var out = 'projects/ee-ipam/assets/MAPBIOMAS/LULC/CERRADO_DEV/COL_11/SENTINEL/C04-POST-CLASSIFICATION/';

// Construct the base name of the input file
var inputFile = 'CERRADO_C04_gapfill_v3_spt_v' + inputVersion;

// Load the classification multi-band image
var classificationInput = ee.Image(root + inputFile);
print('Input classification', classificationInput);
Map.addLayer(classificationInput, vis, 'Input classification', false);

// Define the numeric IDs for the LULC classes evaluated by this filter
var forestClass = 3;
var savannaClass = 4;
var wetlandClass = 11;
var grasslandClass = 12;
var restingaClass = 50;
var mosaicClass = 21;
var waterClass = 33;

// Set the slope threshold (in percent) above which Wetland pixels are considered anomalous
var wetlandSlopeThreshold = 12;
// Set the slope threshold (in percent) above which Water pixels are considered anomalous
var waterSlopeThreshold = 15;
// Set the slope threshold (in percent) above which Mosaic of Uses pixels are filtered
var mosaicSlopeThreshold = 50;

// Set the minimum non-consecutive years a pixel must be classified as vegetation to flag terrain shadows disguised as water
var minVegetationYearsForWaterCorrection = 2;

// Extract the native projection properties from the input image to standardize subsequent spatial operation
var projection = classificationInput.projection();

// Load the Cerrado classification regions feature collection
var regions = ee.FeatureCollection('projects/ee-ipam-cerrado/assets/ancillary/collection_11_classification_regions_vector');

// Create a binary raster mask derived from the regions geometry
var regionsMask = ee.Image(1).clip(regions);

// Load the MERIT Digital Elevation Model (DEM) and mask it to the Cerrado regions
var dem = ee.Image("MERIT/DEM/v1_0_3")
            .select('dem')
            .updateMask(regionsMask);
            
// Calculate the terrain slope in degrees using the DEM
var slopeDegrees = ee.Terrain.slope(dem);

// Convert the slope from degrees to percent
var slopePercent = slopeDegrees
  .expression('tan(3.141593/180 * degrees) * 100', {
  'degrees': slopeDegrees
  })
  .resample('bicubic')
  .reproject({
      crs: 'EPSG:4674',
      scale: 10
  })  
  .rename('slope')
  .toInt16();

// Extract the list of all annual band names from the input classification image
var bandNames = classificationInput.bandNames();

// Select and store the full temporal classification stack
var classificationStack = classificationInput.select(bandNames);

// Create a temporal boolean stack evaluating if each pixel belongs to any native vegetation class
var vegetationStack = classificationStack
  .eq(forestClass)
  .or(classificationStack.eq(savannaClass))
  .or(classificationStack.eq(wetlandClass))
  .or(classificationStack.eq(grasslandClass))
  .or(classificationStack.eq(restingaClass));

// Sum the boolean stack across the time series to count total years classified as vegetation
var vegetationCount = vegetationStack
  .reduce(ee.Reducer.sum())
  .rename('vegetation_count')
  .toInt16();

// Create a stable vegetation mask identifying pixels that meet the minimum vegetation year threshold
var vegetationAtLeastTwoYears = vegetationCount
  .gte(minVegetationYearsForWaterCorrection)
  .rename('vegetation_at_least_two_years');

// Initialize an empty Earth Engine image to accumulate the filtered bands during the iteration
var initialImage = ee.Image([]);

// Define the core function to apply topographic rules to a single annual band
var applyTopographicFilter = function(bandName, accumulatedImage) {
  // Cast the current band name parameter to an Earth Engine String object
  bandName = ee.String(bandName);
  
  // Isolate the specific annual band from the classification input
  var imageYear = classificationInput
    .select(bandName);

  // Define a Manhattan kernel with an 8-pixel radius to create a diamond-shaped focal neighborhood
  var kernel = ee.Kernel.manhattan({ radius: 8, units: 'pixels' });
  
  // Calculate the local focal mode (majority class) using the defined kernel
  var mode = imageYear
    .reduceNeighborhood({
      reducer: ee.Reducer.mode(),
      kernel: kernel
    })
    .rename(bandName)
    .reproject(projection);

  // Generate a boolean mask identifying Wetland pixels occurring on slopes steeper than the threshold
  var wetlandOnSteepSlope = imageYear
    .eq(wetlandClass)
    .and(slopePercent.gte(wetlandSlopeThreshold));

  // Generate a mask for unstable Water (shadows) on steep slopes, applying the historical vegetation condition
  var waterOnSteepSlope = imageYear
    .eq(waterClass)
    .and(slopePercent.gte(waterSlopeThreshold))
    .and(vegetationAtLeastTwoYears);
    
  // Generate a secondary unconditional mask for Water pixels on extremely steep slopes (>= 40%) regardless of history
  var waterOnSteepSlope_2nd = imageYear
    .eq(waterClass)
    .and(slopePercent.gte(40));
    
  // Generate a boolean mask identifying Mosaic pixels occurring on slopes steeper than the threshold
  var mosaicOnVerySteepSlope = imageYear
    .eq(mosaicClass)
    .and(slopePercent.gte(mosaicSlopeThreshold));

  // Apply the correction rules: replace anomalous water/wetland with Forest, and extreme steep mosaics with local mode
  var filteredYear = imageYear
    .where(wetlandOnSteepSlope, forestClass)
    .where(waterOnSteepSlope, forestClass)
    .where(waterOnSteepSlope_2nd, forestClass)
    .where(mosaicOnVerySteepSlope, mode)
    .rename(bandName)
    .byte();
    
  // Append the corrected annual band to the cumulative multi-band image
  return ee.Image(accumulatedImage)
    .addBands(filteredYear);
};

// Iterate the topographic filter function across all annual band names sequentially
var filtered = ee.Image(
  bandNames.iterate(applyTopographicFilter, initialImage)
);

// Embed processing metadata attributes
filtered = filtered.set({
  'filter': '08_topographic',
  'input_asset': inputFile,
  'input_version': inputVersion,
  'output_version': outputVersion
});

// Create a diagnostic layer showing pixels that were corrected from Water to Forest 
// based on the steep slope + historical vegetation rule
var correctedWaterCandidate = classificationStack
  .eq(waterClass)
  .and(slopePercent.gte(waterSlopeThreshold))
  .and(vegetationAtLeastTwoYears)
  .reduce(ee.Reducer.anyNonZero())
  .selfMask();

// Print the output classification to the console for tracking
print('Output classification', filtered);

// Render the diagnostic terrain slope percent map to the display
Map.addLayer(slopePercent, { min: 0, max: 50, palette: ['577590', '43aa8b', '90be6d', 'f9c74f', 'f8961e', 'f3722c', 'f94144'] }, 'Slope percent', false);

// Render the historical vegetation frequency map to the display
Map.addLayer(vegetationCount, { min: 0, max: 9, palette: ['ffffff', 'd9f0a3', 'addd8e', '78c679', '31a354', '006837'] }, 'Vegetation count', false);

// Render the targeted anomalous water correction candidates map to the display
Map.addLayer(correctedWaterCandidate, { min: 1, max: 1, palette: ['ff00ff'] }, 'Water correction candidates', false);

// Render the finalized, topographically corrected classification map to the display
Map.addLayer(filtered, vis, 'Output classification');

// Export as GEE asset
Export.image.toAsset({
  image: filtered,
  description: inputFile + '_tp_v' + outputVersion,
  assetId: out + inputFile + '_tp_v' + outputVersion,
  pyramidingPolicy: {'.default': 'mode'},
  region: classificationInput.geometry(),
  scale: 10,
  maxPixels: 1e13
});
