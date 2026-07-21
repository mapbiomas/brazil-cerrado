// -- -- -- -- 15) Spatial Shapes Filter
// This script applies an object-based spatial filter to remove small, irregular, 
// or fragmented patches of the Mosaic of Uses. It calculates geometric patch metrics—including 
// area, bounding-box fill ratio, and the presence of a 3x3 pixel core. 
// Patches smaller than 1 hectare that exhibit irregular shapes (low fill ratio, 
// lacking a solid core, or tiny speckles) are replaced by the focal mode of the 
// surrounding valid LULC classes.


// Define visualization parameters
var vis = {
  min: 0,
  max: 75,
  palette: require('users/mapbiomas/modules:Palettes.js').get('brazil'),
  bands: 'classification_2018'
};

// Set root directory
var root = 'projects/ee-ipam/assets/MAPBIOMAS/LULC/CERRADO_DEV/COL_11/LANDSAT/C11-POST-CLASSIFICATION/';
var out = 'projects/ee-ipam/assets/MAPBIOMAS/LULC/CERRADO_DEV/COL_11/LANDSAT/C11-POST-CLASSIFICATION/';

// Set metadata
var inputVersion = '11';
var outputVersion = '5';

// Set input classification
var inputFile = 'CERRADO_C11_gapfill_v17_spt_v2_tp_v2_tra_v5_snv_v3_traj_v4_freq_v5_temp_v11_freg_v44_silv_v'+inputVersion;

// Load the classification multi-band image
var classificationInput = ee.Image(root + inputFile);
print('Input classification', classificationInput);
Map.addLayer(classificationInput, vis, 'Input classification', false);

// Set the starting and ending year of the processing time-series
var startYear = 1985;
var endYear = 2025;

// Generate a sequential list of all years evaluated in the time series
var years = ee.List.sequence(startYear, endYear);

// Define the target LULC class to be evaluated and filtered (21: Mosaic of Uses)
var targetClass = 21;

// Set the maximum patch size threshold in hectares (patches larger than this are ignored)
var maxPatchHa = 3.0;

// Set the maximum connected-object size in pixels for the algorithm 
// 128 pixels safely covers 1 ha at 10m scale
var maxObjectPixels = 128;

// Set the minimum bounding-box fill ratio
// Fill ratio is the object pixel count divided by the bounding-box pixel count
var minFillRatio = 0.65;

// Enable the thinness criterion to flag patches
// Patches without any 3x3 core are interpreted as thin or fragmented
var useNoCoreCriterion = true;

// Enable the removal of very small, isolated speckles regardless of their compactness
var removeVerySmallSpeckles = true;

// Set the maximum pixel count to define a speckle anomaly
var maxSpecklePixels = 3;

// Set spatial replacement context
// The replacement class is calculated from surrounding non-21 and non-zero pixels
var contextRadiusMeters = 150;

// Define the kernel used to determine pixel connectedness (square radius 1 equals 8-connected neighbors)
var connectednessKernel = ee.Kernel.square(1);

// Define a function to consistently format band names based on the given year
var getBand = function(year) { return ee.String('classification_').cat(ee.Number(year).format('%d')); };

// Map over the years array to generate the standardized target band names
var bands = years.map(function(year) { return getBand(year); });

// Define a function to select a specific annual band from a multi-band image
var sel = function(img, year) { return img.select(getBand(year)); };

// Define a function to rebuild a multi-band image collection by applying a processing function across all years
var make = function(yearList, fn) {
  // Map the processing function over the years and format the output as Int16
  var imgs = yearList.map(function(year) { return ee.Image(fn(ee.Number(year))).rename('classification').toInt16(); });
  // Generate the target array of standard band names
  var names = yearList.map(function(year) { return getBand(year); });
  // Convert the array of annual images back into a single multi-band image and rename bands
  return ee.ImageCollection.fromImages(imgs).toBands().rename(names);
};

// Extract the annual classification bands from the input image
var classification = classificationInput.select(bands);

// Define the core function to calculate geometric metrics for all class-21 patches in a given year
var getPatchMetrics = function(classificationYear) {
  // Isolate class 21 pixels and self-mask them to create the base binary objects layer
  var class21 = classificationYear.eq(targetClass).selfMask().rename('class21');

  // Label unique connected components (patches) of class 21 using 8-neighbor connectivity
  var labels = class21.connectedComponents({ connectedness: connectednessKernel, maxSize: maxObjectPixels }).select('labels');
  // Extract a binary mask of valid processed objects
  var validObjects = labels.mask();

  // Create an image of constant 1s masked to the valid objects to help count pixels
  var one = ee.Image(1).updateMask(validObjects).rename('one');
  
  // Count the total number of pixels belonging to each uniquely labeled patch
  var patchPixels = one.addBands(labels).reduceConnectedComponents({ reducer: ee.Reducer.sum(), labelBand: 'labels', maxSize: maxObjectPixels }).rename('patch_pixels');

  // Calculate the total physical area (in hectares) for each uniquely labeled patch
  var patchAreaHa = ee.Image.pixelArea().divide(10000).updateMask(validObjects).addBands(labels).reduceConnectedComponents({ reducer: ee.Reducer.sum(), labelBand: 'labels', maxSize: maxObjectPixels }).rename('patch_area_ha');

  // Generate pixel coordinate layers matching the input projection to calculate bounding boxes
  var coords = ee.Image.pixelCoordinates(classificationYear.projection());
  // Extract X coordinates masked to the valid objects
  var x = coords.select('x').updateMask(validObjects).rename('x');
  // Extract Y coordinates masked to the valid objects
  var y = coords.select('y').updateMask(validObjects).rename('y');

  // Find the minimum X coordinate for each labeled patch
  var minX = x.addBands(labels).reduceConnectedComponents({ reducer: ee.Reducer.min(), labelBand: 'labels', maxSize: maxObjectPixels });
  // Find the maximum X coordinate for each labeled patch
  var maxX = x.addBands(labels).reduceConnectedComponents({ reducer: ee.Reducer.max(), labelBand: 'labels', maxSize: maxObjectPixels });
  // Find the minimum Y coordinate for each labeled patch
  var minY = y.addBands(labels).reduceConnectedComponents({ reducer: ee.Reducer.min(), labelBand: 'labels', maxSize: maxObjectPixels });
  // Find the maximum Y coordinate for each labeled patch
  var maxY = y.addBands(labels).reduceConnectedComponents({ reducer: ee.Reducer.max(), labelBand: 'labels', maxSize: maxObjectPixels });

  // Calculate the total number of pixels inside the rectangular bounding box of each patch
  var bboxPixels = maxX.subtract(minX).add(1).multiply(maxY.subtract(minY).add(1)).rename('bbox_pixels');
  
  // Calculate the fill ratio: actual patch pixels divided by its bounding box pixels
  var fillRatio = patchPixels.divide(bboxPixels).rename('fill_ratio');

  // Create an unmasked binary map of class 21 to evaluate core structures
  var class21Binary = classificationYear.eq(targetClass).unmask(0).rename('class21_binary');
  
  // Identify core pixels by finding areas where a full 3x3 neighborhood consists entirely of class 21
  var core = class21Binary.reduceNeighborhood({ reducer: ee.Reducer.min(), kernel: ee.Kernel.square(1) }).eq(1).updateMask(validObjects).rename('core');

  // Sum the number of core pixels within each labeled patch
  var corePixels = core.addBands(labels).reduceConnectedComponents({ reducer: ee.Reducer.sum(), labelBand: 'labels', maxSize: maxObjectPixels }).rename('core_pixels');

  // Return a multi-band image containing all the calculated geometric metrics for the patches
  return ee.Image.cat([ labels.rename('labels'), patchPixels, patchAreaHa, bboxPixels, fillRatio, corePixels ]);
};

// Define a function to evaluate patch metrics and flag objects for removal
var getRemovalMask = function(classificationYear, metrics) {
  // Extract the calculated patch area in hectares
  var patchAreaHa = metrics.select('patch_area_ha');
  // Extract the calculated total pixel count per patch
  var patchPixels = metrics.select('patch_pixels');
  // Extract the calculated bounding-box fill ratio
  var fillRatio = metrics.select('fill_ratio');
  // Extract the calculated core pixel count
  var corePixels = metrics.select('core_pixels');

  // Create a mask to isolate patches smaller than or equal to the area threshold (1 ha)
  var smallPatch = patchAreaHa.lte(maxPatchHa);

  // Flag irregular patches that possess a low fill ratio
  var lowFill = fillRatio.lt(minFillRatio);
  // Initialize the suspicious shape mask with the low fill ratio condition
  var suspiciousShape = lowFill;

  // Conditionally add the thinness criterion (no 3x3 core) to the suspicious mask
  if (useNoCoreCriterion) {
    // Flag patches that have zero core pixels but are larger than speckles
    var noCore = corePixels.eq(0).and(patchPixels.gt(maxSpecklePixels));
    suspiciousShape = suspiciousShape.or(noCore);
  }

  // Conditionally add the tiny speckle criterion to the suspicious mask
  if (removeVerySmallSpeckles) {
    // Flag patches that are smaller than or equal to the maximum speckle limit
    var tinySpeckle = patchPixels.lte(maxSpecklePixels);
    suspiciousShape = suspiciousShape.or(tinySpeckle);
  }

  // Return the final removal mask combining target class, small size, and suspicious shape
  return classificationYear.eq(targetClass).and(smallPatch).and(suspiciousShape);
};

// Define a function to execute the spatial filter and replacement for a single year
var applySpatialShapeFilterOneYear = function(classificationYear) {
  // Compute all patch metrics for the current year
  var metrics = getPatchMetrics(classificationYear);
  // Generate the binary mask of patches flagged for removal
  var removalMask = getRemovalMask(classificationYear, metrics);

  // Create a context mask by removing class 21 and 0 (NoData) to find valid replacement pixels
  var replacementContext = classificationYear.updateMask(classificationYear.neq(targetClass).and(classificationYear.neq(0)));

  // Calculate the focal mode (majority class) of the valid surroundings within a 150m circular radius
  var contextMode = replacementContext.focalMode(contextRadiusMeters, 'circle', 'meters');

  // Ensure corrections are only applied where a valid surrounding replacement class actually exists
  var validReplacement = contextMode.mask();
  var finalRemovalMask = removalMask.and(validReplacement);

  // Overwrite the flagged class 21 patches with the contextual focal mode class
  var corrected = classificationYear.where(finalRemovalMask, contextMode.unmask(classificationYear)).rename('classification').toInt16();

  // Return the corrected annual band
  return corrected;
};

// Apply the spatial shape filter to the full time series
var outputClassification = make(years, function(year) {
  return applySpatialShapeFilterOneYear(sel(classification, year));
});

// Set a specific year to generate and visualize layers
var diagnosticYear = 2024;

// Build diagnostic layers
var diagnosticClassification = sel(classification, diagnosticYear);
var diagnosticOutput = sel(outputClassification, diagnosticYear);
var diagnosticMetrics = getPatchMetrics(diagnosticClassification);
var diagnosticRemovalMask = getRemovalMask(diagnosticClassification, diagnosticMetrics);

// Generate a mask showing all class 21 patches that fell within the generic size threshold
var diagnosticCandidate = diagnosticClassification.eq(targetClass).and(diagnosticMetrics.select('patch_area_ha').lte(maxPatchHa));

// Generate a mask showing exactly which class 21 pixels were successfully removed and replaced
var diagnosticRemoved = diagnosticClassification.eq(targetClass).and(diagnosticOutput.neq(targetClass));

// Render the removed pixels diagnostic layer to the map
Map.addLayer(diagnosticRemoved.selfMask(), {}, 'Diagnostic ' + diagnosticYear + ': removed class-21 pixels', false);

// Render the removed pixels diagnostic layer to the map
Map.addLayer(outputClassification, vis, 'Output spatial shape filter 21');

print('Output classification', outputClassification);

// Embed processing metadata attributes
outputClassification = outputClassification
  .rename(bands)
  .toInt16()
  .set({
    'filter': '16_spatial_shape_filter',
    'input_asset': inputFile,
    'output_version': outputVersion,
  });

// Export as GEE asset
Export.image.toAsset({
  image: outputClassification,
  description: inputFile + '_shp_v' + outputVersion,
  assetId: out + inputFile + '_shp_v' + outputVersion,
  pyramidingPolicy: {'.default': 'mode'},
  region: classificationInput.geometry(),
  scale: 30,
  maxPixels: 1e13
});
