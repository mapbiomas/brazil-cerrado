// -- -- -- -- 14) False Regrowth Filter
// This script applies an advanced suite of 10 temporal post-classification rules 
// designed specifically for the short Sentinel time series (2017-2025). 
// It enforces temporal continuity by removing anomalous native vegetation regrowth, 
// stabilizing long Grassland (12) and Wetland (11) trajectories, and suppressing noise prior 
// to consolidated deforestation events.

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
var outputVersion = '3';

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

// Set the starting and ending year of the processing time-series
var startYear = 2017;
var endYear = 2025;

// Generate a sequential list of all years evaluated in the time series
var years = ee.List.sequence(startYear, endYear);

// Set the internal reference year used to anchor the initial years
var initialReferenceYear = 2019;

// Define LULC class groups for logic rules
var nativeIds = [3, 4, 11, 12];
var nativeFor21CommissionIds = [4, 11, 12];
var regenerationIds = [3, 4, 11, 12];
var class25InterferenceIds = [12, 33];

// Define specific rule thresholds
var maxIntermediateNativeBeforeDeforestation = 2;
var min21AfterIntermediate = 2;
var min21After25Bridge = 1;
var max21Commission = 1;
var grasslandReferenceEndYear = 2024;
var min12YearsLongTrajectory = 5;
var min21BlockForRegeneration = 2;
var maxRegenerationBlock = 2;
var wetlandMinPrevious21 = 2;
var restingaReferenceYear = 2024;
var restingaId = 50;
var restingaAssociatedIds = [4, 11, 12];
var pad = 6;

// Define a function to consistently format band names based on the given year
var getBand = function(year) { return ee.String('classification_').cat(ee.Number(year).format('%d')); };

// Map over the years array to generate the standardized target band names
var bands = years.map(function(year) { return getBand(year); });

// Define a function to select a specific annual band from a multi-band image
var sel = function(img, year) { return img.select(getBand(year)); };

// Define a function to rebuild a multi-band image collection by applying a processing function across all years
var make = function(yearList, fn) {
  var imgs = yearList.map(function(year) { return ee.Image(fn(ee.Number(year))).rename('classification').toInt16(); });
  var names = yearList.map(function(year) { return getBand(year); });
  return ee.ImageCollection.fromImages(imgs).toBands().rename(names);
};

var inList = function(img, ids) {
  var mask = ee.Image(0);
  ids.forEach(function(id) { mask = mask.or(img.eq(id)); });
  return mask;
};

var buildPad = function(img) {
  var imgs = []; var names = [];
  for (var y = startYear - pad; y <= endYear + pad; y++) {
    var band = (y >= startYear && y <= endYear) ? sel(img, y) : ee.Image(0);
    imgs.push(band.rename('classification').toInt16());
    names.push('classification_' + y);
  }
  return ee.ImageCollection.fromImages(imgs).toBands().rename(names);
};

var allClass = function(img, start, len, classId) {
  var mask = ee.Image(1);
  for (var k = 0; k < len; k++) { mask = mask.and(sel(img, start.add(k)).eq(classId)); }
  return mask;
};

var allInList = function(img, start, len, ids) {
  var mask = ee.Image(1);
  for (var k = 0; k < len; k++) { mask = mask.and(inList(sel(img, start.add(k)), ids)); }
  return mask;
};

var countClass = function(img, classId) { return make(years, function(year) { return sel(img, year).eq(classId); }).reduce(ee.Reducer.sum()); };
var countInList = function(img, ids) { return make(years, function(year) { return inList(sel(img, year), ids); }).reduce(ee.Reducer.sum()); };
var allNativeSeries = function(img) { var nNative = countInList(img, nativeIds); return nNative.eq(ee.Number(years.length())); };
var temporalModeAmong = function(img, ids, fallbackClass) {
  var modeInput = make(years, function(year) { var cur = sel(img, year); return cur.updateMask(inList(cur, ids)); });
  return modeInput.reduce(ee.Reducer.mode()).rename('mode_class').unmask(fallbackClass).toInt16();
};

// Select the annual bands to begin processing
var classification = classificationInput.select(bands);

// Rule 1: Correct initial years if the internal reference year (2019) is Grassland (12)
var applyInitial12FromReference = function(img) {
  // Extract the reference year band
  var ref = sel(img, initialReferenceYear);
  // Initialize a mask to check if all years prior to the reference are NOT 12
  var allInitialNot12 = ee.Image(1);
  // Iterate through initial years to build the exclusion mask
  for (var y = startYear; y < initialReferenceYear; y++) { allInitialNot12 = allInitialNot12.and(sel(img, y).neq(12)); }
  // Create final mask: reference is 12 AND everything before was not 12
  var mask = ref.eq(12).and(allInitialNot12);
  
  // Apply correction across all years
  return make(years, function(year) {
    year = ee.Number(year);
    var cur = sel(img, year);
    // If the year is before the reference year, force it to match the reference (12) where masked
    return ee.Image(ee.Algorithms.If(year.lt(initialReferenceYear), cur.where(mask, ref), cur));
  });
};

// Rule 2: Correct initial Non-Vegetated (25) states based on the internal reference year
var applyInitial25FromReference = function(img) {
  // Extract the reference year band
  var ref = sel(img, initialReferenceYear);
  
  // Apply correction across all years
  return make(years, function(year) {
    year = ee.Number(year);
    var cur = sel(img, year);
    // Create mask targeting disagreements involving class 25 between the current year and the reference year
    var mask = cur.eq(25).and(ref.neq(25)).or(cur.neq(25).and(ref.eq(25)));
    // Overwrite early years with the reference year's class where disagreements occur
    return ee.Image(ee.Algorithms.If(year.lt(initialReferenceYear), cur.where(mask, ref), cur));
  });
};

// Rule 3: Correct native trajectories originating from Wetland (11) that end as Grassland (12)
var applyWetlandOriginCorrection = function(img) {
  // Check if the very first year is Wetland
  var start11 = sel(img, startYear).eq(11);
  // Check if the very last year is Grassland
  var end12 = sel(img, endYear).eq(12);
  // Confirm the entire trajectory is composed only of native classes
  var nativeTrajectory = allNativeSeries(img);
  // Combine conditions into a single trigger mask
  var mask = start11.and(end12).and(nativeTrajectory);
  
  // Rebuild stack, forcing any intermediate class 12 to revert to Wetland (11)
  return make(years, function(year) {
    var cur = sel(img, year);
    return cur.where(mask.and(cur.eq(12)), 11);
  });
};

// Rule 4: Stabilize Grassland (12) backwards from the end of the series
var applyBackwardGrasslandStabilization = function(img) {
  // Extract the first year band
  var start = sel(img, startYear);
  // Ensure the series starts as native vegetation
  var startNative = inList(start, nativeIds);
  // Ensure the series does NOT start as Wetland (11)
  var startNot11 = start.neq(11);
  // Ensure the series ends as Grassland (12)
  var endAs12 = sel(img, endYear).eq(12);
  // Combine rules into a trajectory mask
  var trajMask = startNative.and(startNot11).and(endAs12);
  
  // Initialize iteration with the final year
  var init = sel(img, endYear).rename(getBand(endYear));
  // Create a reversed list of years to iterate backwards
  var reversedYears = ee.List.sequence(endYear - 1, startYear, -1);
  
  // Iterate backwards to propagate class 12
  var outImg = ee.Image(reversedYears.iterate(function(year, acc) {
    year = ee.Number(year); acc = ee.Image(acc);
    var cur = sel(img, year);
    // Fetch the subsequent year from the accumulated backward stack
    var next = acc.select(getBand(year.add(1)));
    
    // Mask: trajectory met AND next year is 12 AND current year is not 12
    var mask = trajMask.and(next.eq(12)).and(cur.neq(12));
    // Correct the current year to 12
    var corrected = cur.where(mask, 12).rename(getBand(year));
    // Append to accumulator
    return corrected.addBands(acc);
  }, init));
  
  // Return standard formatted image
  return outImg.select(bands).rename(bands).toInt16();
};

// Rule 5: Stabilize long Grassland (12) trajectories originating from Anthropic classes
var applyLongGrassland12Stabilization = function(img) {
  // Check if series starts as  Mosaic of Uses (21) or Non-Vegetated (25)
  var startsAs21or25 = sel(img, startYear).eq(21).or(sel(img, startYear).eq(25));
  // Count total years classified as Grassland (12)
  var n12 = countClass(img, 12);
  // Ensure the series ends as Grassland (12) in the defined reference end year
  var endsAs12 = sel(img, grasslandReferenceEndYear).eq(12);
  
  // Combine into a stable 12 mask
  var stable12 = startsAs21or25.and(n12.gte(min12YearsLongTrajectory)).and(endsAs12);
  
  // Overwrite all years with 12 where the mask is met
  return make(years, function(year) {
    var cur = sel(img, year);
    return cur.where(stable12, 12);
  });
};

// Rule 6: Remove anomalous 11/12 states prior to consolidated deforestation
var applyRemove11or12BeforeDeforestation = function(img) {
  // Generate temporally padded image to avoid out-of-bounds errors on sequence lookups
  var padImg = buildPad(img);
  var preDeforestationNativeIds = [3, 4];
  var intermediateNativeIds = [11, 12];
  
  // Rebuild annual stack applying pattern-matching loops
  return make(years, function(year) {
    var cur = sel(img, year);
    var mask = ee.Image(0);
    
    // Loop through possible lengths of the anomalous native block
    for (var len = 1; len <= maxIntermediateNativeBeforeDeforestation; len++) {
      for (var pos = 0; pos < len; pos++) {
        var start = year.subtract(pos);
        // Check if prior state is Forest/Savanna
        var before = inList(sel(padImg, start.subtract(1)), preDeforestationNativeIds);
        // Check if current block is Wetland/Grassland
        var block = allInList(padImg, start, len, intermediateNativeIds);
        // Check if subsequent state is consolidated  Mosaic of Uses (21)
        var after21 = allClass(padImg, start.add(len), min21AfterIntermediate, 21);
        // Check alternate subsequent state: temporary Non-Vegetated (25) followed by  Mosaic of Uses (21)
        var after25Bridge = sel(padImg, start.add(len)).eq(25).and(allClass(padImg, start.add(len + 1), min21After25Bridge, 21));
        
        // Combine conditions for Pattern A and B
        var thisMask = inList(cur, intermediateNativeIds).and(before).and(block).and(after21.or(after25Bridge));
        mask = mask.or(thisMask);
      }
      
      // Secondary check: remove class 25 bridging the anomaly and deforestation
      var blockStart = year.subtract(len);
      var before25 = inList(sel(padImg, blockStart.subtract(1)), preDeforestationNativeIds);
      var blockBefore25 = allInList(padImg, blockStart, len, intermediateNativeIds);
      var after25Support = allClass(padImg, year.add(1), min21After25Bridge, 21);
      
      var bridge25 = cur.eq(25).and(before25).and(blockBefore25).and(after25Support);
      mask = mask.or(bridge25);
    }
    // Overwrite the anomalous block and bridges with  Mosaic of Uses (21)
    return cur.where(mask, 21);
  });
};

// Rule 7: Remove short  Mosaic of Uses (21) commissions enclosed by native vegetation blocks
var applyRemove21CommissionBetweenNative = function(img) {
  var padImg = buildPad(img);
  
  return make(years, function(year) {
    var cur = sel(img, year);
    var mask = ee.Image(0);
    var replacement = cur;
    
    // Loop through possible lengths of the anomalous 21 block
    for (var len = 1; len <= max21Commission; len++) {
      for (var pos = 0; pos < len; pos++) {
        var start = year.subtract(pos);
        // Confirm previous state is a valid native support class
        var before = inList(sel(padImg, start.subtract(1)), nativeFor21CommissionIds);
        // Confirm current block is  Mosaic of Uses (21)
        var block21 = allClass(padImg, start, len, 21);
        // Confirm subsequent state is a valid native support class
        var after = inList(sel(padImg, start.add(len)), nativeFor21CommissionIds);
        
        // Capture the native class that follows the anomaly
        var afterClass = sel(padImg, start.add(len));
        
        // Combine conditions
        var thisMask = cur.eq(21).and(before).and(block21).and(after);
        mask = mask.or(thisMask);
        // Map the replacement to the native class that follows the anomaly
        replacement = replacement.where(thisMask, afterClass);
      }
    }
    // Apply correction
    return cur.where(mask, replacement);
  });
};

// Rule 8: Remove isolated, short native regeneration enclosed by consolidated  Mosaic of Uses (21)
var applyRemoveShortNativeRegeneration = function(img) {
  var padImg = buildPad(img);
  
  return make(years, function(year) {
    var cur = sel(img, year);
    var mask = ee.Image(0);
    
    // Loop through possible lengths of the false regeneration block
    for (var len = 1; len <= maxRegenerationBlock; len++) {
      for (var pos = 0; pos < len; pos++) {
        var start = year.subtract(pos);
        // Ensure previous state is consolidated  Mosaic of Uses (21)
        var before21 = allClass(padImg, start.subtract(min21BlockForRegeneration), min21BlockForRegeneration, 21);
        // Ensure current block is native regeneration
        var blockNative = allInList(padImg, start, len, regenerationIds);
        // Ensure subsequent state is consolidated  Mosaic of Uses (21)
        var after21 = allClass(padImg, start.add(len), min21BlockForRegeneration, 21);
        
        // Combine conditions
        var thisMask = inList(cur, regenerationIds).and(before21).and(blockNative).and(after21);
        mask = mask.or(thisMask);
      }
    }
    // Overwrite the false native regeneration with Mosaic of Uses (21)
    return cur.where(mask, 21);
  });
};

// Rule 9: Eradicate Wetland (11) occurrences if preceded by consolidated Mosaic of Uses (21)
var applyWetlandAfterConsolidated21 = function(img) {
  var padImg = buildPad(img);
  
  // Initialize tracking image with the first year and a state band set to 0
  var y0 = sel(img, startYear).rename(getBand(startYear));
  var state0 = ee.Image(0).rename('had_previous_21_support');
  var init = y0.addBands(state0);
  
  // Iterate forward through the series to permanently track 21 consolidation
  var outImg = ee.Image(ee.List.sequence(startYear + 1, endYear).iterate(function(year, acc) {
    year = ee.Number(year); acc = ee.Image(acc);
    var cur = sel(img, year);
    // Retrieve previous state marker
    var previousState = acc.select('had_previous_21_support');
    
    // Check if the previous consecutive years satisfy the 21 consolidation threshold
    var previous21Support = allClass(padImg, year.subtract(wetlandMinPrevious21), wetlandMinPrevious21, 21);
    
    // Update the permanent tracking state (turns true and stays true)
    var state = previousState.or(previous21Support).rename('had_previous_21_support');
    
    // Overwrite current Wetland (11) with Mosaic of Uses (21) if the permanent state is true
    var corrected = cur.where(state.and(cur.eq(11)), 21).rename(getBand(year));
    
    // Append corrected band and updated state marker
    return acc.addBands(corrected).addBands(state, null, true);
  }, init));
  
  // Return standard formatted image
  return outImg.select(bands).rename(bands).toInt16();
};

// Rule 10: Freeze Herbaceous Sandbank (50) area to match a reliable reference year
var applyRestingaFixedArea = function(img) {
  // Extract the reference year mask for class 50
  var restingaMask = sel(img, restingaReferenceYear).eq(restingaId);
  // Calculate the temporal mode of related native classes to serve as a background replacement
  var associatedMode = temporalModeAmong(img, restingaAssociatedIds, 12);
  
  // Rebuild annual stack enforcing the fixed area
  return make(years, function(year) {
    var cur = sel(img, year);
    // Force pixels inside the mask to be 50
    var fixedInside = cur.where(restingaMask, restingaId);
    // Force current 50 pixels outside the mask to revert to the temporal native mode
    var fixedOutside = fixedInside.where(restingaMask.not().and(fixedInside.eq(restingaId)), associatedMode);
    return fixedOutside;
  });
};


// --- Step 4: Execute Filters ---

var outputClassification = classification;

// 1. Correct initial years when the reference year is class 12
var before1 = outputClassification;
outputClassification = applyInitial12FromReference(outputClassification);
Map.addLayer(outputClassification, vis, 'Post 1: initial 12 from reference year', false);

// 2. Correct initial years when the reference year indicates class 25
var before2 = outputClassification;
outputClassification = applyInitial25FromReference(outputClassification);
Map.addLayer(outputClassification, vis, 'Post 2: initial 25 from reference year', false);

// 3. Correct native trajectories that start as Wetland and end as Grassland
var before3 = outputClassification;
outputClassification = applyWetlandOriginCorrection(outputClassification);
Map.addLayer(outputClassification, vis, 'Post 3: wetland-origin correction', false);

// 4. Stabilize native trajectories backward from ending Grassland
var before4 = outputClassification;
outputClassification = applyBackwardGrasslandStabilization(outputClassification);
Map.addLayer(outputClassification, vis, 'Post 4: backward grassland stabilization', false);

// 5. Stabilize long Grassland trajectories originating from Anthropic classes
var before5 = outputClassification;
outputClassification = applyLongGrassland12Stabilization(outputClassification);
Map.addLayer(outputClassification, vis, 'Post 5: long class-12 stabilization', false);

// 6. Remove spurious 11/12 occurrences bridging native vegetation and deforestation
var before6 = outputClassification;
outputClassification = applyRemove11or12BeforeDeforestation(outputClassification);
Map.addLayer(outputClassification, vis, 'Post 6: 11/12 before deforestation', false);

// 7. Remove short Mosaic of Uses (21) commissions between native blocks
var before7 = outputClassification;
outputClassification = applyRemove21CommissionBetweenNative(outputClassification);
Map.addLayer(outputClassification, vis, 'Post 7: 21 commission between native blocks', false);

// 8. Remove isolated, short regeneration blocks between consolidated  Mosaic of Uses (21)
var before8 = outputClassification;
outputClassification = applyRemoveShortNativeRegeneration(outputClassification);
Map.addLayer(outputClassification, vis, 'Post 8: short native regeneration', false);

// 9. Permanently remove Wetland (11) occurrences if preceded by consolidated  Mosaic of Uses (21)
var before9 = outputClassification;
outputClassification = applyWetlandAfterConsolidated21(outputClassification);
Map.addLayer(outputClassification, vis, 'Post 9: wetland after previous 21 support', false);

// 10. Standardize Herbaceous Sandbank (50) boundaries to the 2024 reference area
var before10 = outputClassification;
outputClassification = applyRestingaFixedArea(outputClassification);
Map.addLayer(outputClassification, vis, 'Post 10: fixed Restinga area', false);

// Embed processing metadata attributes directly into the output asset properties and standardize names
outputClassification = outputClassification.rename(bands).toInt16().set({
  'filter': '14_false_regeneration_sentinel',
  'input_asset': inputFile,
  'output_version': outputVersion,
  'start_year': startYear,
  'end_year': endYear,
  'initial_reference_year': initialReferenceYear,
  'grassland_reference_end_year': grasslandReferenceEndYear,
  'restinga_reference_year': restingaReferenceYear
});

// Render the final filtered classification map to the display
Map.addLayer(outputClassification, vis, 'Output false regeneration');
print('Output false regeneration', outputClassification);

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

