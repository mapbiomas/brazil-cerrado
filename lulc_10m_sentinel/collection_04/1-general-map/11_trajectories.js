// -- -- -- -- 11) Temporal Trajectory
// This script applies rule-based temporal trajectory filters to stabilize 
// specific LULC transitions in the Cerrado time series. It corrects spurious 
// intermediate states (e.g., Grassland acting as a false bridge 
// between Native Vegetation and Anthropic classes) and stabilizes erratic 
// sequences like 4 -> 12 -> 21 -> 4 into continuous stable states (4 -> 4 -> 4 -> 4).
// It also removes anomalous Non-Vegetated (25) blocks bounded by native vegetation.


// Define visualization parameters
var vis = {
  min: 0,
  max: 75,
  palette: require('users/mapbiomas/modules:Palettes.js').get('brazil'),
  bands: 'classification_2020'
};

// Define a binary visualization parameter set to highlight changed pixels (magenta)
var changeVis = { min: 1, max: 1, palette: ['ff00ff'] };

// Define the input version
var inputVersion = '3';

// Define the output version
var outputVersion = '4';

// Define the base directory
var root = 'projects/ee-ipam/assets/MAPBIOMAS/LULC/CERRADO_DEV/COL_11/SENTINEL/C04-POST-CLASSIFICATION/';
var out = 'projects/ee-ipam/assets/MAPBIOMAS/LULC/CERRADO_DEV/COL_11/SENTINEL/C04-POST-CLASSIFICATION/';

// Construct the base name of the input file
var inputFile = 'CERRADO_C04_gapfill_v3_spt_v1_tp_v3_tra_v2_snv_v' + inputVersion;

// Load the classification multi-band image
var classificationInput = ee.Image(root + inputFile);
print('Input classification', classificationInput);
Map.addLayer(classificationInput, vis, 'Input classification', false);

// Set the starting and ending year of the processing time-series
var startYear = 2017;
var endYear = 2025;

// Define specific LULC class IDs evaluated in the trajectory rules
var savannaClass = 4;
var grasslandClass = 12;
var mosaicClass = 21;
var nonVegetatedClass = 25;

// Define native vegetation context classes used by the one-year trajectory rule (excludes Class 12 being corrected)
var nativeClasses = [3, 4, 11, 50];

// Define native context classes restricted strictly to Forest and Savanna formations for short-block rules
var forestSavannaClasses = [3, 4];

// Define an extended list of native classes used to bound and correct anomalous Class 25 blocks
var nativeClassesFor25Rule = [3, 4, 11, 12, 50, 33];

// Define a function to generate a client-side array of sequential years
var makeYearList = function(startYear, endYear) {
  var years = [];
  for (var year = startYear; year <= endYear; year++) { years.push(year); }
  return years;
};

// Define a function to consistently format band names based on the given year
var getBandName = function(year) { return 'classification_' + year; };

// Generate the list of processing years
var years = makeYearList(startYear, endYear);

// Map over the years array to generate the standardized target band names
var bandNames = years.map(function(year) { return getBandName(year); });

// Extract the classification bands based on the generated band names
var classification = classificationInput.select(bandNames);

// Define a function to select a specific annual band from a multi-band image
var selectYear = function(image, year) { return image.select(getBandName(year)); };

// Define a helper function to create a boolean mask for a specific list of class values
var getClassMask = function(image, classList) {
  return image.remap(classList, ee.List.repeat(1, classList.length), 0).eq(1);
};

// Define a function to rebuild a complete multi-band stack by executing a rule function across all years
var buildAnnualStack = function(yearList, functionByYear) {
  // Map the rule function over the list of years and format the output bands
  var images = yearList.map(function(year) { return ee.Image(functionByYear(year)).rename(getBandName(year)).toInt16(); });
  // Convert the array of annual images back into a single multi-band image
  return ee.ImageCollection.fromImages(images).toBands().rename(bandNames);
};

// Define a function to map pixels that changed state between two iterations of the image
var changed = function(before, after) {
  // Identify pixels where the 'before' state is not equal to the 'after' state, reduce, and mask
  return before.neq(after).reduce(ee.Reducer.anyNonZero()).selfMask();
};

// Trajectory Rule Function
// Rule A: Correct sequence 4 -> 12 -> 21 -> 4 by converting the intermediate 12 and 21 classes to 4
var applySavanna12MosaicBetweenSavannaRule = function(image) {
  // Execute logic across all years to build the corrected stack
  return buildAnnualStack(years, function(year) {
    // Select the current year band
    var current = selectYear(image, year);
    // Initialize the corrected image state as the current state
    var corrected = current;

    // Correct the Grassland (12) anomaly within the sequence 4 -> 12 -> 21 -> 4
    if (year >= startYear + 1 && year <= endYear - 2) {
      // Isolate adjacent years to evaluate the temporal sequence relative to Class 12
      var previousFor12 = selectYear(image, year - 1);
      var nextFor12 = selectYear(image, year + 1);
      var nextFor12Second = selectYear(image, year + 2);

      // Define the boolean mask for the specific 4-12-21-4 anomaly centered on 12
      var class12InSequence = previousFor12.eq(savannaClass).and(current.eq(grasslandClass)).and(nextFor12.eq(mosaicClass)).and(nextFor12Second.eq(savannaClass));
      // Apply the correction: overwrite the current 12 with 4 where the sequence condition is met
      corrected = corrected.where(class12InSequence, savannaClass);
    }

    // Correct the Mosaic (21) anomaly within the sequence 4 -> 12 -> 21 -> 4
    if (year >= startYear + 2 && year <= endYear - 1) {
      // Isolate adjacent years to evaluate the temporal sequence relative to Class 21
      var previousFor21Second = selectYear(image, year - 2);
      var previousFor21 = selectYear(image, year - 1);
      var nextFor21 = selectYear(image, year + 1);

      // Define the boolean mask for the specific 4-12-21-4 anomaly centered on 21
      var class21InSequence = previousFor21Second.eq(savannaClass).and(previousFor21.eq(grasslandClass)).and(current.eq(mosaicClass)).and(nextFor21.eq(savannaClass));
      // Apply the correction: overwrite the current 21 with 4 where the sequence condition is met
      corrected = corrected.where(class21InSequence, savannaClass);
    }
    // Return the processed band for the current year
    return corrected;
  });
};


// Rule B: Correct unstable single-year Class 12 intermediate states between Native and Mosaic
var applyOneYearTrajectoryRule = function(image) {
  // Execute logic across all years to build the corrected stack
  return buildAnnualStack(years, function(year) {
    // Select the current year band
    var current = selectYear(image, year);
    // Skip processing for edge years to avoid temporal window out-of-bounds errors
    if (year === startYear || year === endYear) { return current; }

    // Retrieve previous and next year bands for evaluation
    var previous = selectYear(image, year - 1);
    var next = selectYear(image, year + 1);

    // Identify Native -> 12 -> 21 transitions
    var nativeToMosaic = getClassMask(previous, nativeClasses).and(current.eq(grasslandClass)).and(next.eq(mosaicClass));
    // Identify 21 -> 12 -> Native transitions
    var mosaicToNative = previous.eq(mosaicClass).and(current.eq(grasslandClass)).and(getClassMask(next, nativeClasses));
    // Identify 21 -> 12 -> 21 transitions
    var mosaicToMosaic = previous.eq(mosaicClass).and(current.eq(grasslandClass)).and(next.eq(mosaicClass));

    // Combine all unstable single-year Class 12 conditions into one correction mask
    var correctionMask = nativeToMosaic.or(mosaicToNative).or(mosaicToMosaic);
    // Apply correction: overwrite the intermediate 12 with the subsequent class (next)
    return current.where(correctionMask, next);
  });
};

// Rule C: Correct short, multi-year blocks of Class 12 immediately preceding consolidated Mosaic (21)
var applyShort12Before21Rule = function(image) {
  // Execute logic across all years to build the corrected stack
  return buildAnnualStack(years, function(year) {
    // Select the current year band
    var current = selectYear(image, year);
    // Initialize the corrected image state as the current state
    var corrected = current;

    // Correct single-year 12 block in Native -> 12 -> 21 -> 21 sequences
    if (year >= startYear + 1 && year <= endYear - 2) {
      // Isolate adjacent temporal bands
      var previousOneYear = selectYear(image, year - 1);
      var nextOneYear1 = selectYear(image, year + 1);
      var nextOneYear2 = selectYear(image, year + 2);

      // Define boolean mask for Native-12-21-21
      var oneYearBlock = current.eq(grasslandClass).and(getClassMask(previousOneYear, forestSavannaClasses)).and(nextOneYear1.eq(mosaicClass)).and(nextOneYear2.eq(mosaicClass));
      // Overwrite current 12 with 21
      corrected = corrected.where(oneYearBlock, mosaicClass);
    }

    // Correct the first year of a two-year 12 block: Native -> 12 -> 12 -> 21 -> 21
    if (year >= startYear + 1 && year <= endYear - 3) {
      // Isolate adjacent temporal bands
      var previousFirstYear = selectYear(image, year - 1);
      var nextFirstYear1 = selectYear(image, year + 1);
      var nextFirstYear2 = selectYear(image, year + 2);
      var nextFirstYear3 = selectYear(image, year + 3);

      // Define boolean mask for the first 12 in the block
      var firstYearOfBlock = current.eq(grasslandClass).and(getClassMask(previousFirstYear, forestSavannaClasses)).and(nextFirstYear1.eq(grasslandClass)).and(nextFirstYear2.eq(mosaicClass)).and(nextFirstYear3.eq(mosaicClass));
      // Overwrite current 12 with 21
      corrected = corrected.where(firstYearOfBlock, mosaicClass);
    }

    // Correct the second year of a two-year 12 block: Native -> 12 -> 12 -> 21 -> 21
    if (year >= startYear + 2 && year <= endYear - 2) {
      // Isolate adjacent temporal bands
      var previousSecondYear2 = selectYear(image, year - 2);
      var previousSecondYear1 = selectYear(image, year - 1);
      var nextSecondYear1 = selectYear(image, year + 1);
      var nextSecondYear2 = selectYear(image, year + 2);

      // Define boolean mask for the second 12 in the block
      var secondYearOfBlock = current.eq(grasslandClass).and(previousSecondYear1.eq(grasslandClass)).and(getClassMask(previousSecondYear2, forestSavannaClasses)).and(nextSecondYear1.eq(mosaicClass)).and(nextSecondYear2.eq(mosaicClass));
      // Overwrite current 12 with 21
      corrected = corrected.where(secondYearOfBlock, mosaicClass);
    }
    // Return the processed band
    return corrected;
  });
};

// Rule D: Correct spurious Class 12 tails occurring at the end of the time series after consolidated Mosaic (21)
var applyEndSeries12Rule = function(image) {
  // Define indices for the last four years of the series
  var yearA = endYear - 3;
  var yearB = endYear - 2;
  var yearC = endYear - 1;
  var yearD = endYear;

  // Extract the actual image bands for these trailing years
  var imageA = selectYear(image, yearA);
  var imageB = selectYear(image, yearB);
  var imageC = selectYear(image, yearC);
  var imageD = selectYear(image, yearD);

  // Define mask for a two-year 12 tail: 21 -> 21 -> 12 -> 12
  var twoYearTail = imageA.eq(mosaicClass).and(imageB.eq(mosaicClass)).and(imageC.eq(grasslandClass)).and(imageD.eq(grasslandClass));
  // Define mask for a one-year 12 tail: 21 -> 21 -> 21 -> 12
  var oneYearTail = imageA.eq(mosaicClass).and(imageB.eq(mosaicClass)).and(imageC.eq(mosaicClass)).and(imageD.eq(grasslandClass));

  // Execute logic across all years to build the corrected stack
  return buildAnnualStack(years, function(year) {
    // Select current year band
    var current = selectYear(image, year);

    // If processing the penultimate year, correct it if it matches the two-year tail pattern
    if (year === yearC) { return current.where(twoYearTail, mosaicClass); }
    // If processing the final year, correct it if it matches either tail pattern
    if (year === yearD) { return current.where(twoYearTail.or(oneYearTail), mosaicClass); }

    // Return the band unmodified if it is not one of the tail years
    return current;
  });
};

// Function to find the nearest previous class that is NOT Non-Vegetated (Class 25)
var getPreviousNon25Class = function(image, year) {
  // Initialize the placeholder image for the previous class
  var previousClass = ee.Image(0).rename('previous_non_25').toInt16();
  // Iterate forward from the start year up to the current year
  for (var y = startYear; y < year; y++) {
    // Select candidate year
    var candidate = selectYear(image, y);
    // Continually overwrite the previous class unless it is 25, ultimately leaving the closest non-25 class
    previousClass = previousClass.where(candidate.neq(nonVegetatedClass), candidate).rename('previous_non_25').toInt16();
  }
  return previousClass;
};

// Function to find the nearest subsequent class that is NOT Non-Vegetated (Class 25)
var getNextNon25Class = function(image, year) {
  // Initialize the placeholder image for the next class
  var nextClass = ee.Image(0).rename('next_non_25').toInt16();
  // Iterate backward from the end year down to the current year
  for (var y = endYear; y > year; y--) {
    // Select candidate year
    var candidate = selectYear(image, y);
    // Continually overwrite the next class unless it is 25, ultimately leaving the closest non-25 class
    nextClass = nextClass.where(candidate.neq(nonVegetatedClass), candidate).rename('next_non_25').toInt16();
  }
  return nextClass;
};

// Rule E: Correct anomalous blocks of Non-Vegetated (Class 25) flanked by native vegetation
var apply25BetweenNativeRule = function(image) {
  // Execute logic across all years to build the corrected stack
  return buildAnnualStack(years, function(year) {
    // Select the current year band
    var current = selectYear(image, year);
    // Skip processing for edge years
    if (year === startYear || year === endYear) { return current; }

    // Retrieve the closest prior non-25 class
    var previousNon25 = getPreviousNon25Class(image, year);
    // Retrieve the closest subsequent non-25 class
    var nextNon25 = getNextNon25Class(image, year);

    // Identify Class 25 pixels where both the previous and next stable states belong to native vegetation
    var class25BetweenNative = current.eq(nonVegetatedClass).and(getClassMask(previousNon25, nativeClassesFor25Rule)).and(getClassMask(nextNon25, nativeClassesFor25Rule));

    // Overwrite the anomalous 25 with the subsequent native class
    return current.where(class25BetweenNative, nextNon25);
  });
};

// Initialize the processing pipeline with the input classification stack
var outputClassification = classification;

// Execute Rule A: Correct 4 -> 12 -> 21 -> 4
var beforeA = outputClassification;
outputClassification = applySavanna12MosaicBetweenSavannaRule(outputClassification);
Map.addLayer(outputClassification, vis, 'Post Rule A', false);
Map.addLayer(changed(beforeA, outputClassification), changeVis, 'Changed by Post A', false);

// Execute Rule B: Correct single-year Class 12 anomalies
var beforeB = outputClassification;
outputClassification = applyOneYearTrajectoryRule(outputClassification);
Map.addLayer(outputClassification, vis, 'Post Rule B', false);
Map.addLayer(changed(beforeB, outputClassification), changeVis, 'Changed by Post B', false);

// Execute Rule C: Correct short blocks of Class 12 before Mosaic
var beforeC = outputClassification;
outputClassification = applyShort12Before21Rule(outputClassification);
Map.addLayer(outputClassification, vis, 'Post Rule C', false);
Map.addLayer(changed(beforeC, outputClassification), changeVis, 'Changed by Post C', false);

// Execute Rule D: Correct end-series Class 12 tails
var beforeD = outputClassification;
outputClassification = applyEndSeries12Rule(outputClassification);
Map.addLayer(outputClassification, vis, 'Post Rule D', false);
Map.addLayer(changed(beforeD, outputClassification), changeVis, 'Changed by Post D', false);

// Execute Rule E: Correct anomalous Class 25 bounded by native vegetation
var beforeE = outputClassification;
outputClassification = apply25BetweenNativeRule(outputClassification);
Map.addLayer(outputClassification, vis, 'Post Rule E', false);
Map.addLayer(changed(beforeE, outputClassification), changeVis, 'Changed by Post E', false);

// Ensure proper band naming
outputClassification = outputClassification
  .rename(bandNames)
  .toInt16()
  .set({
    'filter': '11_trajectories',
    'input_asset': inputFile,
    'input_version': inputVersion,
    'output_version': outputVersion
  });
  
// Render the fully corrected final output to the map
Map.addLayer(outputClassification, vis, 'Output classification');
print('Output classification', outputClassification);

// Export as GEE asset
Export.image.toAsset({
  image: outputClassification,
  description: inputFile + '_traj_v' + outputVersion,
  assetId: out + inputFile + '_traj_v' + outputVersion,
  pyramidingPolicy: {'.default': 'mode'},
  region: classificationInput.geometry(),
  scale: 10,
  maxPixels: 1e13
});
