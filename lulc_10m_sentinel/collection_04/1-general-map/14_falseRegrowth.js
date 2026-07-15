// -- -- -- -- 14) False Regrowth Filter
// This script applies sequential temporal filters to remove false native 
// vegetation regrowth signals in the annual LULC maps. It evaluates chronological 
// transitions and forces strict progression rules (e.g., blocking sudden 
// appearances of Wetlands, Sandbanks, or Savannas over farming areas) to ensure 
// temporal logic and stability.


// Define visualization parameters
var vis = {
    min: 0,
    max: 62,
    palette:require('users/mapbiomas/modules:Palettes.js').get('classification8'),
    bands: 'classification_2024'
};

// Define the input version
var inputVersion = '2';

// Define the output version
var outputVersion = '7';

// Define the base directory
var root = 'projects/ee-ipam/assets/MAPBIOMAS/LULC/CERRADO_DEV/COL_11/SENTINEL/C04-POST-CLASSIFICATION/';
var out = 'projects/ee-ipam/assets/MAPBIOMAS/LULC/CERRADO_DEV/COL_11/SENTINEL/C04-POST-CLASSIFICATION/';

// Construct the base name of the input file
var inputFile = 'CERRADO_C04_gapfill_v3_spt_v1_tp_v3_tra_v2_snv_v3_traj_v4_freq_v2_temp_v' + inputVersion;

// Load the classification multi-band image
var classificationInput = ee.Image(root + inputFile);
Map.addLayer(classificationInput, vis, 'Input classification');
print('Input classification', classificationInput);

// Initialize an active image variable to iteratively accumulate the corrected bands
var classificationOutput = classificationInput;

// Generate a sequential list of all years evaluated in the time series
var allYears = ee.List.sequence(2017, 2025).getInfo();

// Rule A: False Wetland Interruption & Consistency
// Iterate through the middle years to find and correct anomalous 11 -> 21 -> 11 sequences
for (var i = 1; i < allYears.length - 1; i++) {
  // Identify the target years for the moving 3-year window
  var yearPrev = allYears[i - 1];
  var yearCurr = allYears[i];
  var yearNext = allYears[i + 1];

  // Extract the corresponding annual bands from the actively updating classification image
  var prevBand = classificationOutput.select('classification_' + yearPrev);
  var currBand = classificationOutput.select('classification_' + yearCurr);
  var nextBand = classificationOutput.select('classification_' + yearNext);
  
  // Create a mask identifying false Wetland interruptions: previous is 11, current is 21, next is 11
  var condA = prevBand.eq(11)
              .and(currBand.eq(21))
              .and(nextBand.eq(11));

  // Correct the anomaly by changing the intermediate 21 to 12 
  var correctedA = currBand.where(condA, 12);

  // Overwrite the current year's band in the active image stack with the corrected version
  classificationOutput = classificationOutput.addBands(correctedA.rename('classification_' + yearCurr), null, true);
}

// Extract the classification band for the very first year
var firstBand = classificationOutput.select('classification_2017');
// Extract the classification band for the very last year
var lastBand = classificationOutput.select('classification_2025');

// Create a mask for pixels starting as Grassland (12) and ending as Wetland (11)
var condB = firstBand.eq(12).and(lastBand.eq(11));

// Iterate over all years in the time series to enforce Wetland consistency for these specific pixels
allYears.forEach(function(y) {
  // Extract the specific annual band
  var bandY = classificationOutput.select('classification_' + y);
  // Force the pixel to be Wetland (11) for the entire series if the edge condition is met
  var correctedB = bandY.where(condB, 11);
  // Overwrite the specific annual band in the active image stack
  classificationOutput = classificationOutput.addBands(correctedB.rename('classification_' + y), null, true);
});

// Render the results to the map display  
Map.addLayer(classificationOutput, vis, 'A: False wetland regeneration', false);

// Rule B: Prevent Abrupt Wetland Appearance
// Iterate forward through the time series to ensure Wetlands only appear if supported by history
for (var j = 1; j < allYears.length; j++) {
  // Identify the current and immediately preceding years
  var currentYearW = allYears[j];
  var previousYearW = allYears[j - 1];

  // Extract the respective annual bands
  var currentBandW = classificationOutput.select('classification_' + currentYearW);
  var previousBandW = classificationOutput.select('classification_' + previousYearW);

  // Identify invalid abrupt wetlands: current is 11, but previous is NOT 11
  var maskWetland = currentBandW.eq(11).and(previousBandW.neq(11));
  
  // Overwrite the abrupt Wetland with the class from the previous stable year
  var correctedBandW = currentBandW.where(maskWetland, previousBandW);

  // Overwrite the current year's band in the active image stack
  classificationOutput = classificationOutput.addBands(correctedBandW.rename('classification_' + currentYearW), null, true);
}

// Render the results to the map display  
Map.addLayer(classificationOutput, vis, 'B: No abrupt wetland', false);

// Rule C: Prevent Abrupt Sandbank Vegetation Appearance
// Iterate forward to ensure Sandbank Vegetation (50) does not appear without temporal continuity
for (var k = 1; k < allYears.length; k++) {
  // Identify the current and immediately preceding years
  var currentYearR = allYears[k];
  var previousYearR = allYears[k - 1];

  // Extract the respective annual bands
  var currentBandR = classificationOutput.select('classification_' + currentYearR);
  var previousBandR = classificationOutput.select('classification_' + previousYearR);

  // Identify invalid abrupt sandbanks: current is 50, but previous is NOT 50
  var maskRestinga = currentBandR.eq(50).and(previousBandR.neq(50));
  
  // Overwrite the abrupt Sandbank with the class from the previous year
  var correctedBandR = currentBandR.where(maskRestinga, previousBandR);
  
  // Overwrite the current year's band in the active image stack
  classificationOutput = classificationOutput.addBands(correctedBandR.rename('classification_' + currentYearR), null, true);
}

// Render the results to the map display  
Map.addLayer(classificationOutput, vis, 'C: Sandbank veg. adjustment', false);

// Rule D: Prevent Abrupt Savanna Over Farming
// Iterate forward to prevent Savanna (4) from abruptly replacing Mosaic of Uses (21)
for (var l = 1; l < allYears.length; l++) {
  // Identify the current and immediately preceding years
  var currentYearS = allYears[l];
  var previousYearS = allYears[l - 1];

  // Extract the respective annual bands
  var currentBandS = classificationOutput.select('classification_' + currentYearS);
  var previousBandS = classificationOutput.select('classification_' + previousYearS);

  // Identify invalid savanna regrowths: current is 4, but previous is 21
  var maskSavanna = currentBandS.eq(4).and(previousBandS.eq(21));
  
  // Overwrite the abrupt Savanna with the Mosaic of Uses from the previous year
  var correctedBandS = currentBandS.where(maskSavanna, previousBandS);
  
  // Overwrite the current year's band in the active image stack
  classificationOutput = classificationOutput.addBands(correctedBandS.rename('classification_' + currentYearS), null, true);
}

// Render the results to the map display  
Map.addLayer(classificationOutput, vis, 'D: Savanna adjustment', false);

// Rule E: Prevent Abrupt Grassland Appearance
// Iterate forward to ensure Grassland (12) only appears if supported by temporal history
for (var m = 1; m < allYears.length; m++) {
  // Identify the current and immediately preceding years
  var currentYearG = allYears[m];
  var previousYearG = allYears[m - 1];

  // Extract the respective annual bands
  var currentBandG = classificationOutput.select('classification_' + currentYearG);
  var previousBandG = classificationOutput.select('classification_' + previousYearG);

  // Identify invalid abrupt grasslands: current is 12, but previous is NOT 12
  var maskGrassland = currentBandG.eq(12).and(previousBandG.neq(12));
  
  // Overwrite the abrupt Grassland with the class from the previous year
  var correctedBandG = currentBandG.where(maskGrassland, previousBandG);
  
  // Overwrite the current year's band in the final active image stack
  classificationOutput = classificationOutput.addBands(correctedBandG.rename('classification_' + currentYearG), null, true);
}

// Render the results to the map display
Map.addLayer(classificationOutput, vis, 'E: Grassland adjustment');

// Print the resulting final filtered image structure to the console
print('Output classification', classificationOutput);

// Export as GEE asset
Export.image.toAsset({
    'image': classificationOutput,
    'description': inputFile + '_freg_v' + outputVersion,
    'assetId': out +  inputFile + '_freg_v' + outputVersion,
    'pyramidingPolicy': {'.default': 'mode'},
    'region':classificationOutput.geometry(),
    'scale': 10,
    'maxPixels': 1e13
});

