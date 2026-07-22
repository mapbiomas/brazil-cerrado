// -- -- -- -- 11) Temporal Trajectory
// Stabilizes specific Land Use and Land Cover (LULC) trajectories in the 
// Cerrado time series. It primarily targets Class 12 (Grassland) which often 
// appears as an unstable intermediate classification state during the transition 
// between native vegetation and anthropic classes (Mosaic of Uses - 21). 
// It also cleans up false Non-Vegetated (25) gaps within native areas.


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
var root = 'projects/ee-ipam/assets/MAPBIOMAS/LULC/CERRADO_DEV/COL_11/LANDSAT/C11-POST-CLASSIFICATION/';
var out = 'projects/ee-ipam/assets/MAPBIOMAS/LULC/CERRADO_DEV/COL_11/LANDSAT/C11-POST-CLASSIFICATION/';

// Construct the base name of the input file
var inputFile = 'CERRADO_C11_gapfill_v17_spt_v2_tp_v2_tra_v5_snv_v' + inputVersion;

// Load the classification multi-band image
var classificationInput = ee.Image(root + inputFile);
print('Input classification', classificationInput);
Map.addLayer(classificationInput, vis, 'Input classification', false);

// Set the starting and ending year of the processing time-series
var startYear = 1985;
var endYear = 2025;

// Define specific LULC class IDs evaluated in the trajectory rules
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
// Rule A: Function to correct single-year Class 12 (Grassland) anomalies
// Fixes rapid 1-year oscillation states (e.g., Native -> 12 -> 21)
var applyOneYearTrajectoryRule = function(image) {

  return buildAnnualStack(years, function(year) {

    var current = selectYear(image, year);

    // Skip edge years (first and last) as they lack a full t-1 / t+1 context
    if (year === startYear || year === endYear) {
      return current;
    }

    // Extract temporal neighborhood (previous and next years)
    var previous = selectYear(image, year - 1);
    var next = selectYear(image, year + 1);

    // Condition 1: Correct Native -> 12 -> 21 (Deforestation transition artifact)
    var nativeToMosaic = getClassMask(previous, nativeClasses)
      .and(current.eq(grasslandClass))
      .and(next.eq(mosaicClass));

    // Condition 2: Correct 21 -> 12 -> Native (Regeneration transition artifact)
    var mosaicToNative = previous.eq(mosaicClass)
      .and(current.eq(grasslandClass))
      .and(getClassMask(next, nativeClasses));

    // Condition 3: Correct 21 -> 12 -> 21 (Instability within anthropic use)
    var mosaicToMosaic = previous.eq(mosaicClass)
      .and(current.eq(grasslandClass))
      .and(next.eq(mosaicClass));

    // Combine all single-year artifact conditions into one correction mask
    var correctionMask = nativeToMosaic
      .or(mosaicToNative)
      .or(mosaicToMosaic);

    // Replace the current Class 12 pixel with the NEXT year's value to smooth the trajectory
    return current.where(correctionMask, next);
  });
};


// Rule B: Function to correct short (1 or 2 years) blocks of Class 12 
// appearing right before a consolidated Class 21 (Mosaic) period.
var applyShort12Before21Rule = function(image) {

  return buildAnnualStack(years, function(year) {

    var current = selectYear(image, year);
    var corrected = current;

    // Pattern 1: Correct 1-year block (Native -> 12 -> 21 -> 21)
    if (year >= startYear + 1 && year <= endYear - 2) {
      var previousOneYear = selectYear(image, year - 1);
      var nextOneYear1 = selectYear(image, year + 1);
      var nextOneYear2 = selectYear(image, year + 2);

      var oneYearBlock = current.eq(grasslandClass)
        .and(getClassMask(previousOneYear, forestSavannaClasses))
        .and(nextOneYear1.eq(mosaicClass))
        .and(nextOneYear2.eq(mosaicClass));

      corrected = corrected.where(oneYearBlock, mosaicClass);
    }

    // Pattern 2: Correct the FIRST year of a 2-year block (Native -> [12] -> 12 -> 21 -> 21)
    if (year >= startYear + 1 && year <= endYear - 3) {
      var previousFirstYear = selectYear(image, year - 1);
      var nextFirstYear1 = selectYear(image, year + 1);
      var nextFirstYear2 = selectYear(image, year + 2);
      var nextFirstYear3 = selectYear(image, year + 3);

      var firstYearOfBlock = current.eq(grasslandClass)
        .and(getClassMask(previousFirstYear, forestSavannaClasses))
        .and(nextFirstYear1.eq(grasslandClass))
        .and(nextFirstYear2.eq(mosaicClass))
        .and(nextFirstYear3.eq(mosaicClass));

      corrected = corrected.where(firstYearOfBlock, mosaicClass);
    }

    // Pattern 3: Correct the SECOND year of a 2-year block (Native -> 12 -> [12] -> 21 -> 21)
    if (year >= startYear + 2 && year <= endYear - 2) {
      var previousSecondYear2 = selectYear(image, year - 2);
      var previousSecondYear1 = selectYear(image, year - 1);
      var nextSecondYear1 = selectYear(image, year + 1);
      var nextSecondYear2 = selectYear(image, year + 2);

      var secondYearOfBlock = current.eq(grasslandClass)
        .and(previousSecondYear1.eq(grasslandClass))
        .and(getClassMask(previousSecondYear2, forestSavannaClasses))
        .and(nextSecondYear1.eq(mosaicClass))
        .and(nextSecondYear2.eq(mosaicClass));

      corrected = corrected.where(secondYearOfBlock, mosaicClass);
    }

    return corrected;
  });
};

// Rule C: Function to correct end-of-series instability.
// Often, agricultural areas falsely classify as Class 12 in the very last years.
var applyEndSeries12Rule = function(image) {

  // Define the last 4 years of the series dynamically
  var yearA = endYear - 3;
  var yearB = endYear - 2;
  var yearC = endYear - 1;
  var yearD = endYear;

  var imageA = selectYear(image, yearA);
  var imageB = selectYear(image, yearB);
  var imageC = selectYear(image, yearC);
  var imageD = selectYear(image, yearD);

  // Pattern 1: Correct a 2-year tail (21 -> 21 -> [12] -> [12]) at series end
  var twoYearTail = imageA.eq(mosaicClass)
    .and(imageB.eq(mosaicClass))
    .and(imageC.eq(grasslandClass))
    .and(imageD.eq(grasslandClass));

  // Pattern 2: Correct a 1-year tail (21 -> 21 -> 21 -> [12]) at series end
  var oneYearTail = imageA.eq(mosaicClass)
    .and(imageB.eq(mosaicClass))
    .and(imageC.eq(mosaicClass))
    .and(imageD.eq(grasslandClass));

  return buildAnnualStack(years, function(year) {

    var current = selectYear(image, year);

    // Apply correction for the penultimate year (only affected by 2-year tail)
    if (year === yearC) {
      return current.where(twoYearTail, mosaicClass);
    }

    // Apply correction for the final year (affected by both 1-year and 2-year tails)
    if (year === yearD) {
      return current.where(twoYearTail.or(oneYearTail), mosaicClass);
    }

    return current;
  });
};

// Rule D: Temporal memory scanning for Class 25 correction
// Function to scan backwards to find the closest valid LULC class (ignoring 25)
var getPreviousNon25Class = function(image, year) {

  var previousClass = ee.Image(0)
    .rename('previous_non_25')
    .toInt16();

  for (var y = startYear; y < year; y++) {
    var candidate = selectYear(image, y);

    // Iteratively update with candidate pixel UNLESS candidate is 25
    previousClass = previousClass
      .where(candidate.neq(nonVegetatedClass), candidate)
      .rename('previous_non_25')
      .toInt16();
  }

  return previousClass;
};

// Function to scan forwards to find the closest valid LULC class (ignoring 25)
var getNextNon25Class = function(image, year) {

  var nextClass = ee.Image(0)
    .rename('next_non_25')
    .toInt16();

  for (var y = endYear; y > year; y--) {
    var candidate = selectYear(image, y);

    // Iteratively update backwards with candidate pixel UNLESS candidate is 25
    nextClass = nextClass
      .where(candidate.neq(nonVegetatedClass), candidate)
      .rename('next_non_25')
      .toInt16();
  }

  return nextClass;
};

// RULE E: Function to correct Class 25 (Non-Vegetated) classification errors
// where bare soil/rocks are mapped temporarily inside stable native vegetation.
var apply25BetweenNativeRule = function(image) {

  return buildAnnualStack(years, function(year) {

    var current = selectYear(image, year);

    if (year === startYear || year === endYear) {
      return current; // Skip edge years
    }

    // Scan backwards to find what class existed before the Class 25 interruption
    var previousNon25 = getPreviousNon25Class(image, year);

    // Scan forwards to find what class exists after the Class 25 interruption
    var nextNon25 = getNextNon25Class(image, year);

    // Mask pixels where current is 25, AND both previous and next valid states are Native
    var class25BetweenNative = current
      .eq(nonVegetatedClass)
      .and(getClassMask(previousNon25, nativeClassesFor25Rule))
      .and(getClassMask(nextNon25, nativeClassesFor25Rule));

    // Replace the spurious Class 25 with the NEXT valid native class
    return current.where(class25BetweenNative, nextNon25);
  });
};

// Initialize the output variable
var outputClassification = classification;

// Apply rule A
var beforeA = outputClassification;
outputClassification = applyOneYearTrajectoryRule(outputClassification);
Map.addLayer(outputClassification, vis, 'Post Rule A', false);

// Apply rule B
var beforeB = outputClassification;
outputClassification = applyShort12Before21Rule(outputClassification);
Map.addLayer(outputClassification, vis, 'Post Rule B', false);

// Apply rule C
var beforeC = outputClassification;
outputClassification = applyEndSeries12Rule(outputClassification);
Map.addLayer(outputClassification, vis, 'Post Rule C', false);

// Apply rule D
var beforeD = outputClassification;
outputClassification = apply25BetweenNativeRule(outputClassification);
Map.addLayer(outputClassification, vis, 'Post Rule D', false);

// Ensure proper band naming
outputClassification = outputClassification
  .rename(bandNames)
  .toInt16()
  .set({
    'filter': '11_trajectories',
    'input_asset': inputFile,
    'input_version': inputVersion,
    'output_version': outputVersion,
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
  scale: 30,
  maxPixels: 1e13
});
