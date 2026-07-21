// -- -- -- -- 09) Spatial Temporal Transitions
// This script applies a combined temporal (3-year window) and spatial filter 
// to remove small, spurious A-B-A class transitions. It groups LULC classes 
// into broad categories (Native, Anthropic, Other) to evaluate consistency. 
// If a pixel toggles classes back and forth within 3 years and forms a small 
// spatial patch, it is corrected to match its previous stable state.


// Define visualization parameters
var vis = {
  min: 0,
  max: 75,
  palette: require('users/mapbiomas/modules:Palettes.js').get('brazil'),
  bands: 'classification_2018'
};

// Define the input version
var inputVersion = '2';

// Define the output version
var outputVersion = '5';

// Define the base directory
var root = 'projects/ee-ipam/assets/MAPBIOMAS/LULC/CERRADO_DEV/COL_11/LANDSAT/C11-POST-CLASSIFICATION/';
var out = 'projects/ee-ipam/assets/MAPBIOMAS/LULC/CERRADO_DEV/COL_11/LANDSAT/C11-POST-CLASSIFICATION/';

// Construct the base name of the input file
var inputFile = 'CERRADO_C11_gapfill_v17_spt_v2_tp_v' + inputVersion;

// Load the classification multi-band image
var classificationInput = ee.Image(root + inputFile);
print('Input classification', classificationInput);
Map.addLayer(classificationInput, vis, 'Input classification', false);

// Set the starting and ending year of the processing time-series
var startYear = 1985;
var endYear   = 2025;

// Set the maximum transition patch size in pixels (25 pixels at 10m scale is ~0.25 ha)
var maxPatchPixels = 6;

// Set the maximum connected-pixel search size for performance optimization
var connectedPixelMaxSize = 30;

// Set transition patch connectivity rule (true allows diagonal 8-neighbor connections)
var useDiagonalConnectivity = true;

// Define broad thematic group IDs for evaluating transitions
var anthropicGroup = 1; // Anthropic or non-vegetated
var nativeGroup = 2;    // Native vegetation
var otherGroup = 7;     // Water or other non-applicable classes

// Group specific LULC class IDs into the categories
var nativeClasses = [3, 4, 11, 12];
var anthropicClasses = [21, 25];
var otherClasses = [33, 27];

// Define a function to generate a client-side array of sequential years
var makeYearList = function(startYear, endYear) {
  // Initialize an empty array to store the generated years
  var years = [];
  // Loop from the start year to the end year, appending each integer to the array
  for (var year = startYear; year <= endYear; year++) { years.push(year); }
  // Return the fully populated array of years
  return years;
};

// Define a function to generate an array repeating a specific value a given number of times
var repeatValue = function(value, length) {
  // Initialize an empty array for the repeated values
  var list = [];
  // Loop up to the requested length, appending the given value each time
  for (var i = 0; i < length; i++) { list.push(value); }
  // Return the populated array
  return list;
};

// Define a function to consistently format band names based on the year
var getBandName = function(year) {
  // Concatenate the standard prefix with the year integer
  return 'classification_' + year;
};

// Generate the list of processing years
var years = makeYearList(startYear, endYear);

// Map over the years array to generate the standardized target band names
var bandNames = years.map(function(year) { return getBandName(year); });

// Concatenate all specific class IDs into a single flat array defining the original values
var originalClasses = nativeClasses.concat(anthropicClasses).concat(otherClasses);

// Construct a parallel array matching original classes to their corresponding thematic group IDs
var aggregatedClasses = repeatValue(nativeGroup, nativeClasses.length)
      .concat(repeatValue(anthropicGroup, anthropicClasses.length))
      .concat(repeatValue(otherGroup, otherClasses.length));

// Define a function to aggregate detailed classes into the broad thematic groups defined above
var aggregateClasses = function(image, outputName) {
  // Remap original classes to group IDs, rename the band, and cast to byte to save space
  return image.remap(originalClasses, aggregatedClasses, 0).rename(outputName).byte();
};

// Define the core function to apply the spatial-temporal transition filter to a single year
var applyTransitionFilter = function(year) {
  // Retrieve the standardized band name for the current iteration year
  var bandName = getBandName(year);
  // Extract the specific annual band from the multi-band classification input
  var current = classificationInput.select(bandName);

  // Skip filtering for edge years (first and last) as they lack a complete 3-year temporal window
  if (year === startYear || year === endYear) {
    // Return the unmodified band for edge years
    return current.rename(bandName).byte();
  }

// Extract the annual band corresponding to the previous year (T - 1)
  var previous = classificationInput.select(getBandName(year - 1));
  // Extract the annual band corresponding to the next year (T + 1)
  var next = classificationInput.select(getBandName(year + 1));

  // Convert the previous year's classes into broad thematic groups
  var previousGroup = aggregateClasses(previous, 'previous_group');
  // Convert the current year's classes into broad thematic groups
  var currentGroup = aggregateClasses(current, 'current_group');
  // Convert the next year's classes into broad thematic groups
  var nextGroup = aggregateClasses(next, 'next_group');

  // Create a mask ensuring all three years contain valid grouped classes (greater than 0)
  var validWindow = previousGroup.gt(0).and(currentGroup.gt(0)).and(nextGroup.gt(0));

  // Identify spurious transitions: previous equals next (A-B-A pattern), current differs from previous, and window is valid
  var spuriousTransition = previousGroup.eq(nextGroup).and(currentGroup.neq(previousGroup)).and(validWindow);

  // Create a unique 3-digit transition code by combining the grouped classes (e.g., 212 for Native-Anthropic-Native)
  var transitionCode = previousGroup.multiply(100).add(currentGroup.multiply(10)).add(nextGroup).rename('transition_code').toInt16();

  // Calculate the spatial patch size for the specific transition code, isolated by the spurious transition mask
  var transitionPatchSize = transitionCode.updateMask(spuriousTransition).connectedPixelCount(connectedPixelMaxSize, useDiagonalConnectivity);

  // Create a mask identifying transition patches that are smaller than or equal to the defined maximum pixel threshold
  var smallTransitionPatch = transitionPatchSize.lte(maxPatchPixels);

  // Combine conditions: pixels must be part of a spurious temporal transition AND form a small spatial patch
  var correctionMask = spuriousTransition.and(smallTransitionPatch);

  // Apply the correction: where the mask is true, replace the current class with the previous year's class
  var corrected = current.where(correctionMask, previous).rename(bandName).byte();

  // Return the temporally and spatially corrected annual band
  return corrected;
};

// Map the transition filter function over all years to process the entire time series
var correctedYears = years.map(applyTransitionFilter);

// Reconstruct the array of single-band images back into a unified multi-band image and apply the original band names
var filtered = ee.ImageCollection
  .fromImages(correctedYears)
  .toBands()
  .rename(bandNames);

// Embed processing metadata attributes
filtered = filtered.set({
  'filter': '09_spatial_temporal_transitions',
  'input_asset': inputFile,
  'input_version': inputVersion,
  'output_version': outputVersion,
});

// Render the final, transition-filtered classification map to the display
Map.addLayer(filtered, vis, 'Output classification');
print('Output classification', filtered);

// Export as GEE asset
Export.image.toAsset({
  image: filtered,
  description: inputFile + '_tra_v' + outputVersion,
  assetId: out + inputFile + '_tra_v' + outputVersion,
  pyramidingPolicy: {'.default': 'mode'},
  region: classificationInput.geometry(),
  scale: 30,
  maxPixels: 1e13
});
