// --- --- --- 09_temporal
// Apply a temporal consistency filter to land use land cover classification maps,
// correcting short-term spurious transitions and stabilizing the first and last years 
// of the time series (2017–2024). This includes the removal of implausible class changes, 
// correction of isolated transitions, and exclusion of small patches of recent regrowth.
// barbara.silva@ipam.org.br, dhemerson.costa@ipam.org.br and ana.souza@ipam.org.br

// Import mapbiomas color schema 
var vis = {
    min: 0,
    max: 62,
    palette:require('users/mapbiomas/modules:Palettes.js').get('classification8'),
    bands: 'classification_2017'
};

// Set root directory 
var root = 'projects/mapbiomas-workspace/COLECAO_DEV/COLECAO10_DEV/CERRADO/SENTINEL/C03-POST-CLASSIFICATION/';
var out = 'projects/mapbiomas-workspace/COLECAO_DEV/COLECAO10_DEV/CERRADO/SENTINEL/C03-POST-CLASSIFICATION/';

// Set metadata
var inputVersion = '7';
var outputVersion = '10';

// Define input file
var inputFile = 'CERRADO_C03_gapfill_v9_sandveg_v4_frequency_v'+inputVersion;

// Load classification
var classificationInput = ee.Image(root + inputFile);
print('Input classification', classificationInput);
Map.addLayer(classificationInput, vis, 'Input classification');

// Define empty classification to receive data
var classification = ee.Image([]);

// Remap all anthopogenic classes only to single-one [21]
ee.List.sequence({'start': 2017, 'end': 2024}).getInfo()
    .forEach(function(year_i) {

      // Get year [i]
      var classification_i = classificationInput.select(['classification_' + year_i])
        // Remap classes
        .remap([3, 4, 11, 12, 50, 15, 18, 25, 33],
               [3, 4, 11, 12, 50, 21, 21, 25, 33])
               .rename('classification_' + year_i);

               // Insert into aggregated classification
               classification = classification.addBands(classification_i);
    });

// -- -- -- -- Define temporal filter rules for middle years (3-year window)
var rule_3yr = function(class_id, year, image) {
   // Identify pixels to be corrected based on surrounding years
  var to_mask = image.select(['classification_' + String(year - 1)]).eq(class_id)    // previous
           .and(image.select(['classification_' + year]).neq(class_id))              // current
           .and(image.select(['classification_' + String(year + 1)]).eq(class_id));  // next

  // Rectify the class in the current year where conditions are met
  return image.select(['classification_' + year])
              .where(to_mask.eq(1), class_id);
};

// Function to apply the 3-year temporal filter to the entire time series
var run_3yr = function(image, class_id) {
  // Initialize the container with the first year's classification
  var container = image.select(['classification_2017']);
  
 // Apply the temporal filter for each year from 2018 to 2023
  ee.List.sequence({'start': 2018, 'end': 2023}).getInfo()
      .forEach(function(year_i){
        container = container.addBands(rule_3yr(class_id, year_i, image));
      }
    );
    
  // Add the last year (2024) to the container without filtering it
  container = container.addBands(image.select(['classification_2024']));
  
  return container;
};

// -- -- -- -- Define filter for the last year (2024)
var run_3yr_last = function(class_id, image) {
  // Identify pixels to be corrected in 2024 if the class matches in 2022 and 2023 but differs in 2024
  var to_mask = image.select(['classification_2024']).neq(class_id)
           .and(image.select(['classification_2023']).eq(class_id))
           .and(image.select(['classification_2022']).eq(class_id));

  // Rectify the class in 2024 where conditions are met
  var last_yr = image.select(['classification_2024'])
                      .where(to_mask.eq(1), class_id);
  
  // Create an empty container to store the filtered time series
  var container = ee.Image([]);
  
  // Add all years from 2017 to 2023 to the container
  ee.List.sequence({'start': 2017, 'end': 2023}).getInfo()
      .forEach(function(year_i) {
        container = container.addBands(image.select(['classification_' + year_i]));
      });
  
  // Add the filtered 2024 classification to the container
  return container.addBands(last_yr);
  
};

// Fix first year [2017] if the next two years are stable
var run_3yr_first = function(class_id, image) {
  var to_mask = image.select(['classification_2017']).neq(class_id)
           .and(image.select(['classification_2018']).eq(class_id))
           .and(image.select(['classification_2019']).eq(class_id));
    
  // Rectify the class in 2017 where conditions are met
  var first_yr = image.select(['classification_2017'])
                      .where(to_mask.eq(1), class_id);
  
  ee.List.sequence({'start': 2018, 'end': 2024}).getInfo()
      .forEach(function(year_i) {
        first_yr = first_yr.addBands(image.select(['classification_' + year_i]));
      });
  
  return first_yr;
};

// -- -- -- -- End of functions

// ** ** **

// -- -- -- -- Start of conditionals 


// Create object to be filtered
var to_filter = classification; 

// Apply the 3-year temporal filter to middle years (2017 to 2023)
var class_ordering = [4, 12, 3, 11, 50, 21, 33, 25];

class_ordering.forEach(function(class_i) {
   to_filter = run_3yr(to_filter, class_i);
});

Map.addLayer(to_filter, vis, 'post-middle-year-filter');


// Apply the temporal filter to the last year (2024)
to_filter = run_3yr_last(21, to_filter);

Map.addLayer(to_filter, vis, 'post-last-year-filter');


// Apply the temporal filter to the first year (2017)
to_filter = run_3yr_first(11, to_filter);
to_filter = run_3yr_first(4, to_filter);
to_filter = run_3yr_first(3, to_filter);
to_filter = run_3yr_first(12, to_filter);
to_filter = run_3yr_first(50, to_filter);

Map.addLayer(to_filter, vis, 'post-first-year-filter');


// -- -- -- -- Avoid that filter runs over small deforestation (as Atlantic Forest team)

// Create an empty image to store the remapped classification
var remap_col = ee.Image([]);

// Remap vegetation classes (3, 4, 11, 12) to class 3, for each year
ee.List.sequence({'start': 2017, 'end': 2024}).getInfo()
  .forEach(function(year_i) {
    var x = to_filter.select(['classification_' + year_i])
      .remap([3, 4, 11, 12, 50, 21],
             [3, 3,  3,  3, 50, 21])
             .rename('classification_' + year_i);
 
    // Add the remapped year to the container
    remap_col = remap_col.addBands(x);
  });

// Identify regenerations between 2023 and 2024 (class change from 21 to 3)
var reg_last = remap_col.select(['classification_2024'])
                      .eq(3)
                      .and(remap_col.select(['classification_2023']).eq(21));

// Calculate the size of regenerated areas (connected pixel count)
var reg_size = reg_last.selfMask().connectedPixelCount(128, true).reproject('epsg:4326', null, 10);

// Exclude small regenerations (areas smaller than 1 ha, 11 pixels of 900 m² each)
var excludeReg = to_filter.select(['classification_2022'])
                          .updateMask(reg_size.lte(11).eq(1));

// Update 2024 by excluding only small regenerations
var x24 = to_filter.select(['classification_2024']).blend(excludeReg);

// Replace 2024 in the time series with the updated classification
to_filter = to_filter.slice(0,7).addBands(x24.rename('classification_2024'));

Map.addLayer(to_filter, vis, 'big-reg-filter');

print ('Output classification', to_filter);

// Export as GEE asset
Export.image.toAsset({
    'image': to_filter,
    'description': inputFile + '_temporal_v' + outputVersion,
    'assetId': out +  inputFile + '_temporal_v' + outputVersion,
    'pyramidingPolicy': {
        '.default': 'mode'
    },
    'region':to_filter.geometry(),
    'scale': 10,
    'maxPixels': 1e13
});
