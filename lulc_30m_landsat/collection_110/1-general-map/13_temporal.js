// --- --- --- 13) Temporal 
// This script applies a temporal consistency filter to the LULC maps.
// It corrects short-term spurious transitions (A-B-A) using a 3-year moving 
// window and stabilizes the extreme edges of the time series (2017 and 2025) 
// by enforcing agreement with adjacent years. Finally, it excludes small, 
// implausible patches of recent native vegetation regrowth at the end of the series.

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
var outputVersion = '2';

// Define the base directory
var root = 'projects/ee-ipam/assets/MAPBIOMAS/LULC/CERRADO_DEV/COL_11/SENTINEL/C04-POST-CLASSIFICATION/';
var out = 'projects/ee-ipam/assets/MAPBIOMAS/LULC/CERRADO_DEV/COL_11/SENTINEL/C04-POST-CLASSIFICATION/';

// Construct the base name of the input file
var inputFile = 'CERRADO_C04_gapfill_v3_spt_v1_tp_v3_tra_v2_snv_v3_traj_v4_freq_v'+inputVersion;

// Load the classification multi-band image
var classificationInput = ee.Image(root + inputFile);
print('Input classification', classificationInput);
Map.addLayer(classificationInput, vis, 'Input classification');

// Initialize an empty Earth Engine image to accumulate the selected temporal bands
var classification = ee.Image([]);

// Iterate all the years to extract all standard annual bands into a unified stack
ee.List.sequence({'start': 2017, 'end': 2025}).getInfo()
    .forEach(function(year_i) {
      
      // Extract the specific annual band from the input image
      var classification_i = classificationInput.select(['classification_' + year_i]);
      
      // Append the extracted band to the cumulative multi-band image
      classification = classification.addBands(classification_i);
    });

// Temporal Filter Functions
// Define the core 3-year moving window rule to correct spurious A-B-A transitions
var rule_3yr = function(class_id, year, image) {
  // Create a mask to identify pixels where the previous and next years equal the target class, but the current year does not
  var to_mask = image.select(['classification_' + String(year - 1)]).eq(class_id)    // previous
           .and(image.select(['classification_' + year]).neq(class_id))              // current
           .and(image.select(['classification_' + String(year + 1)]).eq(class_id));  // next

  // Return the current year's band, overwriting the spurious pixels with the stable target class
  return image.select(['classification_' + year])
              .where(to_mask.eq(1), class_id);
};

// Define a function to iterate the 3-year filter across all middle years in the time series
var run_3yr = function(image, class_id) {
  // Initialize the output container with the first year (which cannot be evaluated by a centered 3-year window)
  var container = image.select(['classification_2017']);
  
  // Iterate the 3-year rule across all middle years
  ee.List.sequence({'start': 2018, 'end': 2024}).getInfo()
      .forEach(function(year_i){
        // Append the temporally corrected middle year to the cumulative container
        container = container.addBands(rule_3yr(class_id, year_i, image));
      }
    );
    
  // Append the last year To the container, as it cannot be evaluated by a centered window
  container = container.addBands(image.select(['classification_2025']));
  
  // Return the complete time series with middle-year corrections applied
  return container;
};

// Define a function to stabilize the last year based on the two preceding years
var run_3yr_last = function(class_id, image) {
  // Create a mask targeting pixels where the last year differs from the target class, but both 2024 and 2023 match it
  var to_mask = image.select(['classification_2025']).neq(class_id)
           .and(image.select(['classification_2024']).eq(class_id))
           .and(image.select(['classification_2023']).eq(class_id));

  // Return the las year band, overwriting unstable pixels with the established historical class
  var last_yr = image.select(['classification_2025'])
                      .where(to_mask.eq(1), class_id);
  
  // Initialize an empty container to rebuild the time serie
  var container = ee.Image([]);
  
  // Append all unmodified years to the container
  ee.List.sequence({'start': 2017, 'end': 2024}).getInfo()
      .forEach(function(year_i) {
        container = container.addBands(image.select(['classification_' + year_i]));
      });
  
  // Append the newly corrected last year band to complete the time series
  return container.addBands(last_yr);
  
};

// Define a function to stabilize the first year based on the two subsequent years
var run_3yr_first = function(class_id, image) {
  // Create a mask targeting pixels where 2017 differs from the target class, but both 2018 and 2019 match it
  var to_mask = image.select(['classification_2017']).neq(class_id)
           .and(image.select(['classification_2018']).eq(class_id))
           .and(image.select(['classification_2019']).eq(class_id));
    
  // Rectify the class in first year where conditions are met
  var first_yr = image.select(['classification_2017'])
                      .where(to_mask.eq(1), class_id);
                      
  // Return the first year band, overwriting unstable pixels with the established subsequent class
  ee.List.sequence({'start': 2018, 'end': 2025}).getInfo()
      .forEach(function(year_i) {
        // Append all remaining unmodified years to reconstruct the full time series
        first_yr = first_yr.addBands(image.select(['classification_' + year_i]));
      });

  // Return the complete time series with first-year corrections applied
  return first_yr;
};

// Execute Temporal Filters
// Create an active working object initialized with the loaded classification stack
var to_filter = classification; 

// Define the hierarchical sequence of classes to process for the middle-year filter 
// Last class overrides previous ones
var class_ordering = [25, 33, 21, 50, 11, 3, 12, 4];

// Iterate the 3-year temporal filter through the defined class hierarchy
class_ordering.forEach(function(class_i) {
   to_filter = run_3yr(to_filter, class_i);
});

// Render the middle-year filtered result to the map
Map.addLayer(to_filter, vis, 'post-middle-year-filter');

// Apply the trailing-edge temporal filter to stabilize Mosaic of Uses in the last year
to_filter = run_3yr_last(21, to_filter);

// Render the last-year filtered result to the map
Map.addLayer(to_filter, vis, 'post-last-year-filter');

// Apply the leading-edge temporal filter to stabilize native classes in the first year
to_filter = run_3yr_first(11, to_filter);
to_filter = run_3yr_first(4, to_filter);
to_filter = run_3yr_first(3, to_filter);
to_filter = run_3yr_first(12, to_filter);
to_filter = run_3yr_first(50, to_filter);

// Render the first-year filtered result to the map
Map.addLayer(to_filter, vis, 'post-first-year-filter');

// Filter Small Deforestation Regrowth
// Initialize an empty image container to store the temporary classification
var remap_col = ee.Image([]);

// Iterate through the time series to temporarily collapse native classes for regrowth analysis
ee.List.sequence({'start': 2017, 'end': 2025}).getInfo()
  .forEach(function(year_i) {
    // Remap native vegetation classes (3, 4, 11, 12) to a Forest (3) class
    var x = to_filter.select(['classification_' + year_i])
      .remap([3, 4, 11, 12, 50, 21],
             [3, 3,  3,  3,  3, 21])
             .rename('classification_' + year_i);
 
    // Append the temporarily remapped year to the evaluation container
    remap_col = remap_col.addBands(x);
  });

// Identify spurious recent regrowths where a pixel shifted from Mosaic of Uses (21) in 2024 to Native (3) in 2025
var reg_last = remap_col.select(['classification_2025'])
                      .eq(3)
                      .and(remap_col.select(['classification_2024']).eq(21));

// Calculate the spatial size of these specific regrowth patches using 8-neighbor connectivity and reprojecting to 10m
var reg_size = reg_last.selfMask().connectedPixelCount(120, true).reproject('epsg:4326', null, 10);

// Isolate regrowth patches smaller than 1 hectare (11 pixels = ~0.1 ha)
var excludeReg = to_filter.select(['classification_2024'])
                          .updateMask(reg_size.lte(11).eq(1));

// Update the 2025 band by overwriting only the small regrowth patches with their prior 2024 state
var x24 = to_filter.select(['classification_2025']).blend(excludeReg);

// Replace the original 2025 band in the multi-band stack with the updated regrowth-filtered band
to_filter = to_filter.slice(0,8).addBands(x24.rename('classification_2025'));

// Render the final regrowth-filtered classification map to the display
Map.addLayer(to_filter, vis, 'big-reg-filter');

// Print the resulting final filtered image structure to the console
print ('Output classification', to_filter);

// Export as GEE asset
Export.image.toAsset({
    'image': to_filter,
    'description': inputFile + '_temp_v' + outputVersion,
    'assetId': out +  inputFile + '_temp_v' + outputVersion,
    'pyramidingPolicy': {'.default': 'mode'},
    'region':to_filter.geometry(),
    'scale': 10,
    'maxPixels': 1e13
});
