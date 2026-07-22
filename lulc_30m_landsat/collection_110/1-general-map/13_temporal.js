// --- --- --- 13) Temporal 
// Applies general temporal consistency rules to annual Land Use and Land Cover 
// (LULC) maps. It removes short temporal inconsistencies and classification noise 
// using sliding windows of 5, 4, and 3 years. It also includes specific edge-case 
// corrections for the beginning and end of the time series, while explicitly 
// protecting recent verified anthropic conversions (Mosaic of Uses - 21).


// Define visualization parameters
var vis = {
    min: 0,
    max: 75,
    palette:require('users/mapbiomas/modules:Palettes.js').get('brazil'),
    bands: 'classification_2024'
};

// Define the input version
var inputVersion = '5';

// Define the output version
var outputVersion = '11';

// Define the base directory
var root = 'projects/ee-ipam/assets/MAPBIOMAS/LULC/CERRADO_DEV/COL_11/LANDSAT/C11-POST-CLASSIFICATION/';
var out = 'projects/ee-ipam/assets/MAPBIOMAS/LULC/CERRADO_DEV/COL_11/LANDSAT/C11-POST-CLASSIFICATION/';

// Construct the base name of the input file
var inputFile = 'CERRADO_C11_gapfill_v17_spt_v2_tp_v2_tra_v5_snv_v3_traj_v4_freq_v'+inputVersion;

// Load the classification multi-band image
var classificationInput = ee.Image(root + inputFile);
print('Input classification', classificationInput);
Map.addLayer(classificationInput, vis, 'Input classification');

// Set the starting and ending year of the processing time-series
var startYear = 1985;
var endYear = 2025;

// Generate an Earth Engine list of consecutive years
var years = ee.List.sequence(startYear, endYear);

// Set temporal rule parameters
// 'midEnd' defines the maximum year to safely apply forward-looking central windows
var midEnd = 2023;

// 'protect21From' prevents native classes from erroneously overwriting recent 
// deforestations classified as Mosaic of Uses (21) from this year onwards.
var protect21From = 2023;

// Set class priority for temporal rules (Hierarchical Overwrite)
// Classes at the end of the array have HIGHER overwrite priority.
// e.g., Water (33) and Non-Vegetated (25) yield to Native (3, 4) in case of conflict.
var classOrder = [33, 25, 21, 12, 11, 50, 4, 3];

// Set class priority specifically for the first-year boundary correction.
// Ensures stable native starts are prioritized over anthropic artifacts in 1985.
var firstYearOrder = [12, 11, 50, 4, 3];

// Define core native classes used for logical checks (e.g., preventing deforestation masking)
var nativeIds = [3, 4, 11, 12, 50];

// Function to standardize band naming conventions based on the year
var getBand = function(year) {
  return ee.String('classification_').cat(ee.Number(year).format('%d'));
};

// Map over the years list to create an array of all band names
var bands = years.map(function(year) {
  return getBand(year);
});

// Function to extract a single annual band from a multiband image
var sel = function(img, year) {
  return img.select(getBand(year));
};

// Function to rebuild a multiband image from processed annual outputs.
// Iterates over a yearList, applies a processing function (fn) per year, 
// and collapses the results back into a single multiband image.
var make = function(yearList, fn) {
  var imgs = yearList.map(function(year) {
    return ee.Image(fn(ee.Number(year))).rename('classification').toInt16();
  });

  var names = yearList.map(function(year) {
    return getBand(year);
  });

  return ee.ImageCollection.fromImages(imgs).toBands().rename(names);
};

// Function to highlight pixels that changed between an initial and a filtered image
var changed = function(before, after) {
  return before.neq(after).reduce(ee.Reducer.anyNonZero()).selfMask();
};

// Function to verify if a given class ID belongs to the native vegetation group
var isNativeId = function(id) {
  return nativeIds.indexOf(id) !== -1;
};

// Temporal Rules

// Function to apply a sliding temporal window rule for a SINGLE class
// Corrects anomalies bounded by stable states (e.g., C-X-C -> C-C-C)
var applyWinClass = function(img, classId, winSize) {
  // Define safe temporal boundaries to avoid requesting bands out of range
  var y0 = startYear + 1;
  var y1 = midEnd - (winSize - 3);

  // Preserve the initial years that fall outside the sliding window
  var first = make(ee.List.sequence(startYear, y0 - 1), function(year) {
    return sel(img, year);
  });

  // Apply the rule to the valid middle years
  var middle = make(ee.List.sequence(y0, y1), function(year) {
    var cur = sel(img, year);

    // Identify patterns based on window size: C-X-C (3-yr), C-X-X-C (4-yr), or C-X-X-X-C (5-yr)
    // where 'C' is the target classId and 'X' is the anomaly to be replaced.
    var mask = sel(img, year.subtract(1)).eq(classId)
      .and(sel(img, year.add(winSize - 2)).eq(classId));

    // Ensure ALL intermediate years within the gap are different from the target class
    for (var k = 0; k <= winSize - 3; k++) {
      mask = mask.and(sel(img, year.add(k)).neq(classId));
    }

    // Critical constraint: Prevent native classes from overwriting recent verified 
    // anthropic conversions (Class 21) at the end of the series.
    if (isNativeId(classId)) {
      var recent = ee.Image(ee.Algorithms.If(year.gte(protect21From), ee.Image(1), ee.Image(0)));
      mask = mask.and(recent.and(cur.eq(21)).not());
    }

    // Apply the correction mask to the current year
    return cur.where(mask, classId);
  });

  // Preserve the final years that fall outside the sliding window
  var last = make(ee.List.sequence(y1 + 1, endYear), function(year) {
    return sel(img, year);
  });

  // Reassemble the time series
  return first.addBands(middle).addBands(last).rename(bands);
};

// Function to apply the temporal window rule across ALL classes sequentially.
// Executed based on the predefined priority hierarchy (classOrder).
var applyWin = function(img, winSize) {
  var outImg = img;

  classOrder.forEach(function(classId) {
    outImg = applyWinClass(outImg, classId, winSize);
  });

  return outImg;
};

// Function to correct unstable two-year tails at the extreme end of the series.
// Specifically targets false Grassland (12) or Non-Vegetated (25) artifacts.
var applyEdgeTail = function(img) {
  var y2022 = sel(img, 2022);
  var y2023 = sel(img, 2023);
  var y2024 = sel(img, 2024);
  var y2025 = sel(img, 2025);

  // Identify pattern: A-A-X-X (where X is an unstable drop to 12 or 25)
  var unstableTail = y2024.eq(y2025).and(y2024.eq(12).or(y2024.eq(25)));
  // Ensure the state before the drop was consolidated (A-A)
  var stableBefore = y2022.eq(y2023).and(y2023.neq(y2024));
  var mask = stableBefore.and(unstableTail);

  // Rebuild up to 2023 untouched
  var before = make(ee.List.sequence(startYear, 2023), function(year) {
    return sel(img, year);
  });

  // Carry forward the stable class from 2023 into 2024 and 2025
  var c2024 = y2024.where(mask, y2023).rename(getBand(2024));
  var c2025 = y2025.where(mask, y2023).rename(getBand(2025));

  return before.addBands(c2024).addBands(c2025).rename(bands);
};

// Function to conservatively correct the very last year of the series.
var applyLastYear = function(img) {
  var y2023 = sel(img, 2023);
  var y2024 = sel(img, 2024);
  var y2025 = sel(img, 2025);

  // Correct A-A-X at the end of the series (e.g., Forest-Forest-Grassland)
  // CRITICAL: Class 21 is preserved because it often indicates genuine, brand-new conversion
  var mask = y2023.eq(y2024).and(y2025.neq(y2024)).and(y2025.neq(21));
  var c2025 = y2025.where(mask, y2024).rename(getBand(2025));

  var before = make(ee.List.sequence(startYear, 2024), function(year) {
    return sel(img, year);
  });

  return before.addBands(c2025).rename(bands);
};

// Function to anchor recent Class 21 (Mosaic) occurrences at the end of the series,
// ensuring genuine recent deforestation events are not smoothed out.
var applyRecent21Anchor = function(img) {
  var y2022 = sel(img, 2022);
  var y2023 = sel(img, 2023);
  var y2024 = sel(img, 2024);
  var y2025 = sel(img, 2025);

  // Convert 2025 to Class 21 ONLY IF 2024 is Class 21 AND there is historical support 
  // (2022 or 2023 was also Class 21), but 2025 failed to classify as such.
  var support = y2024.eq(21).and(y2022.eq(21).or(y2023.eq(21))).and(y2025.neq(21));
  var c2025 = y2025.where(support, 21).rename(getBand(2025));

  var before = make(ee.List.sequence(startYear, 2024), function(year) {
    return sel(img, year);
  });

  return before.addBands(c2025).rename(bands);
};

// Function to correct anomalies in the very first year (1985).
// Runs based on 'firstYearOrder' to prioritize native vegetation stability.
var applyFirstYear = function(img) {
  var outImg = img;

  firstYearOrder.forEach(function(classId) {
    var y1985 = sel(outImg, 1985);
    var y1986 = sel(outImg, 1986);
    var y1987 = sel(outImg, 1987);

    // Identify X-A-A pattern at the beginning (e.g., Pasture-Forest-Forest)
    // and correct it backward to A-A-A.
    var mask = y1985.neq(classId).and(y1986.eq(classId)).and(y1987.eq(classId));
    var c1985 = y1985.where(mask, classId).rename(getBand(1985));

    var after = make(ee.List.sequence(1986, endYear), function(year) {
      return sel(outImg, year);
    });

    outImg = c1985.addBands(after).rename(bands);
  });

  return outImg;
};

// Function to apply a safe one-year cleanup (C-X-C) for a single class.
// This acts as a final sweep after the broader sliding windows have run.
var applyPulseCleanupClass = function(img, classId) {
  var first = sel(img, startYear);

  var middle = make(ee.List.sequence(startYear + 1, endYear - 1), function(year) {
    var prev = sel(img, year.subtract(1));
    var cur = sel(img, year);
    var next = sel(img, year.add(1));

    // Correct C-X-C one-year pulses (e.g., Forest-Pasture-Forest -> Forest-Forest-Forest)
    var mask = prev.eq(classId).and(next.eq(classId)).and(cur.neq(classId));

    // Protect recent Class 21 conversions from being masked by native classes
    if (isNativeId(classId)) {
      var recent = ee.Image(ee.Algorithms.If(year.gte(protect21From), ee.Image(1), ee.Image(0)));
      mask = mask.and(recent.and(cur.eq(21)).not());
    }

    return cur.where(mask, classId);
  });

  var last = sel(img, endYear);

  return first.addBands(middle).addBands(last).rename(bands);
};

// Function to apply the one-year pulse cleanup across all classes hierarchically.
var applyPulseCleanup = function(img) {
  var outImg = img;

  classOrder.forEach(function(classId) {
    outImg = applyPulseCleanupClass(outImg, classId);
  });

  return outImg;
};

// Initialize the output variable with the input image
var outputClassification = classificationInput;

// Apply the 5-year temporal window rule (C-X-X-X-C -> C-C-C-C-C)
outputClassification = applyWin(outputClassification, 5);
Map.addLayer(outputClassification, vis, 'Post: 5-year temporal rule', false);

// Apply the 4-year temporal window rule (C-X-X-C -> C-C-C-C)
outputClassification = applyWin(outputClassification, 4);
Map.addLayer(outputClassification, vis, 'Post: 4-year temporal rule', false);

// Apply the 3-year temporal window rule (C-X-C -> C-C-C)
outputClassification = applyWin(outputClassification, 3);
Map.addLayer(outputClassification, vis, 'Post: 3-year temporal rule', false);

// Correct unstable two-year tails at the end of the series (A-A-X-X)
outputClassification = applyEdgeTail(outputClassification);
Map.addLayer(outputClassification, vis, 'Post: edge tail correction', false);

// Correct the last year conservatively (A-A-X)
outputClassification = applyLastYear(outputClassification);
Map.addLayer(outputClassification, vis, 'Post: last-year correction', false);

// Anchor recent class 21 (Mosaic) in the last year to preserve real conversions
outputClassification = applyRecent21Anchor(outputClassification);
Map.addLayer(outputClassification, vis, 'Post: recent 21 anchor', false);

// Correct the first year conservatively (X-A-A)
outputClassification = applyFirstYear(outputClassification);
Map.addLayer(outputClassification, vis, 'Post: first-year correction', false);

// Apply a final, safe one-year pulse cleanup to catch remaining C-X-C noise
outputClassification = applyPulseCleanup(outputClassification);
Map.addLayer(outputClassification, vis, 'Post: safe one-year pulse cleanup', false);

// Ensure proper band naming
outputClassification = outputClassification
  .rename(bands)
  .toInt16()
  .set({
    'filter': '13_temporal_general',
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
  description: inputFile + '_temp_v' + outputVersion,
  assetId: out + inputFile + '_temp_v' + outputVersion,
  pyramidingPolicy: {
    '.default': 'mode'
  },
  region: classificationInput.geometry(),
  scale: 30,
  maxPixels: 1e13
});
