// -- -- -- -- 12) Frequency
// This script applies a temporal frequency filter to stabilize native vegetation 
// classes in the Cerrado LULC time series. It evaluates the historical frequency 
// of each native class over the entire period (2017-2025). 
// If a pixel is highly stable as native vegetation overall (>95%) but fluctuates 
// between specific native classes (e.g., Forest vs. Savanna) without persisting 
// in a new state for at least three consecutive years, the script forces the 
// pixel to its dominant stable native class based on predefined hierarchical 
// frequency thresholds.


// Define visualization parameters
var vis = {
  min: 0,
  max: 75,
  palette: require('users/mapbiomas/modules:Palettes.js').get('brazil'),
  bands: 'classification_2020'
};

// Define the input version
var inputVersion = '4';

// Define the output version
var outputVersion = '2';

// Define the base directory
var root = 'projects/ee-ipam/assets/MAPBIOMAS/LULC/CERRADO_DEV/COL_11/SENTINEL/C04-POST-CLASSIFICATION/';
var out = 'projects/ee-ipam/assets/MAPBIOMAS/LULC/CERRADO_DEV/COL_11/SENTINEL/C04-POST-CLASSIFICATION/';

// Construct the base name of the input file
var inputFile = 'CERRADO_C04_gapfill_v3_spt_v1_tp_v3_tra_v2_snv_v3_traj_v' + inputVersion;

// Load the classification multi-band image
var classificationInput = ee.Image(root + inputFile);
print('Input classification', classificationInput);
Map.addLayer(classificationInput, vis, 'Input classification', false);

// Set the starting and ending year of the processing time-series
var startYear = 2017;
var endYear = 2025;

// Define an array of native vegetation class IDs targeted for stabilization
var nativeClasses = [3, 4, 11, 12, 50];

// Define specific numeric IDs for the targeted native vegetation classes
var forestClass = 3;
var savannaClass = 4;
var wetlandClass = 11;
var grasslandClass = 12;
var sandbankClass = 50;

// Set the overall minimum temporal frequency (%) required for a pixel to be considered stable native vegetation
var stableNativeThreshold = 95;

// Set the specific frequency threshold (%) required
var savannaThreshold = 60;    // Savanna > 60%   (~5 years)
var sandbankThreshold = 50;   // Sandbank >= 50% (~4 years)
var grasslandThreshold = 40;  // Grassland > 40% (~3 years)
var wetlandThreshold = 95;    // Wetland >= 95%  (~8 years)
var forestThreshold = 70;     // Forest >= 70%   (~6 years)

// Define a function to generate a client-side array of sequential years
var makeYearList = function(startYear, endYear) {
  var years = [];
  for (var year = startYear; year <= endYear; year++) { years.push(year); }
  return years;
};

// Define a function to consistently format band names based on the given year
var getBandName = function(year) { return 'classification_' + year; };

// Define a helper function to create a boolean mask for a specific list of class values
var getClassMask = function(image, classList) {
  return image.remap(classList, ee.List.repeat(1, classList.length), 0).eq(1);
};

// Define a function to select a specific annual band from a multi-band image
var selectYear = function(image, year) { return image.select(getBandName(year)); };

// Define a function to rebuild a complete multi-band stack by executing a rule function across all years
var buildAnnualStack = function(yearList, functionByYear) {
  // Map the rule function over the list of years and format the output bands as bytes
  var images = yearList.map(function(year) { return ee.Image(functionByYear(year)).rename(getBandName(year)).byte(); });
  // Generate the target array of standard band names
  var names = yearList.map(function(year) { return getBandName(year); });
  // Convert the array of annual images back into a single multi-band image and rename bands
  return ee.ImageCollection.fromImages(images).toBands().rename(names);
};

// Define a function to calculate the temporal frequency of a specific class over the valid time series
var getClassFrequency = function(image, classId, validCount) {
  // Count how many times the class appears across all bands (years) for each pixel
  var classCount = image.eq(classId).unmask(0).reduce(ee.Reducer.sum());
  // Divide by total valid observations, multiply to get percentage, and rename the output band
  return classCount.divide(validCount).multiply(100).rename('freq_' + classId);
};

// Generate the list of processing years
var years = makeYearList(startYear, endYear);

// Map over the years array to generate the standardized target band names
var bandNames = years.map(function(year) { return getBandName(year); });

// Extract only the relevant annual classification bands from the input image
var classification = classificationInput.select(bandNames);

// Calculate the total number of valid (non-masked) observations per pixel in the time series
var validCount = classification.mask().reduce(ee.Reducer.sum()).rename('valid_count');

// Calculate native class frequencies
var forestFrequency = getClassFrequency(classification, forestClass, validCount);
var savannaFrequency = getClassFrequency(classification, savannaClass, validCount);
var wetlandFrequency = getClassFrequency(classification, wetlandClass, validCount);
var grasslandFrequency = getClassFrequency(classification, grasslandClass, validCount);
var sandbankFrequency = getClassFrequency(classification, sandbankClass, validCount);

// Calculate the combined frequency of all native vegetation classes
var nativeFrequency = forestFrequency
  .add(savannaFrequency)
  .add(wetlandFrequency)
  .add(grasslandFrequency)
  .add(sandbankFrequency)
  .rename('native_frequency');

// Create a mask for pixels strictly dominated by native vegetation throughout the time series
var stableNativeMask = nativeFrequency
  .gte(stableNativeThreshold)
  .updateMask(validCount.gt(0))
  .rename('stable_native')
  .byte();

// Hierarchically assign the dominant stable native class based on predefined frequency thresholds
// Later rules overwrite previous ones when more than one threshold is met
var stableNativeClass = ee.Image(0)
  .where(stableNativeMask.eq(1).and(savannaFrequency.gt(savannaThreshold)), savannaClass)
  .where(stableNativeMask.eq(1).and(sandbankFrequency.gte(sandbankThreshold)), sandbankClass)
  .where(stableNativeMask.eq(1).and(grasslandFrequency.gt(grasslandThreshold)), grasslandClass)
  .where(stableNativeMask.eq(1).and(wetlandFrequency.gte(wetlandThreshold)), wetlandClass)
  .where(stableNativeMask.eq(1).and(forestFrequency.gte(forestThreshold)), forestClass)
  .updateMask(validCount.gt(0))
  .rename('stable_native_class')
  .byte();

// Mask out pixels that did not meet any stable native class thresholds
stableNativeClass = stableNativeClass.updateMask(stableNativeClass.neq(0));

// Define a function to identify native classes that persist for at least three consecutive years around a given year
var getPersistentNativeMask = function(image, year, current) {
  // Initialize an empty boolean image to accumulate persistent pixels
  var persistent = ee.Image(0);

  // Check backward persistence: evaluate the window [previous-previous, previous, current]
  if (year >= startYear + 2) {
    var previous1 = selectYear(image, year - 1);
    var previous2 = selectYear(image, year - 2);
    
    // Flag pixels where the class remained identical for these three years
    var previousWindow = current
      .eq(previous1)
      .and(current.eq(previous2));
    persistent = persistent.or(previousWindow);
  }

  // Check centered persistence: evaluate the window [previous, current, next]
  if (year >= startYear + 1 && year <= endYear - 1) {
    var previous = selectYear(image, year - 1);
    var next = selectYear(image, year + 1);
    
    // Flag pixels where the class remained identical for these three years
    var centeredWindow = current
      .eq(previous)
      .and(current.eq(next));

    persistent = persistent.or(centeredWindow);
  }

  // Check forward persistence: evaluate the window [current, next, next-next]
  if (year <= endYear - 2) {
    var next1 = selectYear(image, year + 1);
    var next2 = selectYear(image, year + 2);
    
    // Flag pixels where the class remained identical for these three years
    var nextWindow = current
      .eq(next1)
      .and(current.eq(next2));

    persistent = persistent.or(nextWindow);
  }
  
  // Ensure the identified persistent pixels actually belong to the native classes list
  return persistent
    .and(getClassMask(current, nativeClasses));
};

// Define the core function to apply the frequency filter to a single annual band
var applyFrequencyFilter = function(year) {
  // Retrieve the standardized band name for the current iteration year
  var bandName = getBandName(year);
  
  // Extract the specific annual band from the multi-band classification
  var current = selectYear(classification, year);

  // Generate a boolean mask confirming if the current pixel is a native class
  var currentIsNative = getClassMask(current, nativeClasses);

  // Evaluate if the current native pixel is part of a stable 3-year temporal block
  var persistentNative = getPersistentNativeMask(classification, year, current);

  // Define the correction mask
  // Correct only if the pixel has a stable native class assigned, is currently a native class, but is NOT persistent
  var applyFilter = stableNativeClass
    .mask()
    .and(currentIsNative)
    .and(persistentNative.not());

  // Apply the correction: overwrite unstable native pixels with their historically dominant stable class
  var corrected = current
    .where(applyFilter, stableNativeClass)
    .rename(bandName)
    .byte();

  return corrected;
};

// Execute the frequency filter across all years and rebuild the multi-band stack
var filtered = buildAnnualStack(years, applyFrequencyFilter);

// Embed processing metadata attributes
filtered = filtered.set({
  'filter': '12_frequency',
  'input_asset': inputFile,
  'input_version': inputVersion,
  'output_version': outputVersion,
});

// Render diagnostic layers
Map.addLayer(stableNativeMask.selfMask(), {}, 'Stable native mask', false);
Map.addLayer(nativeFrequency, {min: 0, max: 100, palette: ['ffffff', 'ffff00', '008000']}, 'Native frequency', false);
Map.addLayer(stableNativeClass, {min: 3, max: 50}, 'Stable native class', false);

// Render the final classification map
Map.addLayer(filtered, vis, 'Output classification');

// Print the resulting final filtered image structure to the console
print('Output classification', filtered);

// Export as GEE asset
Export.image.toAsset({
  image: filtered,
  description: inputFile + '_freq_v' + outputVersion,
  assetId: out + inputFile + '_freq_v' + outputVersion,
  pyramidingPolicy: {
    '.default': 'mode'
  },
  region: classificationInput.geometry(),
  scale: 10,
  maxPixels: 1e13
});

