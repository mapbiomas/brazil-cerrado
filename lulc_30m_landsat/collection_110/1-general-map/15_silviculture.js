// --- --- --- 15) Silviculture Filter
// Rapidly growing commercial plantations (e.g., Eucalyptus or Pine) are frequently 
// misclassified as native Forest Formation (Class 3) as the canopy closes. This 
// filter uses the temporal history of the pixel—specifically the recurrence, 
// dominance, or accumulated history of Mosaic of Uses (Class 21) to 
// identify and revert false Forest pixels to Class 21.


// Define visualization parameters
var vis = {
    min: 0,
    max: 75,
    palette:require('users/mapbiomas/modules:Palettes.js').get('brazil'),
    bands: 'classification_2017'
};

// Define the input version
var inputVersion = '44';

// Define the output version
var outputVersion = '11';

// Define the base directory
var root = 'projects/ee-ipam/assets/MAPBIOMAS/LULC/CERRADO_DEV/COL_11/LANDSAT/C11-POST-CLASSIFICATION/';
var out = 'projects/ee-ipam/assets/MAPBIOMAS/LULC/CERRADO_DEV/COL_11/LANDSAT/C11-POST-CLASSIFICATION/';

// Construct the base name of the input file
var inputFile = 'CERRADO_C11_gapfill_v17_spt_v2_tp_v2_tra_v5_snv_v3_traj_v4_freq_v5_temp_v11_freg_v' + inputVersion;

// Load the classification multi-band image
var inputClassification = ee.Image(root + inputFile);
print('Input classification', inputClassification);
Map.addLayer (inputClassification, vis, 'Input Classification');

// Set the starting and ending years 
var startYear = 1985;
var endYear = 2025;
var years = ee.List.sequence(startYear, endYear);

// Set native classes used for general contextual checks
var nativeIds = [3, 4, 11, 12, 50];

// Set standard moving-window silviculture rule parameters
// Looks back 15 years; requires at least 12 years of class 21 to flag false forest
var windowSize = 15;
var minFrequency21 = 12;
var firstFilterYear = startYear + windowSize;

// Set long class-21 block before Forest rule
// Flags areas starting with an 8-year block of mosaic of uses before turning into forest
var initial21Years = 8;

// Set recent Forest after long class-21 dominance rule
// Flags areas that were mostly mosaic of use until 2015 and suddenly became forest
var recentForestStart = 2016;
var preRecentEnd = 2015;
var minPreRecent21 = 26; // Requires strong historical mosaic of use dominance (26 out of 31 years)
var minRecentForest = 8; // Requires stable recent forest (8 out of 10 years)

// Remove class 3 after at least 15 previous occurrences of class 21
// If a pixel accumulates 15 years of class 21 in its entire history,
// it permanently loses the ability to be classified as native forest
var minPrevious21ForForestRemoval = 15;
var firstPrevious21RemovalYear = startYear + minPrevious21ForForestRemoval;

// Set end-of-series class-21 anchor -- 2024 or 2025 must be class 21
// Confirms silviculture harvest cycle at the end of the time series
var useOrFinal21 = true;

// Function to get annual band names formatted correctly
var getBand = function(year) {return ee.String('classification_').cat(ee.Number(year).format('%d'));};

// Set annual band names array
var bands = years.map(function(year) {return getBand(year);});

// Function to select one annual band from the image stack
var sel = function(img, year) {return img.select(getBand(year));};

// Function to rebuild a multiband image from annual outputs
var make = function(yearList, fn) {
  var imgs = yearList.map(function(year) {return ee.Image(fn(ee.Number(year))).rename('classification').toInt16();});

  var names = yearList.map(function(year) {return getBand(year);})

  return ee.ImageCollection.fromImages(imgs).toBands().rename(names);
};

// Function to create a mask for a list of classes
var inList = function(img, ids) {
  var mask = ee.Image(0);

  ids.forEach(function(id) {mask = mask.or(img.eq(id));});

  return mask;
};

// Function to identify native classes
var isNative = function(img) {
  return inList(img, nativeIds);
};

// Function to build the final class-21 anchor mask
// Ensures the pixel returned to an anthropic state recently
var getFinal21Mask = function(img) {
  var y2024 = sel(img, 2024);
  var y2025 = sel(img, 2025);

  if (useOrFinal21) {return y2024.eq(21).or(y2025.eq(21));}

  return y2024.eq(21).and(y2025.eq(21));
};

// Function to count class-21 years before a given year using a moving window
var countPrevious21 = function(img, year) {
  var previousYears = ee.List.sequence(year.subtract(windowSize), year.subtract(1));

  return make(previousYears, function(y) {
    return sel(img, y).eq(21);
  }).reduce(ee.Reducer.sum());
};

// Function to count one class within a fixed temporal period
var countClassPeriod = function(img, classId, firstYear, lastYear) {
  return make(ee.List.sequence(firstYear, lastYear), function(year) {
    return sel(img, year).eq(classId);
  }).reduce(ee.Reducer.sum());
};

// Function to test whether all years in a period are equal to one specific class
var allClassPeriod = function(img, firstYear, lastYear, classId) {
  return make(ee.List.sequence(firstYear, lastYear), function(year) {
    return sel(img, year).eq(classId);
  }).reduce(ee.Reducer.min()).eq(1);
};

// Function to test whether the full time series consists only of native classes
var allNativeSeries = function(img) {
  return make(years, function(year) {
    return isNative(sel(img, year));
  }).reduce(ee.Reducer.min()).eq(1);
};

// Select annual classification bands
var classification = inputClassification.select(bands);

// Function to build the standard silviculture mask
var buildStandardSilvicultureMask = function(img) {
  var final21 = getFinal21Mask(img);
  var candidateYears = ee.List.sequence(firstFilterYear, endYear);

  // Flag pixels with Forest after a strong previous class-21 window and final class-21 support
  var yearlyCandidates = make(candidateYears, function(year) {
    year = ee.Number(year);

    var current = sel(img, year);
    var previous21Count = countPrevious21(img, year);

    return current.eq(3)
      .and(previous21Count.gte(minFrequency21))
      .and(final21);
  });

  return yearlyCandidates.reduce(ee.Reducer.anyNonZero()).selfMask();
};

// Function to build the long class-21 before Forest mask
var buildLong21BeforeForestMask = function(img) {
  var final21 = getFinal21Mask(img);
  var blockStarts = ee.List.sequence(startYear, endYear - initial21Years);

  // Flag pixels with a long class-21 block followed by Forest and final class-21 support
  var blockCandidates = make(blockStarts, function(start) {
    start = ee.Number(start);

    var block21 = allClassPeriod(img, start, start.add(initial21Years - 1), 21);
    var afterStart = start.add(initial21Years);

    var hasForestAfter = make(ee.List.sequence(afterStart, endYear), function(year) {
      return sel(img, year).eq(3);
    }).reduce(ee.Reducer.anyNonZero());

    return block21.and(hasForestAfter).and(final21);
  });

  return blockCandidates.reduce(ee.Reducer.anyNonZero()).selfMask();
};

// Function to build the strict recent Forest after class-21 history mask
var buildStrictRecentForestMask = function(img) {
  var long21 = allClassPeriod(img, startYear, preRecentEnd, 21);
  var recentForest = allClassPeriod(img, recentForestStart, endYear, 3);

  return long21.and(recentForest).selfMask();
};

// Function to build the tolerant recent Forest after class-21 dominance mask
var buildTolerantRecentForestMask = function(img) {
  var previous21Count = countClassPeriod(img, 21, startYear, preRecentEnd);
  var recentForestCount = countClassPeriod(img, 3, recentForestStart, endYear);

  return previous21Count.gte(minPreRecent21)
    .and(recentForestCount.gte(minRecentForest))
    .selfMask();
};

// Function to apply silviculture masks to the full time series
var applySilvicultureFilter = function(img) {
  var standardMask = buildStandardSilvicultureMask(img);
  var long21Mask = buildLong21BeforeForestMask(img);
  var strictRecentMask = buildStrictRecentForestMask(img);
  var tolerantRecentMask = buildTolerantRecentForestMask(img);

  // Combine all spatial rule masks into a single boolean mask
  var silvicultureMask = standardMask.unmask(0)
    .or(long21Mask.unmask(0))
    .or(strictRecentMask.unmask(0))
    .or(tolerantRecentMask.unmask(0))
    .selfMask();

  // Years before the new accumulated-history rule can be applied
  var earlyYears = ee.List.sequence(startYear, firstPrevious21RemovalYear - 1);

  // Years where at least 15 previous years exist in the time series
  var candidateYears = ee.List.sequence(firstPrevious21RemovalYear, endYear);

  // Apply the original silviculture mask to early years
  var earlyOutput = make(earlyYears, function(year) {
    var current = sel(img, year);

    return current.where(
      silvicultureMask.unmask(0).and(current.eq(3)), 21);
  });

  // Apply the original silviculture mask plus the new accumulated previous-21 rule
  var candidateOutput = make(candidateYears, function(year) {
    year = ee.Number(year);

    var current = sel(img, year);

    // Count all previous occurrences of class 21 from startYear to year - 1
    var previous21Count = countClassPeriod(img, 21, startYear, year.subtract(1));

    // Convert class 3 to class 21 when the pixel already had
    // at least 15 previous occurrences as class 21
    var previous21ForestRemovalMask = previous21Count
      .gte(minPrevious21ForForestRemoval);

    var correctionMask = silvicultureMask.unmask(0)
      .or(previous21ForestRemovalMask);

    return current.where(correctionMask.and(current.eq(3)), 21);
  });

  return ee.Image.cat([
    earlyOutput,
    candidateOutput
  ]).rename(bands).toInt16();
};

// Apply filters
var outputClassification = classification;

// Apply silviculture filter
var beforeA = outputClassification;
outputClassification = applySilvicultureFilter(outputClassification);
Map.addLayer(outputClassification, vis, 'Post silviculture filter', false);

// Embed processing metadata attributes
outputClassification = outputClassification
  .rename(bands)
  .toInt16()
  .set({
    'filter': '15_silviculture_filter',
    'input_asset': inputFile,
    'output_version': outputVersion,
  });

// Render the fully corrected final output to the map
Map.addLayer(outputClassification, vis, 'Output silviculture filter');
print('Output silviculture filter', outputClassification);

// Export as GEE asset
Export.image.toAsset({
  image: outputClassification,
  description: inputFile + '_silv_v' + outputVersion,
  assetId: out + inputFile + '_silv_v' + outputVersion,
  pyramidingPolicy: {'.default': 'mode'},
  region: inputClassification.geometry(),
  scale: 30,
  maxPixels: 1e13
});
