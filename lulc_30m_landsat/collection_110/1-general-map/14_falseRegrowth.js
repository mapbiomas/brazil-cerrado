// -- -- -- -- 14) False Regrowth Filter
// Enforces long-term temporal continuity by correcting unlikely ecological 
// transitions. It specifically targets "false regeneration" (where established 
// agriculture briefly classifies as native vegetation), stabilizes historical 
// beginnings (1985-1986), removes intermediate noise prior to clear-cut deforestation


// Define visualization parameters
var vis = {
    min: 0,
    max: 62,
    palette:require('users/mapbiomas/modules:Palettes.js').get('classification8'),
    bands: 'classification_2024'
};

// Define the input version
var inputVersion = '11';

// Define the output version
var outputVersion = '44';

// Define the base directory
var root = 'projects/ee-ipam/assets/MAPBIOMAS/LULC/CERRADO_DEV/COL_11/LANDSAT/C11-POST-CLASSIFICATION/';
var out = 'projects/ee-ipam/assets/MAPBIOMAS/LULC/CERRADO_DEV/COL_11/LANDSAT/C11-POST-CLASSIFICATION/';

// Construct the base name of the input file
var inputFile = 'CERRADO_C11_gapfill_v17_spt_v2_tp_v2_tra_v5_snv_v3_traj_v4_freq_v5_temp_v' + inputVersion;

// Load the classification multi-band image
var classificationInput = ee.Image(root + inputFile);
Map.addLayer(classificationInput, vis, 'Input classification');
print('Input classification', classificationInput);

// Initialize an active image variable to iteratively accumulate the corrected bands
var classificationOutput = classificationInput;

// Set the starting and ending year of the processing time-series
var startYear = 1985;
var endYear = 2025;

// Generate a sequential list of all years evaluated in the time series
var years = ee.List.sequence(startYear, endYear);

// Native classes considered in broad trajectory rules.
var nativeIds = [3, 4, 11, 12];

// Subsets of native classes used for specific commission/omission rules
var nativeFor21CommissionIds = [4, 11, 12];

 // Classes prone to being falsely classified as secondary regen
var regenerationIds = [3, 4, 11, 12];

// Classes that might act as brief transitional interference states
var class25InterferenceIds = [12, 33];

// False Regrowth Parameters

// Rule 2: Remove short native blocks (11/12) immediately before consolidated deforestation
var maxIntermediateNativeBeforeDeforestation = 3; // Maximum length of the noise block
var min21AfterIntermediate = 3; // Minimum years of Mosaic (21) required to confirm deforestation
var min21After25Bridge = 1; // Minimum years of Mosaic (21) if preceded by Non-Vegetated (25)

// Rule 3: Remove short Mosaic (21) commissions completely surrounded by native blocks
var max21Commission = 3; // Max length of false anthropic occurrence

// Rule 4: Backward stabilization for long Grassland (12) trajectories
var grasslandReferenceEndYear = 2024; // Anchor year to confirm Grassland persistence
var min12YearsLongTrajectory = 12; // Minimum years required to lock the pixel as stable Grassland

// Rule 5: Suppress short native regeneration periods within consolidated agriculture
var min21BlockForRegeneration = 4; // Required years of stable agriculture before AND after the gap
var maxRegenerationBlock = 3; // Max length of the false native regeneration gap

// Rule 6: Suppress Wetland (11) if it appears after consolidated agriculture
var wetlandMinPrevious21 = 3; // Required consecutive years of Mosaic (21) to trigger suppression

// Rule 7: Enforce fixed spatial extent for Restinga (50)
var restingaReferenceYear = 2014; // The "ground truth" year for Restinga spatial limits
var restingaId = 50; 
var restingaAssociatedIds = [4, 11, 12]; // Fallback classes if Restinga is removed outside the mask

// Temporal padding used to handle edge cases in rolling window functions
var pad = 20;

// Formats year numbers into standard band names (e.g., 'classification_1985')
var getBand = function(year) {
  return ee.String('classification_').cat(ee.Number(year).format('%d'));
};

// Array of all formatted band names
var bands = years.map(function(year) {
  return getBand(year);
});

// Extracts a single year's band from the image stack
var sel = function(img, year) {
  return img.select(getBand(year));
};

// Maps a function over a list of years and rebuilds the multiband image
var make = function(yearList, fn) {
  var imgs = yearList.map(function(year) {
    return ee.Image(fn(ee.Number(year))).rename('classification').toInt16();
  });

  var names = yearList.map(function(year) {
    return getBand(year);
  });

  return ee.ImageCollection.fromImages(imgs).toBands().rename(names);
};

// Creates a boolean mask indicating if a pixel's value is in a given list of IDs
var inList = function(img, ids) {
  var mask = ee.Image(0);
  ids.forEach(function(id) {
    mask = mask.or(img.eq(id));
  });
  return mask;
};

// Builds a temporally padded image stack to prevent out-of-bounds errors 
// when searching forwards/backwards near 1985 or 2025.
var buildPad = function(img) {
  var imgs = [];
  var names = [];

  for (var y = startYear - pad; y <= endYear + pad; y++) {
    // If within valid range, use actual data; else pad with 0
    var band = (y >= startYear && y <= endYear) ? sel(img, y) : ee.Image(0);
    imgs.push(band.rename('classification').toInt16());
    names.push('classification_' + y);
  }

  return ee.ImageCollection.fromImages(imgs).toBands().rename(names);
};

// Verifies if a pixel maintained a specific class continuously for 'len' years
var allClass = function(img, start, len, classId) {
  var mask = ee.Image(1);
  for (var k = 0; k < len; k++) {
    mask = mask.and(sel(img, start.add(k)).eq(classId));
  }
  return mask;
};

// Verifies if a pixel stayed within a group of allowed classes continuously for 'len' years
var allInList = function(img, start, len, ids) {
  var mask = ee.Image(1);
  for (var k = 0; k < len; k++) {
    mask = mask.and(inList(sel(img, start.add(k)), ids));
  }
  return mask;
};

// Counts the total number of years a pixel was classified as 'classId'
var countClass = function(img, classId) {
  return make(years, function(year) {
    return sel(img, year).eq(classId);
  }).reduce(ee.Reducer.sum());
};

// Counts the total number of years a pixel was classified as any class in 'ids'
var countInList = function(img, ids) {
  return make(years, function(year) {
    return inList(sel(img, year), ids);
  }).reduce(ee.Reducer.sum());
};

// Checks if the pixel remained native for the ENTIRE time series
var allNativeSeries = function(img) {
  var nNative = countInList(img, nativeIds);
  return nNative.eq(ee.Number(years.length()));
};

// Calculates the temporal mode (most frequent class) among a restricted set of IDs.
// If the pixel never had any of those IDs, returns 'fallbackClass'.
var temporalModeAmong = function(img, ids, fallbackClass) {
  var modeInput = make(years, function(year) {
    var cur = sel(img, year);
    return cur.updateMask(inList(cur, ids));
  });

  return modeInput
    .reduce(ee.Reducer.mode())
    .rename('mode_class')
    .unmask(fallbackClass)
    .toInt16();
};


// Select annual classification bands
var classification = classificationInput.select(bands);

// Rule 1: Correct initial class 12 based on 1987
// Fixes early Landsat 5 noise. If 1987 is stably Grassland (12), but 1985/1986 
// are something else, this forces 1985/1986 to match 1987.
var applyInitial12From1987 = function(img) {
  var y1985 = sel(img, 1985);
  var y1986 = sel(img, 1986);
  var y1987 = sel(img, 1987);

  var mask = y1987.eq(12)
    .and(y1985.neq(12))
    .and(y1986.neq(12));

  var c1985 = y1985.where(mask, y1987).rename(getBand(1985));
  var c1986 = y1986.where(mask, y1987).rename(getBand(1986));

  var after = make(ee.List.sequence(1987, endYear), function(year) {
    return sel(img, year);
  });

  return c1985
    .addBands(c1986)
    .addBands(after)
    .rename(bands)
    .toInt16();
};


// Rule 2: Correct initial class 25 based on 1987
// Integrates prior gapfill logic. If 1985 or 1986 disagree with 1987 
// regarding Non-Vegetated (25) presence, they inherit 1987's class.
var applyInitial25From1987 = function(img) {
  var y1985 = sel(img, 1985);
  var y1986 = sel(img, 1986);
  var y1987 = sel(img, 1987);

  var mask1985 = y1985.eq(25).and(y1987.neq(25))
    .or(y1985.neq(25).and(y1987.eq(25)));

  var mask1986 = y1986.eq(25).and(y1987.neq(25))
    .or(y1986.neq(25).and(y1987.eq(25)));

  var c1985 = y1985.where(mask1985, y1987).rename(getBand(1985));
  var c1986 = y1986.where(mask1986, y1987).rename(getBand(1986));

  return img
    .addBands(c1985, null, true) // Overwrite existing bands
    .addBands(c1986, null, true)
    .select(bands)
    .rename(bands)
    .toInt16();
};


// Rule 3: Wetland-origin native trajectory correction
// If a pixel is exclusively native throughout the series, starts as Wetland (11), 
// and ends as Grassland (12), it converts all Grassland occurrences to Wetland.
var applyWetlandOriginCorrection = function(img) {
  var start11 = sel(img, startYear).eq(11);
  var end12 = sel(img, endYear).eq(12);
  var nativeTrajectory = allNativeSeries(img);

  var mask = start11
    .and(end12)
    .and(nativeTrajectory);

  return make(years, function(year) {
    var cur = sel(img, year);
    return cur.where(mask.and(cur.eq(12)), 11);
  });
};

// Rule 4: Backward grassland stabilization
// Smooths native trajectories backward. If the series ends as Grassland (12) 
// and starts as non-Wetland native, it iterates backwards from 2025 to 1985. 
// If year T is 12, it forces year T-1 to also be 12 (gradual stabilization).
var applyBackwardGrasslandStabilization = function(img) {
  var start = sel(img, startYear);
  var startNative = inList(start, nativeIds);
  var startNot11 = start.neq(11);
  var endAs12 = sel(img, endYear).eq(12);

  var trajMask = startNative
    .and(startNot11)
    .and(endAs12);

  var init = sel(img, endYear).rename(getBand(endYear));
  var reversedYears = ee.List.sequence(endYear - 1, startYear, -1);

  // Use ee.List.iterate to perform sequential backwards sweeping
  var outImg = ee.Image(reversedYears.iterate(function(year, acc) {
    year = ee.Number(year);
    acc = ee.Image(acc);

    var cur = sel(img, year);
    var next = acc.select(getBand(year.add(1))); // Gets the already-processed future year

    var mask = trajMask
      .and(next.eq(12))
      .and(cur.neq(12));

    var corrected = cur
      .where(mask, 12)
      .rename(getBand(year));

    return corrected.addBands(acc);
  }, init));

  return outImg
    .select(bands)
    .rename(bands)
    .toInt16();
};

// Rule 5: Stabilize long class-12 trajectories
// If an area started as Anthropic (21 or 25) but later consolidated into Grassland (12)
// for at least 12 years (including the reference year), it overwrites the whole 
// series to 12 to eliminate historical noise.
var applyLongGrassland12Stabilization = function(img) {
  var startsAs21or25 = sel(img, startYear).eq(21)
    .or(sel(img, startYear).eq(25));

  var n12 = countClass(img, 12);
  var endsAs12 = sel(img, grasslandReferenceEndYear).eq(12);

  var stable12 = startsAs21or25
    .and(n12.gte(min12YearsLongTrajectory))
    .and(endsAs12);

  return make(years, function(year) {
    var cur = sel(img, year);
    return cur.where(stable12, 12);
  });
};

// Rule 6: Remove class 11 or 12 before consolidated deforestation
// Cleans up false transitions. Deforestation often triggers spectral confusion 
// that looks like Grassland/Wetland just before clear-cut.
// Maps: Native(3/4) -> [Noise 11/12] -> Consolidated Agriculture(21)
var applyRemove11or12BeforeDeforestation = function(img) {
  var padImg = buildPad(img);

  var preDeforestationNativeIds = [3, 4];
  var intermediateNativeIds = [11, 12];

  return make(years, function(year) {
    var cur = sel(img, year);
    var mask = ee.Image(0);

    // Iteratively search for noise blocks of length 1 to maxIntermediateNativeBeforeDeforestation
    for (var len = 1; len <= maxIntermediateNativeBeforeDeforestation; len++) {
      for (var pos = 0; pos < len; pos++) {
        var start = year.subtract(pos);

        var before = inList(
          sel(padImg, start.subtract(1)),
          preDeforestationNativeIds
        );

        var block = allInList(padImg, start, len, intermediateNativeIds);

        var after21 = allClass(padImg, start.add(len), min21AfterIntermediate, 21);

        // Alternative pattern: preceded by Bare Soil (25) acting as a transition bridge
        var after25Bridge = sel(padImg, start.add(len)).eq(25)
          .and(allClass(padImg, start.add(len + 1), min21After25Bridge, 21));

        var thisMask = inList(cur, intermediateNativeIds)
          .and(before)
          .and(block)
          .and(after21.or(after25Bridge));

        mask = mask.or(thisMask);
      }

      var blockStart = year.subtract(len);

      var before25 = inList(
        sel(padImg, blockStart.subtract(1)),
        preDeforestationNativeIds
      );

      var blockBefore25 = allInList(padImg, blockStart, len, intermediateNativeIds);

      var after25Support = allClass(padImg, year.add(1), min21After25Bridge, 21);

      var bridge25 = cur.eq(25)
        .and(before25)
        .and(blockBefore25)
        .and(after25Support);

      mask = mask.or(bridge25);
    }

    // Replace the transitional noise with Mosaic (21)
    return cur.where(mask, 21);
  });
};


// Rule 7: Remove short class-21 commissions between native blocks
// Corrects false deforestation spikes. 
// Pattern: Native -> short Mosaic(21) (up to 3 yrs) -> Native
var applyRemove21CommissionBetweenNative = function(img) {
  var padImg = buildPad(img);

  return make(years, function(year) {
    var cur = sel(img, year);
    var mask = ee.Image(0);
    var replacement = cur;

    for (var len = 1; len <= max21Commission; len++) {
      for (var pos = 0; pos < len; pos++) {
        var start = year.subtract(pos);

        var before = inList(
          sel(padImg, start.subtract(1)),
          nativeFor21CommissionIds
        );

        var block21 = allClass(padImg, start, len, 21);

        var after = inList(
          sel(padImg, start.add(len)),
          nativeFor21CommissionIds
        );

        var afterClass = sel(padImg, start.add(len));

        var thisMask = cur.eq(21)
          .and(before)
          .and(block21)
          .and(after);

        mask = mask.or(thisMask);
        // Overwrite the false 21 with the native class that followed it
        replacement = replacement.where(thisMask, afterClass);
      }
    }

    return cur.where(mask, replacement);
  });
};


// Rule 8: Remove short native regeneration between consolidated class-21 blocks
// Corrects the core "false regeneration" issue. Active agriculture can have 
// fallow periods or weed growth that spectrally mimics native vegetation.
// Pattern: Stable 21 (>= 4 yrs) -> Brief Native (<= 3 yrs) -> Stable 21 (>= 4 yrs)
var applyRemoveShortNativeRegeneration = function(img) {
  var padImg = buildPad(img);

  return make(years, function(year) {
    var cur = sel(img, year);
    var mask = ee.Image(0);

    for (var len = 1; len <= maxRegenerationBlock; len++) {
      for (var pos = 0; pos < len; pos++) {
        var start = year.subtract(pos);

        var before21 = allClass(padImg, start.subtract(min21BlockForRegeneration), min21BlockForRegeneration, 21);

        var blockNative = allInList(padImg, start, len, regenerationIds);

        var after21 = allClass (padImg, start.add(len), min21BlockForRegeneration, 21);

        var thisMask = inList(cur, regenerationIds)
          .and(before21)
          .and(blockNative)
          .and(after21);

        mask = mask.or(thisMask);
      }
    }

    // Overwrite the false regeneration gap with continuous Mosaic (21)
    return cur.where(mask, 21);
  });
};


// Rule 9: Remove wetland after three previous consecutive years of class 21
// Wetlands rarely spontaneously generate over consolidated farmland.
// If an area has 3+ years of agriculture (21), any future Wetland (11) is converted to 21.
var applyWetlandAfterThreeYears21 = function(img) {
  var padImg = buildPad(img);

  var y0 = sel(img, startYear).rename(getBand(startYear));
  // Create a persistent state tracker band
  var state0 = ee.Image(0).rename('had_three_previous_21');
  var init = y0.addBands(state0);

  var outImg = ee.Image(
    ee.List.sequence(startYear + 1, endYear).iterate(function(year, acc) {
      year = ee.Number(year);
      acc = ee.Image(acc);

      var cur = sel(img, year);
      var previousState = acc.select('had_three_previous_21');

      var threePrevious21 = allClass(padImg, year.subtract(wetlandMinPrevious21), wetlandMinPrevious21, 21);

      // Carry forward the flag if the condition was met at any point in the past
      var state = previousState
        .or(threePrevious21)
        .rename('had_three_previous_21');

      var corrected = cur
        .where(state.and(cur.eq(11)), 21)
        .rename(getBand(year));

      return acc
        .addBands(corrected)
        .addBands(state, null, true); // Update the state tracker in the accumulator
    }, init)
  );

  return outImg
    .select(bands)
    .rename(bands)
    .toInt16();
};


// Rule 10: Standardize class 50 to a fixed reference-year area
// Restinga (50) is highly specific and should not migrate spatially across years.
// This rule forces ALL years to have the exact same Restinga spatial footprint 
// as observed in the 2014 reference mask.
var applyRestingaFixedArea = function(img) {
  var restingaMask = sel(img, restingaReferenceYear).eq(restingaId);
  // Determine fallback class based on temporal history if Restinga is removed
  var associatedMode = temporalModeAmong(img, restingaAssociatedIds, 12);

  return make(years, function(year) {
    var cur = sel(img, year);

    // Force Restinga inside the 2014 mask
    var fixedInside = cur.where(restingaMask, restingaId);

    // Remove Restinga outside the 2014 mask and replace with fallback class
    var fixedOutside = fixedInside.where(
      restingaMask.not().and(fixedInside.eq(restingaId)),
      associatedMode
    );

    return fixedOutside;
  });
};

// Initialize the output variable with the input image
var outputClassification = classification;

// 1. Correct 1985 and 1986 when 1987 is class 12
var before1 = outputClassification;
outputClassification = applyInitial12From1987(outputClassification);
Map.addLayer(outputClassification, vis, 'Post Rule 1', false);

// 2. Correct 1985 and 1986 when 1987 is class 25
var before2 = outputClassification;
outputClassification = applyInitial25From1987(outputClassification);
Map.addLayer(outputClassification, vis, 'Post Rule 2', false);

// 3. Correct native trajectories that start as Wetland and end as Grassland
var before3 = outputClassification;
outputClassification = applyWetlandOriginCorrection(outputClassification);
Map.addLayer(outputClassification, vis, 'Post Rule 3', false);

// 4. Stabilize native trajectories that end as class 12, except Wetland origin
var before4 = outputClassification;
outputClassification = applyBackwardGrasslandStabilization(outputClassification);
Map.addLayer(outputClassification, vis, 'Post Rule 4', false);

// 5. Stabilize long class-12 trajectories starting as 21 or 25
var before5 = outputClassification;
outputClassification = applyLongGrassland12Stabilization(outputClassification);
Map.addLayer(outputClassification, vis, 'Post Rule 5', false);

// 6. Remove class 11/12 between native vegetation and deforestation
var before6 = outputClassification;
outputClassification = applyRemove11or12BeforeDeforestation(outputClassification);
Map.addLayer(outputClassification, vis, 'Post Rule 6', false);

// 7. Remove short class-21 commissions between native blocks
var before7 = outputClassification;
outputClassification = applyRemove21CommissionBetweenNative(outputClassification);
Map.addLayer(outputClassification, vis, 'Post Rule 7', false);

// 8. Remove isolated regeneration blocks between consolidated class 21
var before8 = outputClassification;
outputClassification = applyRemoveShortNativeRegeneration(outputClassification);
Map.addLayer(outputClassification, vis, 'Post Rule 8', false);

// 9. Remove wetland after three previous consecutive years of class 21
var before9 = outputClassification;
outputClassification = applyWetlandAfterThreeYears21(outputClassification);
Map.addLayer(outputClassification, vis, 'Post Rule 9', false);

// 10. Standardize Restinga Herbacea to the reference-year area
var before10 = outputClassification;
outputClassification = applyRestingaFixedArea(outputClassification);
Map.addLayer(outputClassification, vis, 'Post Rule 10', false);

// Ensure proper band naming
outputClassification = outputClassification
  .rename(bands)
  .toInt16()
  .set({
    'filter': '14_false_regeneration',
    'input_asset': inputFile,
    'output_version': outputVersion,

  });
  
// Render the fully corrected final output to the map
Map.addLayer(outputClassification, vis, 'Output false regeneration');
print('Output false regeneration', outputClassification);


// Export as GEE asset
Export.image.toAsset({
  image: outputClassification,
  description: inputFile + '_freg_v' + outputVersion,
  assetId: out + inputFile + '_freg_v' + outputVersion,
  pyramidingPolicy: {
    '.default': 'mode'
  },
  region: classificationInput.geometry(),
  scale: 30,
  maxPixels: 1e13
});
