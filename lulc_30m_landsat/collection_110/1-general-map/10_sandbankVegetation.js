// -- -- -- -- 10) Sandbank Vegetation Filter
// This script applies a post-processing filter to correct herbaceous sandbank 
// vegetation (restinga herbácea) within coastal areas. It integrates a soil vector mask 
// of coastal sandy deposits with the historical frequency of Grassland (Class 12) 
// derived from Landsat-based MapBiomas GTB classifications.


// Define visualization parameters
var vis = {
  min: 0,
  max: 75,
  palette: require('users/mapbiomas/modules:Palettes.js').get('brazil'),
  bands: 'classification_2020'
};

// Define a binary visualization parameter set for diagnostic masks
var maskVis = { min: 0, max: 1, palette: ['ffffff', 'ff00ff'] };

// Define the input version
var inputVersion = '2';

// Define the output version
var outputVersion = '3';

// Define the base directory
var root = 'projects/ee-ipam/assets/MAPBIOMAS/LULC/CERRADO_DEV/COL_11/SENTINEL/C04-POST-CLASSIFICATION/';
var out = 'projects/ee-ipam/assets/MAPBIOMAS/LULC/CERRADO_DEV/COL_11/SENTINEL/C04-POST-CLASSIFICATION/';

// Construct the base name of the input file
var inputFile = 'CERRADO_C04_gapfill_v3_spt_v1_tp_v3_tra_v' + inputVersion;

// Load the classification multi-band image
var classificationInput = ee.Image(root + inputFile);
print('Input classification', classificationInput);
Map.addLayer(classificationInput, vis, 'Input classification', false);

// Set the starting and ending year of the processing time-series
var startYear = 2017;
var endYear = 2025;

// Set the high-frequency temporal threshold above which pixels are remapped to Herbaceous Sandbank
var highFrequencyThreshold = 0.80;
// Set the minimum threshold for medium-frequency Grassland occurrence
var mediumFrequencyMin = 0.10;
// Set the maximum threshold for medium-frequency Grassland occurrence
var mediumFrequencyMax = 0.80;

// Define an array of annual classes eligible to be reclassified by the sandbank rules
var eligibleClasses = [4, 11, 12, 21, 33];

// Define target output class codes
var grasslandClass = 12;
var herbaceousSandbankClass = 50;

// Extract the native projection properties from the first band of the input classification
var referenceProjection = classificationInput.select(0).projection();

// Load the coastal sandy deposits vector dataset from CPRM/SGB (Brazilian Geological Service)
var soilVector = ee.FeatureCollection('projects/barbaracosta-ipam/assets/base/CPRM_coastal_deposits_v4');

// Paint the vector boundaries into a binary 10m raster matching the classification's projection and clip it
var soilMask = ee.Image(0).byte().paint({ featureCollection: soilVector, color: 1 })
                  .rename('soil_mask')
                  .reproject({ crs: referenceProjection, scale: 10 })
                  .clip(classificationInput.geometry()).unmask(0).byte();

// Add the rasterized coastal sandy deposits mask to the map display
Map.addLayer(soilMask.selfMask(), {palette: ['yellow']}, 'Coastal sandy deposits mask', false);

// Define the asset ID for the GTB reference Landsat-based classification
var gtbAsset = 'projects/ee-ipam/assets/MAPBIOMAS/LULC/CERRADO_DEV/COL_11/LANDSAT/C11-POST-CLASSIFICATION/CERRADO_C11_gapfill_v21';

// Load the GTB classification image
var gtbClassification = ee.Image(gtbAsset);

// Print the loaded GTB reference classification metadata to the console
print('GTB classification', gtbClassification);

// Define a function to generate a client-side array of sequential years
var makeYearList = function(startYear, endYear) {
  var years = [];
  for (var year = startYear; year <= endYear; year++) { years.push(year); }
  return years;
};

// Generate the list of processing years
var years = makeYearList(startYear, endYear);

// Define a function to consistently format band names based on the year
var getBandName = function(year) { return 'classification_' + year; };

// Map over the years array to generate the standardized target band names
var bandNames = years.map(function(year) { return getBandName(year); });

// Select only the matching temporal bands from the GTB reference dataset
var gtbSeries = gtbClassification.select(bandNames);

// Print the selected GTB temporal subset metadata to the console
print('Selected GTB series', gtbSeries);

// Create a temporal binary image stack flagging where the GTB reference was classified as Grassland (Class 12)
var gtbClass12Binary = gtbSeries.eq(grasslandClass);

// Sum the boolean stack across the time series to count total years classified as Grassland per pixel
var class12Count = gtbClass12Binary.reduce(ee.Reducer.sum()).rename('gtb_12_count');

// Count total valid (non-masked) GTB observations per pixel across the temporal series
var validCount = gtbSeries.mask().reduce(ee.Reducer.sum()).rename('gtb_valid_count');

// Calculate the temporal frequency of Grassland class occurrence (years present / valid observations)
var class12Frequency = class12Count.divide(validCount).updateMask(validCount.gt(0)).rename('gtb_12_frequency');

// Create a mask isolating pixels with high Grassland frequency (above 80%) in the GTB record
var gtb12HighFrequencyMask = class12Frequency.gt(highFrequencyThreshold).rename('gtb_12_high_frequency').byte();

// Create a mask isolating pixels with medium Grassland frequency (between 10% and 80%) in the GTB record
var gtb12MediumFrequencyMask = class12Frequency.gte(mediumFrequencyMin).and(class12Frequency.lte(mediumFrequencyMax)).rename('gtb_12_medium_frequency').byte();

// Intersect the high-frequency GTB mask with the CPRM sandy soil mask to generate the high-frequency Herbaceous sandbank mask
var herbaceousHighFrequencyMask = gtb12HighFrequencyMask.and(soilMask.eq(1)).rename('herbaceous_high_frequency_mask').byte();

// Intersect the medium-frequency GTB mask with the CPRM sandy soil mask to generate the medium-frequency Herbaceous sandbank mask
var herbaceousMediumFrequencyMask = gtb12MediumFrequencyMask.and(soilMask.eq(1)).rename('herbaceous_medium_frequency_mask').byte();

// Define a helper function to create a boolean mask for a specific list of class values
var getClassMask = function(image, classList) {
  return image.remap(classList, ee.List.repeat(1, classList.length), 0).eq(1);
};

// Define the function to apply sandbank corrections to a single annual band
var applySandbankCorrection = function(year) {
  // Retrieve the standardized band name for the current iteration year
  var bandName = getBandName(year);
  // Extract the specific annual band from the multi-band classification input
  var currentClass = classificationInput.select(bandName);

  // Generate a mask isolating pixels whose current annual class is eligible for correction
  var eligibleMask = getClassMask(currentClass, eligibleClasses);

  // Intersect the medium-frequency spatial mask with the current eligibility mask
  var applyMediumFrequencyCorrection = herbaceousMediumFrequencyMask.eq(1).and(eligibleMask);

  // Intersect the high-frequency spatial mask with the current eligibility mask
  var applyHighFrequencyCorrection = herbaceousHighFrequencyMask.eq(1).and(eligibleMask);

  // Apply the rules: convert medium frequency pixels to Grassland, and high frequency to Herbaceous Sandbank
  var corrected = currentClass.where(applyMediumFrequencyCorrection, grasslandClass).where(applyHighFrequencyCorrection, herbaceousSandbankClass).rename(bandName).byte();

  // Return the corrected annual band
  return corrected;
};

// Map the sandbank correction function over all years to process the entire time series
var correctedBands = years.map(applySandbankCorrection);

// Reconstruct the array of corrected single-band images back into a unified multi-band image
var finalClassification = ee.ImageCollection
  .fromImages(correctedBands)
  .toBands()
  .rename(bandNames)
  .set({
    'filter': '10_sandbank_vegetation',
    'input_asset': inputFile,
    'input_version': inputVersion,
    'output_version': outputVersion,
    'gtb_asset': gtbAsset,
  });

// Print the resulting final filtered classification structure to the console
print('Final classification', finalClassification);

// Render diagnostic layers to help assess GTB frequency performance
Map.addLayer(class12Frequency, {min: 0, max: 1, palette: ['ffffff', 'ffff00', 'ff00ff']}, 'GTB class 12 frequency', false);
Map.addLayer(gtb12HighFrequencyMask.selfMask(), {palette: ['magenta']}, 'GTB class 12 high frequency', false);
Map.addLayer(gtb12MediumFrequencyMask.selfMask(), {palette: ['orange']}, 'GTB class 12 medium frequency', false);

// Render the final combined spatial templates used for actual correction
Map.addLayer(herbaceousHighFrequencyMask.selfMask(), {palette: ['cyan']}, 'High-frequency Herbaceous mask', false);
Map.addLayer(herbaceousMediumFrequencyMask.selfMask(), {palette: ['orange']}, 'Medium-frequency Herbaceous mask', false);

// Render the finalized classification map to the display
Map.addLayer(finalClassification, vis, 'Final classification');

// Export as GEE asset
Export.image.toAsset({
  image: finalClassification,
  description: inputFile + '_snv_v' + outputVersion,
  assetId: out + inputFile + '_snv_v' + outputVersion,
  pyramidingPolicy: {
    '.default': 'mode'
  },
  region: classificationInput.geometry(),
  scale: 10,
  maxPixels: 1e13
});
